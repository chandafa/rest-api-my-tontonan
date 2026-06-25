/**
 * Centralized runtime configuration.
 *
 * Why this file exists:
 * The SDD (sec. 13) requires that the target website URL is NOT exposed to the
 * Flutter client and lives in one place so a domain change touches a single file.
 * Everything reads from environment variables (set in Vercel project settings or
 * a local .env — see .env.example) with safe defaults so the app boots even with
 * zero configuration.
 */

function envInt(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Stable identifiers for each supported source site. Each id maps to a dedicated
 * scraper adapter (Phase 3) that knows how to parse THAT site's HTML/API. The
 * failover orchestrator tries them in array order until one succeeds.
 */
export type SourceId =
  | 'aniwatch'
  | 'animeplaytv'
  | 'animepahe'
  | 'anixpl'
  | 'nineanime'
  | 'sankavollerei'
  | 'anichinro'
  | 'donghub'
  | 'anichin'
  | 'sankadonghua'
  | 'iyengar'
  | 'evilseniors';

export interface AnimeSource {
  id: SourceId;
  baseUrl: string;
}

function envSources(): AnimeSource[] {
  // Order = failover priority. Override per-source via env if a domain moves.
  // The first three are the shared "dramastream" mirror (reliable playback);
  // sankavollerei is an independent otakudesu JSON API added as the 4th backup.
  return [
    // Order = benchmark result (fastest data + working episodes first).
    { id: 'aniwatch', baseUrl: process.env.SOURCE_ANIWATCH_URL ?? 'https://ww2.aniwatch.fit' },
    { id: 'animeplaytv', baseUrl: process.env.SOURCE_ANIMEPLAYTV_URL ?? 'https://animeplaytv.com' },
    { id: 'animepahe', baseUrl: process.env.SOURCE_ANIMEPAHE_URL ?? 'https://animepahe.ch' },
    {
      id: 'sankavollerei',
      baseUrl: process.env.SOURCE_SANKAVOLLEREI_URL ?? 'https://www.sankavollerei.web.id',
    },
    // Slow in benchmark — kept only as last-resort backups.
    { id: 'nineanime', baseUrl: process.env.SOURCE_NINEANIME_URL ?? 'https://9anime.org.lv' },
    { id: 'anixpl', baseUrl: process.env.SOURCE_ANIXPL_URL ?? 'https://anix.com.pl' },
  ];
}

function envDonghuaSources(): AnimeSource[] {
  // Donghua failover chain. donghub.vip is primary because it yields playable
  // Dailymotion streams end-to-end; sankavollerei's donghua JSON API is the
  // backup catalog (its anichin embeds are anti-debug and rarely playable).
  return [
    // Order = benchmark result: donghub fastest data + working + Dailymotion.
    { id: 'donghub', baseUrl: process.env.SOURCE_DONGHUB_URL ?? 'https://donghub.vip' },
    { id: 'anichin', baseUrl: process.env.SOURCE_ANICHIN_URL ?? 'https://anichin.moe' },
    { id: 'anichinro', baseUrl: process.env.SOURCE_ANICHINRO_URL ?? 'https://anichin.ro' },
    {
      id: 'sankadonghua',
      baseUrl: process.env.SOURCE_SANKAVOLLEREI_URL ?? 'https://www.sankavollerei.web.id',
    },
  ];
}

export const config = {
  /**
   * Ordered list of source sites (primary first). The failover orchestrator
   * (Phase 3) iterates this list: if the primary is down / blocks the IP / fails
   * to parse, it automatically falls through to the next one.
   */
  sources: envSources(),

  /** Donghua source failover chain (primary first). */
  donghuaSources: envDonghuaSources(),

  /**
   * Film/movie source failover chain (primary first). Both run the SAME generic
   * GMR/muvipro adapter; iyengar is the verified primary, evilseniors the backup
   * (a different live GMR site found as a fallback if the primary moves/blocks).
   */
  filmSources: [
    { id: 'iyengar' as SourceId, baseUrl: process.env.SOURCE_IYENGAR_URL ?? 'https://iyengaryogacenter.com' },
    { id: 'evilseniors' as SourceId, baseUrl: process.env.SOURCE_EVILSENIORS_URL ?? 'https://evilseniors.com' },
  ],

  /** Allowed CORS origins. Empty array => allow all ('*'). */
  corsOrigins: (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),

  /** Default TTL for the in-memory response cache, in seconds. */
  cacheTtlSeconds: envInt('CACHE_TTL_SECONDS', 300),

  /** Rate limiter window settings (per client IP). */
  rateLimit: {
    max: envInt('RATE_LIMIT_MAX', 60),
    windowSeconds: envInt('RATE_LIMIT_WINDOW_SECONDS', 60),
  },

  /** Axios request timeout in ms — kept well under the Vercel 60s function cap. */
  httpTimeoutMs: envInt('HTTP_TIMEOUT_MS', 15000),
} as const;

export type AppConfig = typeof config;
