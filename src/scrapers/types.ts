/**
 * Normalized scraper output types (SDD sec. 9.2).
 *
 * Why this file exists:
 * Every source adapter (aniwatch/animeplaytv/animepahe) returns DIFFERENT raw
 * HTML/JSON. These interfaces are the single normalized contract that all
 * adapters must produce and that the API routes serialize verbatim — they match
 * the SDD endpoint examples 1:1, so the Flutter models never have to care which
 * source served a given request.
 *
 * Slug convention: every `slug`/`*_slug` field emitted here is SOURCE-PREFIXED
 * (e.g. "aniwatch::one-piece-100"), so the client can hand it back and the
 * orchestrator routes it to the correct adapter (see source-adapter.ts).
 */

/** A card in the "ongoing" / "popular" lists (SDD /api/home). */
export interface AnimeListItem {
  title: string;
  slug: string;
  cover: string;
  latest_episode: number | null;
  status: string;
}

/** A "latest episode" row (SDD /api/home `latest`). */
export interface LatestEpisodeItem {
  anime_title: string;
  anime_slug: string;
  episode_slug: string;
  episode_number: number | null;
  upload_date: string;
  /** Cover/thumbnail (added so the home "Latest" rail can show posters). */
  cover: string;
}

/** Top-level /api/home payload. */
export interface HomeData {
  ongoing: AnimeListItem[];
  latest: LatestEpisodeItem[];
  popular: AnimeListItem[];
}

/** A search result row (SDD /api/search). */
export interface SearchResultItem {
  title: string;
  slug: string;
  cover: string;
  status: string;
  genre: string[];
}

/** An episode row inside anime detail (SDD /api/anime/:slug `episodes`). */
export interface EpisodeListItem {
  slug: string;
  number: number | null;
  title: string;
  upload_date: string;
}

/** Full anime detail payload (SDD /api/anime/:slug). */
export interface AnimeDetail {
  title: string;
  slug: string;
  cover: string;
  synopsis: string;
  genre: string[];
  status: string;
  year: number | null;
  rating: string;
  total_episodes: number;
  episodes: EpisodeListItem[];
}

/** A single playable source (SDD /api/episode/:slug `sources`). */
export interface VideoSource {
  quality: string;
  url: string;
  type: 'mp4' | 'hls';
}

/** Full episode payload (SDD /api/episode/:slug). */
export interface EpisodeData {
  anime_title: string;
  anime_slug: string;
  episode_number: number | null;
  sources: VideoSource[];
  prev_episode_slug: string | null;
  next_episode_slug: string | null;
  /**
   * Optional iframe/embed URL for WebView playback (donghua). When set, the app
   * plays this in an in-app WebView instead of media_kit — used for streams
   * whose direct manifest is CDN-token-locked (e.g. Dailymotion).
   */
  embed_url?: string;
}
