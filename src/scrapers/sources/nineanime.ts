/**
 * Source adapter: 9anime.org.lv (anime mirror) — dramastream theme.
 * Thin subclass; same scraping as aniwatch.
 */
import type { SourceId } from '../../config';
import { DramastreamAdapter } from './dramastream';

export class NineAnimeAdapter extends DramastreamAdapter {
  readonly id: SourceId = 'nineanime';
}
