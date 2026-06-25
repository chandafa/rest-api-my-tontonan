/**
 * Source adapter: maratondonghua (DONGHUA) — Dailymotion channel, official Data API.
 *
 * Why this file exists:
 * The user's priority donghua source is the Dailymotion channel
 * https://www.dailymotion.com/user/maratondonghua (id x306fnm, ~196 videos),
 * whose uploads carry the ORIGINAL renditions up to 1440p (2K) / 2160p (4K) —
 * far better than the embed-only mirror sites. Instead of scraping HTML we use
 * Dailymotion's public JSON Data API (api.dailymotion.com): clean, fast, stable.
 *
 * The channel is a flat list of "<SERIES> Episode <N> Sub Indo" videos. We GROUP
 * them by series so they fit the app's anime→episodes model: each series is one
 * "anime", each video one episode. Playback uses the ad-free default Dailymotion
 * embed in the in-app WebView (its HLS manifest is CDN-token-locked); the app
 * sets a DESKTOP user-agent so Dailymotion serves the full 1080p/1440p/2160p.
 */
import type { AnimeSource, SourceId } from '../../config';
import { ScrapeParseError } from '../../utils/errors';
import { sourceGet } from '../../utils/http-client';
import { BaseAdapter } from '../source-adapter';
import type {
  AnimeDetail,
  AnimeListItem,
  EpisodeData,
  HomeData,
  LatestEpisodeItem,
  SearchResultItem,
  VideoSource,
} from '../types';

const CHANNEL = 'maratondonghua';
const VIDEO_FIELDS = 'id,title,thumbnail_480_url,thumbnail_720_url,created_time,duration';

// Dailymotion `available_formats` token -> { app label, embed `quality=` value }.
// Ordered best-first so the default (sources[0]) is the highest quality.
const FORMAT_MAP: ReadonlyArray<readonly [string, string, string]> = [
  ['uhd2160', '2160p (4K)', '2160'],
  ['uhd1440', '1440p (2K)', '1440'],
  ['hd1080', '1080p', '1080'],
  ['hd720', '720p', '720'],
  ['hq', '480p', '480'],
  ['sd', '360p', '360'],
];

interface DmVideo {
  id: string;
  title: string;
  thumbnail_480_url?: string;
  thumbnail_720_url?: string;
  created_time?: number;
  duration?: number;
}

interface Series {
  key: string;
  title: string;
  cover: string;
  latestCreated: number;
  latestNumber: number;
  episodes: Array<{ id: string; number: number; title: string; created: number }>;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

/** Split "<SERIES> Episode <N> Sub Indo" into a series name + episode number. */
function parseTitle(raw: string): { series: string; number: number } {
  const t = raw.replace(/\s+/g, ' ').trim();
  const m = t.match(/^(.*?)\s*(?:Episode|Eps?\.?)\s*(\d+)/i);
  if (m?.[1] != null) {
    const series = m[1].replace(/^\[[^\]]*\]\s*/, '').trim();
    return { series: series || t, number: Number(m[2]) };
  }
  // No episode marker (movie/special/preview): its own one-episode "series".
  const series = t
    .replace(/^\[[^\]]*\]\s*/, '')
    .replace(/\s*Sub\s*Indo.*$/i, '')
    .trim();
  return { series: series || t, number: 1 };
}

export class MaratonDonghuaAdapter extends BaseAdapter {
  readonly id: SourceId;

  // Short-lived memo so home + detail + search don't each re-hit the API.
  private static cache: { at: number; series: Series[] } | null = null;
  private static readonly TTL_MS = 120_000;

  constructor(source: AnimeSource) {
    super(source);
    this.id = source.id;
  }

  /** Fetch the whole channel (paged) and group videos into series. Memoized. */
  private async loadSeries(): Promise<Series[]> {
    const memo = MaratonDonghuaAdapter.cache;
    if (memo && Date.now() - memo.at < MaratonDonghuaAdapter.TTL_MS) return memo.series;

    const videos: DmVideo[] = [];
    for (let page = 1; page <= 4; page++) {
      const res = await sourceGet<{ list: DmVideo[]; has_more: boolean }>(
        this.client,
        `/user/${CHANNEL}/videos?fields=${VIDEO_FIELDS}&limit=100&page=${page}&sort=recent`,
        { responseType: 'json' },
      );
      if (Array.isArray(res.list)) videos.push(...res.list);
      if (!res.has_more) break;
    }
    if (videos.length === 0) throw new ScrapeParseError('maratondonghua: empty channel');

    const groups = new Map<string, Series>();
    for (const v of videos) {
      if (!v.id || !v.title) continue;
      const { series, number } = parseTitle(v.title);
      const key = slugify(series);
      if (!key) continue;
      const created = v.created_time ?? 0;
      const cover = v.thumbnail_720_url || v.thumbnail_480_url || '';
      let g = groups.get(key);
      if (!g) {
        g = { key, title: series, cover, latestCreated: created, latestNumber: number, episodes: [] };
        groups.set(key, g);
      }
      g.episodes.push({ id: v.id, number, title: v.title, created });
      if (created >= g.latestCreated) {
        g.latestCreated = created;
        if (cover) g.cover = cover;
      }
      if (number > g.latestNumber) g.latestNumber = number;
    }

    // Newest-updated series first.
    const series = [...groups.values()].sort((a, b) => b.latestCreated - a.latestCreated);
    MaratonDonghuaAdapter.cache = { at: Date.now(), series };
    return series;
  }

