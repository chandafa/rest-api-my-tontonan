/**
 * Failover orchestrator (Phase 3 — the heart of the 3-domain requirement).
 *
 * Why this file exists:
 * The user requires automatic failover across 3 source sites. This module owns
 * the adapter registry (built in config.sources priority order) and the failover
 * policy:
 *   - LIST ops (home/search): try each source in order until one succeeds.
 *   - DETAIL ops (anime/episode): the slug is source-prefixed, so route straight
 *     to its owning adapter (only it understands that slug). If that source is
 *     down we surface 503; unprefixed legacy slugs fall back to trying all.
 *
 * Routes import the thin façades (home-scraper.ts, …) which call into here.
 */
import { config } from '../config';
import type { SourceId } from '../config';
import { AppError, SourceUnavailableError } from '../utils/errors';
import { logger } from '../utils/logger';
import type { SourceAdapter } from './source-adapter';
import { decodeSlug } from './source-adapter';
import { AniwatchAdapter } from './sources/aniwatch';
import { AnimepaheAdapter } from './sources/animepahe';
import { AnimeplaytvAdapter } from './sources/animeplaytv';
import { AnichinAdapter } from './sources/anichin';
import { AnichinRoAdapter } from './sources/anichinro';
import { AnimecubeAdapter } from './sources/animecube';
import { AnimexinAdapter } from './sources/animexin';
import { AnixPlAdapter } from './sources/anixpl';
import { DonghubAdapter } from './sources/donghub';
import { GmrFilmAdapter } from './sources/gmrfilm';
import { MaratonDonghuaAdapter } from './sources/maratondonghua';
import { NineAnimeAdapter } from './sources/nineanime';
import { SankavollereiAdapter } from './sources/sankavollerei';
import { SankavollereiDonghuaAdapter } from './sources/sankavollerei-donghua';
import type { AnimeDetail, EpisodeData, HomeData, SearchResultItem } from './types';

function buildAdapter(id: SourceId, source: { id: SourceId; baseUrl: string }): SourceAdapter {
  switch (id) {
    case 'aniwatch':
      return new AniwatchAdapter(source);
    case 'animeplaytv':
      return new AnimeplaytvAdapter(source);
    case 'animepahe':
      return new AnimepaheAdapter(source);
    case 'sankavollerei':
      return new SankavollereiAdapter(source);
    case 'anixpl':
      return new AnixPlAdapter(source);
    case 'nineanime':
      return new NineAnimeAdapter(source);
    case 'donghub':
      return new DonghubAdapter(source);
    case 'anichin':
      return new AnichinAdapter(source);
    case 'anichinro':
      return new AnichinRoAdapter(source);
    case 'animexin':
      return new AnimexinAdapter(source);
    case 'animecube':
      return new AnimecubeAdapter(source);
    case 'sankadonghua':
      return new SankavollereiDonghuaAdapter(source);
    case 'maratondonghua':
      return new MaratonDonghuaAdapter(source);
    case 'iyengar':
    case 'evilseniors':
      return new GmrFilmAdapter(source);
  }
}

// Built once per warm function instance, in failover priority order.
const adapters: SourceAdapter[] = config.sources.map((s) => buildAdapter(s.id, s));
const donghuaAdapters: SourceAdapter[] = config.donghuaSources.map((s) => buildAdapter(s.id, s));
const filmAdapters: SourceAdapter[] = config.filmSources.map((s) => buildAdapter(s.id, s));

// Global registry across ALL chains so source-prefixed detail/episode slugs
// route to their owning adapter regardless of content type.
const byId = new Map<SourceId, SourceAdapter>(
  [...adapters, ...donghuaAdapters, ...filmAdapters].map((a) => [a.id, a]),
);

/** Try every source in a chain in order; return the first success, else 503. */
async function failoverIn<T>(
  chain: SourceAdapter[],
  label: string,
  op: (a: SourceAdapter) => Promise<T>,
): Promise<T> {
  const errors: Record<string, string> = {};
  for (const adapter of chain) {
    try {
      const result = await op(adapter);
      if (adapter.id !== chain[0]?.id) {
        logger.info('served via failover source', { source: adapter.id, op: label });
      }
      return result;
    } catch (err) {
      errors[adapter.id] = err instanceof Error ? err.message : String(err);
      logger.warn('source failed — failing over', {
        source: adapter.id,
        op: label,
        error: errors[adapter.id],
      });
    }
  }
  throw new SourceUnavailableError(`No source could handle "${label}"`, errors);
}

