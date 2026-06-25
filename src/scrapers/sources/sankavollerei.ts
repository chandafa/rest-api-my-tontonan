/**
 * Source adapter: sankavollerei (anime, source #4) — sankavollerei.web.id
 *
 * Why this file exists:
 * An independent JSON API (backed by otakudesu) added as the 4th anime source,
 * giving a different catalog than the dramastream mirror. Listings/detail are
 * rich JSON; episode streams are otakudesu embeds (desustream), resolved
 * best-effort to a direct .m3u8/.mp4 — so it's the LAST failover (dramastream
 * stays the primary, reliably-playable anime path).
 *
 * API base: <baseUrl>/anime/... (live-verified June 2026).
 * Native slugs: anime = animeId, episode = episodeId (both otakudesu slugs).
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
  status?: string;
  data?: T;
}
interface SvAnimeCard {
  title?: string;
  poster?: string;
  status?: string;
  score?: string;
  episodes?: number;
  animeId?: string;
  latestReleaseDate?: string;
  genreList?: { title?: string }[];
}
interface SvHome {
  ongoing?: { animeList?: SvAnimeCard[] };
  complete?: { animeList?: SvAnimeCard[] };
}
interface SvDetail {
  title?: string;
  poster?: string;
  score?: string;
  status?: string;
  aired?: string;
  synopsis?: { paragraphs?: string[] };
  genreList?: { title?: string }[];
  episodeList?: { title?: string; eps?: number; episodeId?: string; date?: string }[];
}
interface SvServerItem {
  title?: string;
  serverId?: string;
}
interface SvEpisode {
  title?: string;
  animeId?: string;
  defaultStreamingUrl?: string;
  prevEpisode?: { episodeId?: string };
  nextEpisode?: { episodeId?: string };
  server?: { qualities?: { title?: string; serverList?: SvServerItem[] }[] };
}

export class SankavollereiAdapter extends BaseAdapter {
  readonly id: SourceId = 'sankavollerei';

  private async apiGet<T>(path: string): Promise<T | null> {
    const res = await sourceGet<ApiEnvelope<T>>(this.client, path, { responseType: 'json' });
    return res?.data ?? null;
  }

  private toListItem(c: SvAnimeCard): AnimeListItem | null {
    if (!c.animeId || !c.title) return null;
    return {
      title: c.title,
      slug: this.enc(c.animeId),
      cover: c.poster ?? '',
      latest_episode: c.episodes ?? null,
      status: c.status ?? '',
    };
  }

  async scrapeHome(): Promise<HomeData> {
    const home = await this.apiGet<SvHome>('/anime/home');
    const ongoingCards = home?.ongoing?.animeList ?? [];
    const completeCards = home?.complete?.animeList ?? [];

    const ongoing = ongoingCards
      .map((c) => this.toListItem(c))
      .filter((x): x is AnimeListItem => x !== null);

    const latest: LatestEpisodeItem[] = ongoingCards
      .filter((c) => c.animeId && c.title)
      .map((c) => ({
        anime_title: c.title!,
        anime_slug: this.enc(c.animeId!),
        episode_slug: this.enc(c.animeId!), // ongoing cards lack an episode slug
        episode_number: c.episodes ?? null,
        upload_date: c.latestReleaseDate ?? '',
        cover: c.poster ?? '',
      }));

    let popular = completeCards
      .map((c) => this.toListItem(c))
      .filter((x): x is AnimeListItem => x !== null);
    if (popular.length === 0) {
      const complete = await this.apiGet<{ animeList?: SvAnimeCard[] }>('/anime/complete-anime');
      popular = (complete?.animeList ?? [])
        .map((c) => this.toListItem(c))
        .filter((x): x is AnimeListItem => x !== null);
    }

    if (ongoing.length === 0 && latest.length === 0 && popular.length === 0) {
      throw new ScrapeParseError('sankavollerei home returned no items');
    }
    return { ongoing, latest: latest.slice(0, 30), popular: popular.slice(0, 20) };
  }

  async scrapeSearch(query: string): Promise<SearchResultItem[]> {
    const data = await this.apiGet<{ animeList?: SvAnimeCard[] }>(
      `/anime/search/${encodeURIComponent(query)}`,
    );
    return (data?.animeList ?? [])
      .filter((c) => c.animeId && c.title)
      .map((c) => ({
        title: c.title!,
        slug: this.enc(c.animeId!),
        cover: c.poster ?? '',
        status: c.status ?? '',
        genre: (c.genreList ?? []).map((g) => g.title ?? '').filter(Boolean),
      }));
  }

  async scrapeAnime(nativeSlug: string): Promise<AnimeDetail> {
    const d = await this.apiGet<SvDetail>(`/anime/anime/${nativeSlug}`);
    if (!d?.title) throw new NotFoundError(`sankavollerei anime not found: ${nativeSlug}`);

    const episodes: EpisodeListItem[] = (d.episodeList ?? [])
      .filter((e) => e.episodeId)
      .map((e) => ({
        slug: this.enc(e.episodeId!),
        number: e.eps ?? parseNumber(e.title),
        title: e.title ?? `Episode ${e.eps ?? ''}`.trim(),
        upload_date: e.date ?? '',
      }))
      .reverse(); // API lists newest-first; expose ascending.

    const yearMatch = (d.aired ?? '').match(/\b(19|20)\d{2}\b/);
    return {
      title: d.title,
      slug: this.enc(nativeSlug),
      cover: d.poster ?? '',
      synopsis: (d.synopsis?.paragraphs ?? []).join('\n\n'),
      genre: (d.genreList ?? []).map((g) => g.title ?? '').filter(Boolean),
      status: d.status ?? 'Unknown',
      year: yearMatch ? Number(yearMatch[0]) : null,
      rating: d.score && d.score.trim() ? d.score : 'N/A',
      total_episodes: episodes.length,
      episodes,
    };
  }

  async scrapeEpisode(nativeSlug: string): Promise<EpisodeData> {
    const e = await this.apiGet<SvEpisode>(`/anime/episode/${nativeSlug}`);
    if (!e) throw new NotFoundError(`sankavollerei episode not found: ${nativeSlug}`);

    const sources = await this.resolveSources(e);
    if (sources.length === 0) {
      throw new ScrapeParseError(`sankavollerei could not extract a stream for ${nativeSlug}`);
    }

    const title = e.title ?? '';
    return {
      anime_title: title.replace(/\s*Episode\s+\d+.*$/i, '').trim() || title,
      anime_slug: this.enc(e.animeId ?? nativeSlug),
      episode_number: parseNumber(title.match(/Episode\s+(\d+)/i)?.[1]),
      sources,
      prev_episode_slug: e.prevEpisode?.episodeId ? this.enc(e.prevEpisode.episodeId) : null,
      next_episode_slug: e.nextEpisode?.episodeId ? this.enc(e.nextEpisode.episodeId) : null,
    };
  }

  /** Resolve the default embed (and a couple of server embeds) to direct URLs. */
  private async resolveSources(e: SvEpisode): Promise<VideoSource[]> {
    const collected: VideoSource[] = [];

    const tryEmbed = async (url: string, quality: string) => {
      try {
        const html = await sourceGet<string>(this.client, url);
        collected.push(...extractStreamUrls(html).map((s) => ({ ...s, quality })));
      } catch {
        /* unreachable embed */
      }
    };

    if (e.defaultStreamingUrl) await tryEmbed(e.defaultStreamingUrl, 'default');

    // Fall back to resolving up to 2 server entries via /anime/server/:id.
    if (collected.length === 0) {
      const servers = (e.server?.qualities ?? [])
        .flatMap((q) => (q.serverList ?? []).map((s) => ({ id: s.serverId, q: q.title })))
        .filter((s): s is { id: string; q: string } => Boolean(s.id))
        .slice(0, 2);
      for (const s of servers) {
        const data = await this.apiGet<{ url?: string }>(`/anime/server/${s.id}`);
        if (data?.url) await tryEmbed(data.url, s.q || 'auto');
        if (collected.length > 0) break;
      }
    }

    return dedupeAndSortSources(collected);
  }
}
