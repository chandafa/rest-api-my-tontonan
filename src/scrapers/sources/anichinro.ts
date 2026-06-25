/**
 * Source adapter: anichin.ro (donghua mirror) — Dailymotion/dramastream theme.
 * Thin subclass of DonghubAdapter; fastest-listing donghua mirror (primary).
 */
import type { SourceId } from '../../config';
import { DonghubAdapter } from './donghub';

export class AnichinRoAdapter extends DonghubAdapter {
  override readonly id: SourceId = 'anichinro';
}
