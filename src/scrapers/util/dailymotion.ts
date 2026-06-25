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
