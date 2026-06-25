/**
 * In-memory response cache (SDD sec. 10 "Cache Sederhana" + sec. 13).
 *
 * Why this file exists:
 * Scraping is slow and the target sites may rate-limit our IP, so we cache
 * successful JSON responses per-URL for a short TTL. This reduces upstream
 * requests within a warm function instance. Per the SDD, this cache is
 * intentionally in-memory and is lost on cold start — acceptable for a
 * personal-scale Hobby deployment; no paid KV is introduced.
 *
 * Exposes both the raw helpers from the SDD (getCached/setCache) and a Hono
 * middleware that wires them onto GET routes.
 */
import type { MiddlewareHandler } from 'hono';
import { config } from '../config';

interface CacheEntry {
  data: unknown;
  expiry: number;
}

const store = new Map<string, CacheEntry>();

/** Return cached value if present and unexpired, else null (SDD signature). */
export function getCached<T = unknown>(key: string): T | null {
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() >= entry.expiry) {
    store.delete(key);
    return null;
  }
  return entry.data as T;
}

/** Store a value with a TTL in seconds (SDD signature; default from config). */
export function setCache(key: string, data: unknown, ttlSeconds: number = config.cacheTtlSeconds): void {
  store.set(key, { data, expiry: Date.now() + ttlSeconds * 1000 });
}

/** Manual invalidation (useful for episode endpoints with volatile URLs). */
export function clearCache(key?: string): void {
  if (key) store.delete(key);
  else store.clear();
}

/**
 * Hono middleware: serves a cached JSON body on hit, otherwise runs the handler
 * and caches a 200 JSON response. Keyed by full request URL (query included).
 * Non-GET requests and non-200/non-JSON responses are passed through untouched.
 */
export function responseCache(ttlSeconds: number = config.cacheTtlSeconds): MiddlewareHandler {
  return async (c, next) => {
    if (c.req.method !== 'GET') return next();

    const key = c.req.url;
    const hit = getCached(key);
    if (hit !== null) {
      c.header('X-Cache', 'HIT');
      return c.json(hit as object);
    }

    await next();

    if (c.res.status === 200) {
      try {
        const data = await c.res.clone().json();
        setCache(key, data, ttlSeconds);
        c.res.headers.set('X-Cache', 'MISS');
      } catch {
        // Response was not JSON — nothing to cache.
      }
    }
  };
}
