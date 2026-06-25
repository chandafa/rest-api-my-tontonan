/**
 * Source adapter: anix.com.pl (anime mirror) — dramastream theme.
 * Thin subclass; same scraping as aniwatch.
 */
import type { SourceId } from '../../config';
import { DramastreamAdapter } from './dramastream';

export class AnixPlAdapter extends DramastreamAdapter {
  readonly id: SourceId = 'anixpl';
}
