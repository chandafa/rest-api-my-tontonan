/**
 * Shared parsing helpers for all adapters (Phase 3).
 *
 * Why this file exists:
 * Cleaning text, resolving relative URLs, pulling slugs out of hrefs, and
 * sniffing stream URLs/types are needed identically by every adapter. Keeping
 * them here means adapters contain ONLY their site-specific selectors, exactly
 * as the SDD scraper rules require ("never mix parsing logic with routes",
 * selectors isolated per source).
 */
import type { VideoSource } from '../types';

/** Collapse whitespace and trim. Always returns a string. */
export function cleanText(input?: string | null): string {
  return (input ?? '').replace(/\s+/g, ' ').trim();
}

/** Resolve a (possibly relative or protocol-relative) URL against a base. */
export function absoluteUrl(base: string, url?: string | null): string {
  if (!url) return '';
  const trimmed = url.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('//')) return `https:${trimmed}`;
  try {
    return new URL(trimmed, base).toString();
  } catch {
    return trimmed;
  }
}

/** Last meaningful path segment of an href, e.g. /anime/one-piece/ -> one-piece. */
export function lastPathSegment(href?: string | null): string {
  if (!href) return '';
  const noQuery = href.split(/[?#]/)[0] ?? '';
  const parts = noQuery.replace(/\/+$/, '').split('/').filter(Boolean);
  return parts.length ? (parts[parts.length - 1] ?? '') : '';
}

/** First integer/decimal found in a string (e.g. "Episode 1135" -> 1135). */
export function parseNumber(text?: string | null): number | null {
  if (!text) return null;
  const match = text.match(/(\d+(?:\.\d+)?)/);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

/** Trailing numeric id of a slug, e.g. "one-piece-100" -> "100". */
export function trailingId(slug: string): string {
  const match = slug.match(/(\d+)$/);
  return match ? match[1]! : '';
}

/** Classify a media URL as HLS (.m3u8) or MP4 for the SDD `type` field. */
export function detectStreamType(url: string): 'mp4' | 'hls' {
  return /\.m3u8(\?|$)/i.test(url) ? 'hls' : 'mp4';
}

/**
 * Best-effort extraction of direct stream URLs from any text blob (HTML, JS,
 * JSON). Video extraction is the SDD's most fragile area; this regex pass finds
 * `.m3u8`/`.mp4` links that many embed pages expose inline. Returns de-duped,
 * type-tagged sources (quality unknown -> labeled "auto"/"default").
 */
export function extractStreamUrls(raw: string): VideoSource[] {
  const found = new Map<string, VideoSource>();
  const regex = /https?:\\?\/\\?\/[^\s"'<>()]+?\.(?:m3u8|mp4)(?:\?[^\s"'<>()]*)?/gi;
  const matches = raw.match(regex) ?? [];
  for (const rawUrl of matches) {
    const url = rawUrl.replace(/\\\//g, '/');
    if (found.has(url)) continue;
    const type = detectStreamType(url);
    found.set(url, { quality: type === 'hls' ? 'auto' : 'default', url, type });
  }
  return [...found.values()];
}

/** De-duplicate video sources by URL, preserving first occurrence/order. */
export function dedupeSources(sources: VideoSource[]): VideoSource[] {
  const seen = new Set<string>();
  const out: VideoSource[] = [];
  for (const s of sources) {
    if (!s.url || seen.has(s.url)) continue;
    seen.add(s.url);
    out.push(s);
  }
  return out;
}

/**
 * Numeric "quality score" for a source so the highest resolution can be picked
 * automatically (user requirement). 1080p > 720p > 480p > 360p; an adaptive HLS
 * "auto" manifest is ranked just below 1080 since it serves the best available.
 */
export function qualityScore(s: VideoSource): number {
  const m = s.quality.match(/(\d{3,4})\s*p/i);
  if (m) return Number(m[1]);
  const q = s.quality.toLowerCase();
  if (q.includes('1080') || q.includes('fhd') || q.includes('full')) return 1080;
  if (q.includes('720') || q.includes('hd')) return 720;
  if (q.includes('480') || q.includes('sd')) return 480;
  if (q.includes('360')) return 360;
  if (s.type === 'hls' || q.includes('auto')) return 1000; // adaptive ~ best
  return 500;
}

/** De-dupe AND sort sources highest-resolution first (best default quality). */
export function dedupeAndSortSources(sources: VideoSource[]): VideoSource[] {
  return dedupeSources(sources).sort((a, b) => qualityScore(b) - qualityScore(a));
}
