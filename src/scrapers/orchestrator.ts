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
import { AnixPlAdapter } from './sources/anixpl';
import { BioskopkerenAdapter } from './sources/bioskopkeren';
import { DonghubAdapter } from './sources/donghub';
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
    case 'sankadonghua':
      return new SankavollereiDonghuaAdapter(source);
    case 'bioskopkeren':
      return new BioskopkerenAdapter(source);
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
const donghuaFailover = <T>(label: string, op: (a: SourceAdapter) => Promise<T>): Promise<T> =>
  failoverIn(donghuaAdapters, label, op);
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

export function scrapeAnime(slug: string): Promise<AnimeDetail> {
  return routed(slug, `anime:${slug}`, (a, native) => a.scrapeAnime(native));
}

export function scrapeEpisode(slug: string): Promise<EpisodeData> {
  return routed(slug, `episode:${slug}`, (a, native) => a.scrapeEpisode(native));
}

// --- Donghua chain (separate failover list, shared slug routing) ------------
export function scrapeDonghuaHome(): Promise<HomeData> {
  return donghuaFailover('donghua:home', (a) => a.scrapeHome());
}

export function scrapeDonghuaSearch(query: string): Promise<SearchResultItem[]> {
  return donghuaFailover(`donghua:search:${query}`, (a) => a.scrapeSearch(query));
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
