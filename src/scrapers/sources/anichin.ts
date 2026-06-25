/**
 * Source adapter: anichin (donghua, backup) — https://anichin.moe
 *
 * Why this file exists:
 * Live-verified (June 2026) to be the same Dooplay/Dailymotion theme as donghub
 * (top-level `/<slug>/` detail, `.eplister` episodes, `#pembed` Dailymotion
 * player). It reuses the entire DonghubAdapter scraping logic — only the id
 * differs — so it's a thin subclass added as a donghua failover source.
 */
import type { SourceId } from '../../config';
import { DonghubAdapter } from './donghub';

export class AnichinAdapter extends DonghubAdapter {
  override readonly id: SourceId = 'anichin';
}