  private toCard(s: Series): AnimeListItem {
    return {
      title: s.title,
      slug: this.enc(`s:${s.key}`),
      cover: s.cover,
      latest_episode: s.latestNumber,
      status: 'Donghua',
    };
  }

  async scrapeHome(): Promise<HomeData> {
    const series = await this.loadSeries();

    // "Latest" rail = the most recent individual episodes across all series.
    const recent: Array<LatestEpisodeItem & { _c: number }> = [];
    for (const s of series) {
      for (const e of s.episodes) {
        recent.push({
          anime_title: s.title,
          anime_slug: this.enc(`s:${s.key}`),
          episode_slug: this.enc(`v:${e.id}`),
          episode_number: e.number,
          upload_date: '',
          cover: s.cover,
          _c: e.created,
        });
      }
    }
    recent.sort((a, b) => b._c - a._c);
    const latest = recent.slice(0, 20).map(({ _c, ...rest }) => rest);

    return {
      ongoing: series.map((s) => this.toCard(s)),
      latest,
      popular: series.slice(0, 12).map((s) => this.toCard(s)),
    };
  }

  async scrapeSearch(query: string): Promise<SearchResultItem[]> {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const series = await this.loadSeries();
    return series
      .filter((s) => s.title.toLowerCase().includes(q))
      .slice(0, 40)
      .map((s) => ({
        title: s.title,
        slug: this.enc(`s:${s.key}`),
        cover: s.cover,
        status: 'Donghua',
        genre: [],
      }));
  }

  async scrapeAnime(nativeSlug: string): Promise<AnimeDetail> {
    const key = nativeSlug.replace(/^s:/, '');
    const series = await this.loadSeries();
    const s = series.find((x) => x.key === key);
    if (!s) throw new ScrapeParseError(`maratondonghua: series not found (${key})`);

    const episodes = [...s.episodes]
      .sort((a, b) => a.number - b.number)
      .map((e) => ({
        slug: this.enc(`v:${e.id}`),
        number: e.number,
        title: `Episode ${e.number}`,
        upload_date: '',
      }));

    return {
      title: s.title,
      slug: this.enc(`s:${s.key}`),
      cover: s.cover,
      synopsis: '',
      genre: [],
      status: 'Donghua',
      year: null,
      rating: 'N/A',
      total_episodes: episodes.length,
      episodes,
    };
  }

  async scrapeEpisode(nativeSlug: string): Promise<EpisodeData> {
    const id = nativeSlug.replace(/^v:/, '');
    const base = `https://www.dailymotion.com/embed/video/${id}`;

    // Build quality options from the video's REAL available renditions (up to 4K).
    let sources: VideoSource[] = [];
    let title = 'Donghua';
    try {
      const meta = await sourceGet<{ title?: string; available_formats?: string[] }>(
        this.client,
        `/video/${id}?fields=title,available_formats`,
        { responseType: 'json' },
      );
      if (meta.title) title = meta.title;
      const formats = new Set(meta.available_formats ?? []);
      sources = FORMAT_MAP.filter(([fmt]) => formats.has(fmt)).map(([, label, q]) => ({
        quality: label,
        url: `${base}?quality=${q}&autoplay=1`,
        type: 'hls' as const,
      }));
    } catch {
      /* metadata fetch failed — fall back to a sensible default ladder below */
    }
    if (sources.length === 0) {
      sources = [
        { quality: '1080p', url: `${base}?quality=1080&autoplay=1`, type: 'hls' },
        { quality: '720p', url: `${base}?quality=720&autoplay=1`, type: 'hls' },
        { quality: '480p', url: `${base}?quality=480&autoplay=1`, type: 'hls' },
      ];
    }
    // "Auto" lets the player adapt to bandwidth as a last entry.
    sources.push({ quality: 'Auto', url: `${base}?quality=auto&autoplay=1`, type: 'hls' });

    return {
      anime_title: title,
      anime_slug: '',
      episode_number: null,
      sources,
      prev_episode_slug: null,
      next_episode_slug: null,
      embed_url: sources[0]!.url,
    };
  }
}
