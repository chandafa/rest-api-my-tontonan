/**
 * Source adapter: animeplaytv (secondary) — https://animeplaytv.com
 *
 * Live-verified (June 2026) to run the shared "dramastream" WordPress theme, so
 * this is a thin subclass that only declares its id. All parsing lives in
 * DramastreamAdapter; override `sel`/methods here if this mirror diverges.
 */
import type { SourceId } from '../../config';
import { DramastreamAdapter } from './dramastream';

export class AnimeplaytvAdapter extends DramastreamAdapter {
  readonly id: SourceId = 'animeplaytv';
}
