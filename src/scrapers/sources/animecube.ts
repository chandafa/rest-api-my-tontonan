/**
 * Source adapter: animecube (DONGHUA) — https://animecube.live
 *
 * Why this file exists:
 * User's priority donghua source — complete catalogs, latest resolution. It's a
 * Next.js App-Router (RSC) site (no WordPress, no __NEXT_DATA__) but everything is
 * reachable over plain HTTP:
 *   - Home list is server-rendered in the HTML (`a[href^="/anime/"]`).
 *   - Detail (title/synopsis/genres/episodes) lives in the React-Flight blobs
 *     (`self.__next_f.push([1,"…"])`) under an `"anime":{…}` object.
 *   - Stream sources come from two JSON APIs: a per-season version token, then the
 *     episode sources endpoint (returns Dailymotion `privateId` + Rumble). We
 *     play the Dailymotion private embed in the in-app WebView (desktop UA).
 *
 * Verified June 2026 (see investigation spec).
 */
import * as cheerio from 'cheerio';
import type { AnimeSource, SourceId } from '../../config';
import { NotFoundError, ScrapeParseError } from '../../utils/errors';
import { sourceGet } from '../../utils/http-client';
import { BaseAdapter } from '../source-adapter';
import type {
  AnimeDetail,
  AnimeListItem,
  EpisodeData,
  EpisodeListItem,
  HomeData,
  SearchResultItem,
  VideoSource,
} from '../types';
import { cleanText } from '../util/parse';

// Native episode slug packs everything the sources API needs.
const EP_SEP = '|';

interface FlightEpisode {
  id: string;
  number?: number;
  numberDisplay?: string;
  title?: string;
}
interface FlightAnime {
  title?: string;
  description?: string;
  genres?: string[];
  status?: string;
  year?: number;
  coverImage?: string;
  totalEpisodes?: number;
  primaryTabs?: Array<{
    id: string;
    seasons?: Array<{ id: string; title?: string; episodes?: FlightEpisode[] }>;
  }>;
}

/** Concatenate all React-Flight string chunks embedded in the page. */
function flightText(html: string): string {
  const out: string[] = [];
  const re = /self\.__next_f\.push\(\[1,\s*"((?:[^"\\]|\\.)*)"\]\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    try {
      out.push(JSON.parse(`"${m[1]}"`));
    } catch {
      /* skip an unparseable chunk */
    }
  }
  return out.join('');
}

/** Extract the balanced `{…}` object whose opening brace is at/after `from`. */
function balancedObjectAt(text: string, from: number): string | null {
  const start = text.indexOf('{', from);
  if (start === -1) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function parseAnime(html: string): FlightAnime | null {
  const flight = flightText(html);
  // There are multiple `"anime":` keys (one is a UI-strings object). Pick the
  // one that is the actual data object — it has primaryTabs/description.
  const re = /"anime":/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(flight)) !== null) {
    const raw = balancedObjectAt(flight, m.index + m[0].length);
    if (!raw) continue;
    try {
      const obj = JSON.parse(raw) as FlightAnime & { primaryTabs?: unknown; description?: unknown };
      if (obj && (obj.primaryTabs !== undefined || obj.description !== undefined)) {
        return obj;
      }
    } catch {
      /* not this one — keep scanning */
    }
  }
  return null;
}

/** Dailymotion quality ladder sized to the source's stated quality label. */
function ladderFor(label: string): ReadonlyArray<readonly [string, string]> {
  const q = label.toLowerCase();
  if (/4k|2160/.test(q))
    return [['2160p (4K)', '2160'], ['1440p (2K)', '1440'], ['1080p', '1080'], ['720p', '720'], ['480p', '480']];
  if (/1440|2k/.test(q))
    return [['1440p (2K)', '1440'], ['1080p', '1080'], ['720p', '720'], ['480p', '480']];
  return [['1080p', '1080'], ['720p', '720'], ['480p', '480']];
}

export class AnimecubeAdapter extends BaseAdapter {
  readonly id: SourceId;

  constructor(source: AnimeSource) {
    super(source);
    this.id = source.id;
  }