const failover = <T>(label: string, op: (a: SourceAdapter) => Promise<T>): Promise<T> =>
  failoverIn(adapters, label, op);
const filmFailover = <T>(label: string, op: (a: SourceAdapter) => Promise<T>): Promise<T> =>
  failoverIn(filmAdapters, label, op);

/** Route a source-prefixed slug to its owning adapter (no cross-source guess). */
async function routed<T>(
  slug: string,
  label: string,
  op: (a: SourceAdapter, native: string) => Promise<T>,
): Promise<T> {
  const decoded = decodeSlug(slug);
  if (decoded) {
    const adapter = byId.get(decoded.source);
    if (!adapter) {
      throw new SourceUnavailableError(`Unknown source for slug: ${slug}`);
    }
    try {
      return await op(adapter, decoded.native);
    } catch (err) {
      if (err instanceof AppError) throw err; // preserve 404 / parse errors
      throw new SourceUnavailableError(`Source ${decoded.source} is unavailable`, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  // Unprefixed slug (legacy/manual) — best-effort across all sources.
  return failover(label, (a) => op(a, slug));
}

export function scrapeHome(): Promise<HomeData> {
  return failover('home', (a) => a.scrapeHome());
}

export function scrapeSearch(query: string): Promise<SearchResultItem[]> {
  return failover(`search:${query}`, (a) => a.scrapeSearch(query));
}

// --- Donghua cross-source UNION + MERGE -------------------------------------
// The Dailymotion channel (maratondonghua) only carries the episodes its creator
// uploaded, so a series can show just a handful of episodes. To fix that we merge
// every donghua source: catalogs are unioned, and a series' episode list is the
// union of all sources' episodes (by number), each playing from the best-quality
// source that has it (maratondonghua's 4K wins where available).

const DONGHUA_IDS = new Set<SourceId>(donghuaAdapters.map((a) => a.id));

// Lower = preferred when the SAME episode number exists in multiple sources.
// maratondonghua first (its Dailymotion uploads expose up to 2160p/1440p).
const DONGHUA_QUALITY_RANK: SourceId[] = [
  'animecube',
  'maratondonghua',
  'animexin',
  'donghub',
  'anichin',
  'anichinro',
  'sankadonghua',
];
const qualityRank = (id: SourceId): number => {
  const i = DONGHUA_QUALITY_RANK.indexOf(id);
  return i === -1 ? 99 : i;
};

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('merge-timeout')), ms)),
  ]);
}

