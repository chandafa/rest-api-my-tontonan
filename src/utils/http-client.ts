/**
 * HTTP client for scraping — native `fetch` (SDD sec. 10 / 13).
 *
 * Why this file exists (and why NOT axios):
 * Every scraper needs an HTTP client pointed at its source domain with a
 * realistic browser User-Agent, `id-ID` Accept-Language, a matching Referer, and
 * a timeout under Vercel's 60s cap. This uses Node's built-in `fetch` instead of
 * axios on purpose: axios pulls in CJS-only deps (form-data/combined-stream)
 * that crash when Vercel bundles the function as ESM ("Dynamic require not
 * supported"). `fetch` has zero such deps and works in any bundle format.
 */
import { config } from '../config';
import type { AnimeSource } from '../config';
import { logger } from './logger';

/** A lightweight client: just the base URL + default headers for a source. */
export interface HttpClient {
  baseUrl: string;
  headers: Record<string, string>;
}

export interface RequestOptions {
  responseType?: 'json' | 'text';
  headers?: Record<string, string>;
}

/** A small pool of realistic desktop User-Agents to look less bot-like. */
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
];

let uaCounter = 0;

function pickUserAgent(): string {
  const idx = Math.abs(uaCounter++) % USER_AGENTS.length;
  return USER_AGENTS[idx] ?? USER_AGENTS[0]!;
}

/** Create a client bound to a single source's base URL. */
export function createSourceClient(source: AnimeSource): HttpClient {
  return {
    baseUrl: source.baseUrl,
    headers: {
      'User-Agent': pickUserAgent(),
      'Accept-Language': 'id-ID,id;q=0.9,en;q=0.8',
      Accept:
        'text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.7',
      Referer: source.baseUrl,
      'Cache-Control': 'no-cache',
    },
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryable(err: unknown): boolean {
  if (err instanceof Error) {
    if (err.name === 'AbortError' || err.name === 'TypeError') return true; // timeout/network
    const code = (err as { code?: string }).code ?? '';
    return ['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'UND_ERR'].some((c) =>
      code.includes(c),
    );
  }
  return false;
}

/**
 * GET a path (relative or absolute) from a source with one transient retry.
 * Returns the body as text (default) or parsed JSON (`responseType: 'json'`).
 * Throws on 4xx/5xx or network failure so the orchestrator can fail over.
 */
export async function sourceGet<T = string>(
  client: HttpClient,
  path: string,
  options?: RequestOptions,
): Promise<T> {
  // Relative paths resolve against the base; absolute URLs (megaplay, dailymotion)
  // pass through unchanged.
  const url = new URL(path, client.baseUrl).toString();
  const headers = { ...client.headers, ...(options?.headers ?? {}) };
  const maxAttempts = 2;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.httpTimeoutMs);
    try {
      const res = await fetch(url, { headers, redirect: 'follow', signal: controller.signal });
      clearTimeout(timer);

      if (res.status >= 500) {
        if (attempt < maxAttempts) {
          logger.warn('http retry (5xx)', { url: path, attempt, status: res.status });
          await delay(300 * attempt);
          continue;
        }
        throw new Error(`HTTP ${res.status} for ${path}`);
      }
      if (res.status >= 400) {
        // 4xx is definitive (e.g. 404) — surface it, don't retry.
        const err = new Error(`HTTP ${res.status} for ${path}`) as Error & { status?: number };
        err.status = res.status;
        throw err;
      }

      return (options?.responseType === 'json' ? await res.json() : await res.text()) as T;
    } catch (err) {
      clearTimeout(timer);
      lastError = err;
      if (attempt < maxAttempts && isRetryable(err)) {
        logger.warn('http retry (network)', { url: path, attempt });
        await delay(300 * attempt);
        continue;
      }
      break;
    }
  }
  throw lastError;
}
