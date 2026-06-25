/**
 * Per-IP rate limiter (SDD sec. 2 middleware list + sec. 13).
 *
 * Why this file exists:
 * Protects our own Vercel invocation budget (~100K/month on Hobby) and reduces
 * the chance the target sites block our IP for hammering them. Uses a simple
 * fixed-window counter in memory — like the cache, it resets on cold start,
 * which is fine at personal scale and avoids any paid datastore.
 */
import type { MiddlewareHandler } from 'hono';
import { config } from '../config';

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

/** Best-effort client IP from Vercel/proxy headers. */
function clientIp(headerGet: (name: string) => string | undefined): string {
  const fwd = headerGet('x-forwarded-for');
  if (fwd) return fwd.split(',')[0]!.trim();
  return headerGet('x-real-ip') ?? 'unknown';
}

/** Opportunistically drop expired buckets so the map can't grow unbounded. */
function sweep(now: number): void {
  if (buckets.size < 1000) return;
  for (const [ip, b] of buckets) {
    if (now > b.resetAt) buckets.delete(ip);
  }
}

export function rateLimit(
  max: number = config.rateLimit.max,
  windowSeconds: number = config.rateLimit.windowSeconds,
): MiddlewareHandler {
  const windowMs = windowSeconds * 1000;

  return async (c, next) => {
    const now = Date.now();
    sweep(now);

    const ip = clientIp((name) => c.req.header(name));
    let bucket = buckets.get(ip);
    if (!bucket || now > bucket.resetAt) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(ip, bucket);
    }
    bucket.count += 1;

    const remaining = Math.max(0, max - bucket.count);
    c.header('X-RateLimit-Limit', String(max));
    c.header('X-RateLimit-Remaining', String(remaining));

    if (bucket.count > max) {
      const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
      c.header('Retry-After', String(retryAfter));
      return c.json(
        { error: 'RATE_LIMITED', message: 'Too many requests, please slow down.' },
        429,
      );
    }

    await next();
  };
}
