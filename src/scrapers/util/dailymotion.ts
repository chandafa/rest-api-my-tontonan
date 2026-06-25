/**
 * Dailymotion helper (donghua support).
 *
 * Why this file exists:
 * donghub/anichin embed donghua via Dailymotion. We extract the video id from
 * the embed markup and build quality-explicit embed URLs (?quality=1080) that
 * the in-app WebView plays — the direct CDN manifest is token-locked, so the
 * embed is the reliable path.
 */

/** Pull a Dailymotion video id out of any embed URL/markup. */
export function dailymotionId(input?: string | null): string | null {
  if (!input) return null;
  const m = input.match(/(?:[?&]video=|\/video\/|\/embed\/video\/)([A-Za-z0-9]+)/);
  return m ? m[1]! : null;
}

interface DmSource {
  quality: string;
  url: string;
  type: 'hls';
}

// Dailymotion `available_formats` token -> { app label, embed `quality=` value },
// best-first (so sources[0] is the highest available).
const DM_FORMAT_MAP: ReadonlyArray<readonly [string, string, string]> = [
  ['uhd2160', '2160p (4K)', '2160'],
  ['uhd1440', '1440p (2K)', '1440'],
  ['hd1080', '1080p', '1080'],
  ['hd720', '720p', '720'],
  ['hq', '480p', '480'],
  ['sd', '360p', '360'],
];

const DM_DEFAULT_LADDER: ReadonlyArray<readonly [string, string]> = [
  ['1080p', '1080'],
  ['720p', '720'],
  ['480p', '480'],
];

/**
 * Build ad-free Dailymotion embed sources for a video id. Queries the public
 * Data API for the video's REAL renditions so 1440p/2160p (4K) are exposed when
 * the upload has them; falls back to a safe 1080p ladder if the API is empty or
 * unreachable. Always appends an "Auto" entry. The in-app WebView uses a desktop
 * UA so Dailymotion serves the requested quality.
 */
export async function buildDailymotionSources(videoId: string): Promise<DmSource[]> {
  const base = `https://www.dailymotion.com/embed/video/${videoId}`;
  const make = (label: string, q: string): DmSource => ({
    quality: label,
    url: `${base}?quality=${q}&autoplay=1`,
    type: 'hls',
  });

  let sources: DmSource[] = [];
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    const res = await fetch(
      `https://api.dailymotion.com/video/${videoId}?fields=available_formats`,
      { signal: controller.signal },
    );
    clearTimeout(timer);
    if (res.ok) {
      const data = (await res.json()) as { available_formats?: string[] };
      const have = new Set(data.available_formats ?? []);
      sources = DM_FORMAT_MAP.filter(([fmt]) => have.has(fmt)).map(([, label, q]) => make(label, q));
    }
  } catch {
    /* API blocked/slow — use the default ladder below */
  }
  if (sources.length === 0) {
    sources = DM_DEFAULT_LADDER.map(([label, q]) => make(label, q));
  }
  sources.push(make('Auto', 'auto'));
  return sources;
}
