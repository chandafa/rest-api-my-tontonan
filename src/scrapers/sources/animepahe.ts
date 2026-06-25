/**
 * Source adapter: animepahe (tertiary) — https://animepahe.ch
 *
 * Live-verified (June 2026): despite the name, this domain currently serves the
 * shared "dramastream" WordPress theme (NOT the historical animepahe JSON API),
 * so it parses identically to the other two. Thin subclass that only declares
 * its id; override `sel`/methods here if this mirror diverges.
 */
import type { SourceId } from '../../config';
import { DramastreamAdapter } from './dramastream';

export class AnimepaheAdapter extends DramastreamAdapter {
  readonly id: SourceId = 'animepahe';
}