function normTitle(t: string): string {
  return t
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\bsub\s*indo\b/g, ' ')
    .replace(/\b(4k|2k|uhd|fhd|hd)\b/g, ' ')
    .replace(/\b(season|s)\s*\d+\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const SPINOFF = /\b(movie|ova|special|preview|trailer|recap)\b/i;

/** 2 = exact title, 1 = safe contained match, 0 = no match. */
function matchScore(query: string, candidate: string): number {
  const q = normTitle(query);
  const c = normTitle(candidate);
  if (!q || !c) return 0;
  if (q === c) return 2;
  // Don't let a spin-off ("… Movie") swallow the base series via containment.
  if (SPINOFF.test(candidate) && !SPINOFF.test(query)) return 0;
  const [short, long] = q.length <= c.length ? [q, c] : [c, q];
  return short.length >= 6 && long.includes(short) ? 1 : 0;
}

/** Find the same series on every OTHER donghua source and fetch its detail. */
async function gatherDonghua(
  title: string,
  exclude: SourceId,
): Promise<Array<{ source: SourceId; detail: AnimeDetail }>> {
  const settled = await Promise.allSettled(
    donghuaAdapters
      .filter((a) => a.id !== exclude)
      .map(async (a) => {
        const results = await withTimeout(a.scrapeSearch(title), 8000);
        let best: SearchResultItem | null = null;
        let bestScore = 0;
        for (const r of results) {
          const s = matchScore(title, r.title);
          if (s > bestScore) {
            bestScore = s;
            best = r;
          }
        }
        if (!best || bestScore < 1) throw new Error('no match');
        const native = decodeSlug(best.slug)?.native ?? '';
        const detail = await withTimeout(a.scrapeAnime(native), 12000);
        return { source: a.id, detail };
      }),
  );
  return settled.flatMap((s) => (s.status === 'fulfilled' ? [s.value] : []));
}

/** Merge a donghua series' episodes across all sources (fills missing episodes). */
async function enrichDonghua(primary: AnimeDetail, primarySource: SourceId): Promise<AnimeDetail> {
  const others = await gatherDonghua(primary.title, primarySource);
  if (others.length === 0) return primary;

  const all = [{ source: primarySource, detail: primary }, ...others];
  const byNum = new Map<number, { slug: string; title: string; rank: number }>();
  for (const { source, detail } of all) {
    const rank = qualityRank(source);
    for (const ep of detail.episodes) {
      if (ep.number == null) continue;
      const existing = byNum.get(ep.number);
      if (!existing || rank < existing.rank) {
        byNum.set(ep.number, { slug: ep.slug, title: ep.title, rank });
      }
    }
  }
  // Nothing gained — keep the original (avoids reshuffling a complete list).
  if (byNum.size <= primary.episodes.length) return primary;

  const episodes = [...byNum.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([number, v]) => ({
      slug: v.slug,
      number,
      title: v.title || `Episode ${number}`,
      upload_date: '',
    }));

  const richest = all.find((c) => c.detail.synopsis)?.detail ?? primary;
  return {
    ...primary,
    cover: primary.cover || richest.cover,
    synopsis: primary.synopsis || richest.synopsis,
    genre: primary.genre.length ? primary.genre : richest.genre,
    total_episodes: episodes.length,
    episodes,
  };
}

export async function scrapeAnime(slug: string): Promise<AnimeDetail> {
  const decoded = decodeSlug(slug);
  const detail = await routed(slug, `anime:${slug}`, (a, native) => a.scrapeAnime(native));
  if (decoded && DONGHUA_IDS.has(decoded.source)) {
    try {
      return await enrichDonghua(detail, decoded.source);
    } catch (err) {
      logger.warn('donghua merge failed — serving primary only', {
        slug,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return detail;
}

export function scrapeEpisode(slug: string): Promise<EpisodeData> {
  return routed(slug, `episode:${slug}`, (a, native) => a.scrapeEpisode(native));
}

// --- Donghua chain: UNION catalogs across all sources (not first-success) ----
export async function scrapeDonghuaHome(): Promise<HomeData> {
  const settled = await Promise.allSettled(
    donghuaAdapters.map((a) => withTimeout(a.scrapeHome(), 9000)),
  );
  const homes = settled.flatMap((s) => (s.status === 'fulfilled' ? [s.value] : []));
  if (homes.length === 0) {
    throw new SourceUnavailableError('No donghua source could serve home');
  }
  // Union ongoing by normalized title (first source in chain order wins the card).
  const seen = new Map<string, (typeof homes)[number]['ongoing'][number]>();
  for (const h of homes) {
    for (const item of h.ongoing) {
      const k = normTitle(item.title);
      if (k && !seen.has(k)) seen.set(k, item);
    }
  }
  const ongoing = [...seen.values()];
  const latest = homes.flatMap((h) => h.latest).slice(0, 30);
  return { ongoing, latest, popular: ongoing.slice(0, 12) };
}

export async function scrapeDonghuaSearch(query: string): Promise<SearchResultItem[]> {
  const settled = await Promise.allSettled(
    donghuaAdapters.map((a) => withTimeout(a.scrapeSearch(query), 9000)),
  );
  const seen = new Map<string, SearchResultItem>();
  for (const s of settled) {
    if (s.status !== 'fulfilled') continue;
    for (const item of s.value) {
      const k = normTitle(item.title);
      if (k && !seen.has(k)) seen.set(k, item);
    }
  }
  return [...seen.values()];
}

// Donghua detail/episode reuse the global slug router (scrapeAnime/scrapeEpisode)
// because every slug is source-prefixed and byId includes the donghua adapters.

// --- Film chain (separate failover list, shared slug routing) ---------------
export function scrapeFilmHome(): Promise<HomeData> {
  return filmFailover('film:home', (a) => a.scrapeHome());
}

export function scrapeFilmSearch(query: string): Promise<SearchResultItem[]> {
  return filmFailover(`film:search:${query}`, (a) => a.scrapeSearch(query));
}
