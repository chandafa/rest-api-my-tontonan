/**
 * Source adapter contract + slug codec + shared base class (Phase 3 core).
 *
 * Why this file exists:
 * The 3-domain failover requirement means each site needs its own parser but a
 * SHARED interface so the orchestrator can treat them interchangeably. This file
 * defines that interface (`SourceAdapter`), a `BaseAdapter` that lazily builds
 * the per-source Axios client, and the slug codec that namespaces every slug
 * with its owning source id so the orchestrator can route detail/episode
 * requests back to the exact adapter that produced them.
 */
import type { AnimeSource, SourceId } from '../config';
import type { HttpClient } from '../utils/http-client';
import { createSourceClient } from '../utils/http-client';
import type {
  AnimeDetail,
  EpisodeData,
  HomeData,
  SearchResultItem,
} from './types';

export interface SourceAdapter {
  readonly id: SourceId;
  /** Front page: ongoing + latest episodes + popular. */
  scrapeHome(): Promise<HomeData>;
  /** Realtime search by free-text query. */
  scrapeSearch(query: string): Promise<SearchResultItem[]>;
  /** Anime detail + full episode list. `nativeSlug` is THIS source's own slug. */
  scrapeAnime(nativeSlug: string): Promise<AnimeDetail>;
  /** Episode playable sources + prev/next. `nativeSlug` is THIS source's own. */
  scrapeEpisode(nativeSlug: string): Promise<EpisodeData>;
}

// --- Slug namespacing --------------------------------------------------------
// Public slugs look like "aniwatch::one-piece-100". The native part is URL-
// component-encoded so it can safely contain '/', spaces, etc. and still travel
// as a single path segment in GET /api/anime/:slug.
const SEPARATOR = '::';

export function encodeSlug(source: SourceId, native: string): string {
  return `${source}${SEPARATOR}${encodeURIComponent(native)}`;
}

export function decodeSlug(slug: string): { source: SourceId; native: string } | null {
  const idx = slug.indexOf(SEPARATOR);
  if (idx === -1) return null;
  const source = slug.slice(0, idx) as SourceId;
  const native = decodeURIComponent(slug.slice(idx + SEPARATOR.length));
  if (!source || !native) return null;
  return { source, native };
}

// --- Shared base -------------------------------------------------------------
export abstract class BaseAdapter implements SourceAdapter {
  abstract readonly id: SourceId;
  protected readonly source: AnimeSource;
  private _client?: HttpClient;

  constructor(source: AnimeSource) {
    this.source = source;
  }

  /** Lazily-created HTTP client bound to this source's base URL. */
  protected get client(): HttpClient {
    if (!this._client) this._client = createSourceClient(this.source);
    return this._client;
  }

  /** Wrap a native slug with this source's prefix for outbound payloads. */
  protected enc(native: string): string {
    return encodeSlug(this.id, native);
  }

  abstract scrapeHome(): Promise<HomeData>;
  abstract scrapeSearch(query: string): Promise<SearchResultItem[]>;
  abstract scrapeAnime(nativeSlug: string): Promise<AnimeDetail>;
  abstract scrapeEpisode(nativeSlug: string): Promise<EpisodeData>;
}
