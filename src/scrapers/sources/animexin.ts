/**
 * Source adapter: animexin (donghua) — https://animexin.dev
 *
 * Why this file exists:
 * animexin is a SISTER site of anichin (same operator) and runs the identical
 * Dooplay/Dailymotion theme verified for donghub: top-level `/<slug>/` detail,
 * `.eplister` episode lists, `#pembed` Dailymotion player (+ ok.ru/streamwish
 * mirrors). It therefore reuses the entire DonghubAdapter scraping logic — only
 * the id/baseUrl differ — and joins the donghua union/merge chain.
 */
import type { SourceId } from '../../config';
import { DonghubAdapter } from './donghub';

export class AnimexinAdapter extends DonghubAdapter {
  override readonly id: SourceId = 'animexin';
}