  private homeCards(html: string): AnimeListItem[] {
    const $ = cheerio.load(html);
    const items: AnimeListItem[] = [];
    const seen = new Set<string>();
    $('a[href^="/anime/"]').each((_, el) => {
      const $a = $(el);
      const href = ($a.attr('href') ?? '').split('?')[0] ?? '';
      const slug = href.replace(/^\/anime\//, '').replace(/\/$/, '');
      if (!slug || seen.has(slug)) return;
      const title = cleanText($a.attr('aria-label') || $a.find('img').attr('alt') || $a.text());
      if (!title) return;
      seen.add(slug);
      items.push({
        title,
        slug: this.enc(slug),
        cover: $a.find('img').attr('src') ?? '',
        latest_episode: null,
        status: 'Donghua',
      });
    });
    return items;
  }

  async scrapeHome(): Promise<HomeData> {
    const html = await sourceGet<string>(this.client, '/');
    const items = this.homeCards(html);
    if (items.length === 0) throw new ScrapeParseError('animecube home empty');
    return { ongoing: items, latest: [], popular: items.slice(0, 12) };
  }

  async scrapeSearch(query: string): Promise<SearchResultItem[]> {
    // No server search endpoint — filter the catalog locally.
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const html = await sourceGet<string>(this.client, '/');
    return this.homeCards(html)
      .filter((c) => c.title.toLowerCase().includes(q))
      .map((c) => ({ title: c.title, slug: c.slug, cover: c.cover, status: 'Donghua', genre: [] }));
  }

  async scrapeAnime(nativeSlug: string): Promise<AnimeDetail> {
    const html = await sourceGet<string>(this.client, `/anime/${nativeSlug}`);
    const anime = parseAnime(html);
    if (!anime) throw new ScrapeParseError(`animecube: could not parse detail (${nativeSlug})`);

    const episodes: EpisodeListItem[] = [];
    for (const tab of anime.primaryTabs ?? []) {
      for (const season of tab.seasons ?? []) {
        for (const ep of season.episodes ?? []) {
          if (!ep.id) continue;
          const num = ep.number ?? Number(ep.numberDisplay) ?? null;
          episodes.push({
            // pack slug|primaryTab|seasonTab|episodeId for the sources API
            slug: this.enc([nativeSlug, tab.id, season.id, ep.id].join(EP_SEP)),
            number: num,
            title: ep.title || (num != null ? `Episode ${num}` : ep.id),
            upload_date: '',
          });
        }
      }
    }
    episodes.sort((a, b) => (a.number ?? 0) - (b.number ?? 0));

    return {
      title: cleanText(anime.title ?? nativeSlug.replace(/-/g, ' ')),
      slug: this.enc(nativeSlug),
      cover: anime.coverImage ?? '',
      synopsis: cleanText(anime.description ?? ''),
      genre: anime.genres ?? [],
      status: anime.status === 'completed' ? 'Completed' : 'Ongoing',
      year: anime.year ?? null,
      rating: 'N/A',
      total_episodes: anime.totalEpisodes ?? episodes.length,
      episodes,
    };
  }

  async scrapeEpisode(nativeSlug: string): Promise<EpisodeData> {
    const [slug, primaryTabId, seasonId, episodeId] = nativeSlug.split(EP_SEP);
    if (!slug || !primaryTabId || !seasonId || !episodeId) {
      throw new NotFoundError(`animecube: malformed episode slug`);
    }

    // Step A: per-season version token.
    const versions = await sourceGet<{ bySeason?: Record<string, Record<string, Record<string, string>>> }>(
      this.client,
      '/api/anime-sources-versions',
      { responseType: 'json' },
    );
    const vToken = versions.bySeason?.[slug]?.[primaryTabId]?.[seasonId];
    if (!vToken) throw new ScrapeParseError(`animecube: no version token for ${slug}`);

    // Step B: episode sources (omit X-Obf header => plain JSON, no crypto).
    const data = await sourceGet<{
      success?: boolean;
      sources?: Array<{ platform: string; videoId?: string; privateId?: string; quality?: string }>;
    }>(
      this.client,
      `/api/anime/${slug}/episode/${episodeId}/sources?v=${encodeURIComponent(vToken)}` +
        `&primaryTabId=${encodeURIComponent(primaryTabId)}&seasonId=${encodeURIComponent(seasonId)}`,
      { responseType: 'json', headers: { Accept: 'application/json' } },
    );

    const dm = (data.sources ?? []).find((s) => s.platform === 'dailymotion');
    let sources: VideoSource[] = [];
    let embedUrl = '';
    if (dm?.privateId || dm?.videoId) {
      // Play via the private id on the modern GEO player — it serves the real 4K
      // ladder (the legacy /embed/ player caps at 1080p in a WebView).
      const id = dm.privateId || dm.videoId!;
      const base = `https://geo.dailymotion.com/player.html?video=${id}`;
      sources = ladderFor(dm.quality ?? '').map(([label, q]) => ({
        quality: label,
        url: `${base}&quality=${q}&autoplay=1`,
        type: 'hls' as const,
      }));
      sources.push({ quality: 'Auto', url: `${base}&quality=auto&autoplay=1`, type: 'hls' });
      embedUrl = sources[0]!.url;
    } else {
      // Fallback: Rumble embed plays in the WebView too.
      const rumble = (data.sources ?? []).find((s) => s.platform === 'rumble');
      if (rumble?.videoId) embedUrl = `https://rumble.com/embed/${rumble.videoId}/`;
    }
    if (!embedUrl) throw new ScrapeParseError(`animecube: no playable source for ${episodeId}`);

    return {
      anime_title: cleanText(slug.replace(/-/g, ' ')),
      anime_slug: this.enc(slug),
      episode_number: null,
      sources,
      prev_episode_slug: null,
      next_episode_slug: null,
      embed_url: embedUrl,
    };
  }
}
