/**
 * Source adapter: sankavollerei donghua (backup) — sankavollerei.web.id
 *
 * Why this file exists:
 * The user's documented donghua JSON API (backed by anichin.cafe). Wired as the
 * BACKUP donghua source: rich catalog (home/search/detail), but its episode
 * streams are anti-debug anichin embeds that rarely yield a direct URL — so
 * donghub is primary for playback and this provides resilience when donghub is
 * down. Endpoints: <baseUrl>/anime/donghua/... (live-verified June 2026).
 *
 * Native slugs: anime = detail slug, episode = episode slug.
 */
import type { SourceId } from '../../config';
import { NotFoundError, ScrapeParseError } from '../../utils/errors';
import { sourceGet } from '../../utils/http-client';
import { BaseAdapter } from '../source-adapter';
import type {
  AnimeDetail,
  AnimeListItem,
  EpisodeData,
  EpisodeListItem,
  HomeData,
  LatestEpisodeItem,
  SearchResultItem,
  VideoSource,
} from '../types';
import { dedupeAndSortSources, extractStreamUrls, parseNumber } from '../util/parse';

interface ApiEnvelope<T> {
  data?: T;
}
interface DhCard {
  title?: string;
  slug?: string;
  poster?: string;
  status?: string;
  current_episode?: string;
}
interface DhHome {
  latest_release?: DhCard[];
  completed_donghua?: DhCard[];
  ongoing_donghua?: DhCard[];
}
interface DhDetail {
  title?: string;
  poster?: string;
  synopsis?: string;
  status?: string;
  season?: string;
  released?: string;
  rating?: string;
  genres?: { name?: string }[];
  episodes_list?: { episode?: string; slug?: string }[];
}
interface DhEpisode {
  episode?: string;
  streaming?: { main_url?: { url?: string }; servers?: { url?: string }[] };
  navigation?: { previous_episode?: { slug?: string }; next_episode?: { slug?: string } };
  donghua_details?: { title?: string; slug?: string };
}

export class SankavollereiDonghuaAdapter extends BaseAdapter {
  readonly id: SourceId = 'sankadonghua';

  private async apiGet<T>(path: string): Promise<T | null> {
    const res = await sourceGet<ApiEnvelope<T>>(this.client, path, { responseType: 'json' });
    return res?.data ?? null;
  }

  private seriesItem(c: DhCard): AnimeListItem | null {
    if (!c.slug || !c.title) return null;
    return {
      title: c.title,
      slug: this.enc(c.slug),
      cover: c.poster ?? '',
      latest_episode: parseNumber(c.current_episode),
      status: c.status ?? '',
    };
  }

  async scrapeHome(): Promise<HomeData> {
    const home = await this.apiGet<DhHome>('/anime/donghua/home/1');
    if (!home) throw new ScrapeParseError('sankadonghua home returned no data');

    const latest: LatestEpisodeItem[] = (home.latest_release ?? [])
      .filter((c) => c.slug && c.title)
      .map((c) => ({
        anime_title: c.title!.replace(/\s*Episode\s+.*$/i, '').trim() || c.title!,
        anime_slug: this.enc(c.slug!),
        episode_slug: this.enc(c.slug!),
        episode_number: parseNumber(c.current_episode),
        upload_date: '',
        cover: c.poster ?? '',
      }));

    const ongoing = (home.ongoing_donghua ?? home.completed_donghua ?? [])
      .map((c) => this.seriesItem(c))
      .filter((x): x is AnimeListItem => x !== null);
    const popular = (home.completed_donghua ?? [])
      .map((c) => this.seriesItem(c))
      .filter((x): x is AnimeListItem => x !== null);

    if (latest.length === 0 && ongoing.length === 0 && popular.length === 0) {
      throw new ScrapeParseError('sankadonghua home empty');
    }
    return {
      ongoing: ongoing.slice(0, 30),
      latest: latest.slice(0, 30),
      popular: popular.slice(0, 20),
    };
  }

  async scrapeSearch(query: string): Promise<SearchResultItem[]> {
    const data = await this.apiGet<DhCard[] | { donghua?: DhCard[]; result?: DhCard[] }>(
      `/anime/donghua/search/${encodeURIComponent(query)}`,
    );
    const list = Array.isArray(data) ? data : (data?.donghua ?? data?.result ?? []);
    return list
      .filter((c) => c.slug && c.title)
      .map((c) => ({
        title: c.title!,
        slug: this.enc(c.slug!),
        cover: c.poster ?? '',
        status: c.status ?? '',
        genre: [],
      }));
  }

  async scrapeAnime(nativeSlug: string): Promise<AnimeDetail> {
    const d = await this.apiGet<DhDetail>(`/anime/donghua/detail/${nativeSlug}`);
    if (!d?.title) throw new NotFoundError(`sankadonghua donghua not found: ${nativeSlug}`);

    const episodes: EpisodeListItem[] = (d.episodes_list ?? [])
      .filter((e) => e.slug)
      .map((e) => ({
        slug: this.enc(e.slug!),
        number: parseNumber(e.episode),
        title: e.episode ?? '',
        upload_date: '',
      }))
      .reverse();

    const yearMatch = (d.released ?? d.season ?? '').match(/\b(19|20)\d{2}\b/);
    return {
      title: d.title,
      slug: this.enc(nativeSlug),
      cover: d.poster ?? '',
      synopsis: d.synopsis ?? '',
      genre: (d.genres ?? []).map((g) => g.name ?? '').filter(Boolean),
      status: d.status ?? 'Unknown',
      year: yearMatch ? Number(yearMatch[0]) : null,
      rating: d.rating && d.rating.trim() ? d.rating : 'N/A',
      total_episodes: episodes.length,
      episodes,
    };
  }

  async scrapeEpisode(nativeSlug: string): Promise<EpisodeData> {
    const e = await this.apiGet<DhEpisode>(`/anime/donghua/episode/${nativeSlug}`);
    if (!e) throw new NotFoundError(`sankadonghua episode not found: ${nativeSlug}`);

    const sources = await this.resolveSources(e);
    const embedUrl = e.streaming?.main_url?.url ?? '';
    if (sources.length === 0 && !embedUrl) {
      throw new ScrapeParseError(`sankadonghua could not extract a stream for ${nativeSlug}`);
    }

    const title = e.episode ?? '';
    return {
      anime_title: e.donghua_details?.title ?? title.replace(/\s*Episode\s+.*$/i, '').trim(),
      anime_slug: this.enc(e.donghua_details?.slug ?? nativeSlug),
      episode_number: parseNumber(title.match(/Episode\s+(\d+)/i)?.[1]),
      sources,
      embed_url: embedUrl,
      prev_episode_slug: e.navigation?.previous_episode?.slug
        ? this.enc(e.navigation.previous_episode.slug)
        : null,
      next_episode_slug: e.navigation?.next_episode?.slug
        ? this.enc(e.navigation.next_episode.slug)
        : null,
    };
  }

  private async resolveSources(e: DhEpisode): Promise<VideoSource[]> {
    const embeds = [
      e.streaming?.main_url?.url,
      ...(e.streaming?.servers ?? []).map((s) => s.url),
    ].filter((u): u is string => Boolean(u) && u!.startsWith('http'));

    const collected: VideoSource[] = [];
    for (const embed of embeds.slice(0, 2)) {
      try {
        const html = await sourceGet<string>(this.client, embed);
        collected.push(...extractStreamUrls(html));
      } catch {
        /* anti-debug embed; skip */
      }
      if (collected.length > 0) break;
    }
    return dedupeAndSortSources(collected);
  }
}
