/**
 * SDD-named scraper façade (sec. 4.2 `home-scraper.ts`).
 * Keeps the SDD file map intact while delegating the actual work to the
 * failover orchestrator. Routes import from here, never from adapters.
 */
export { scrapeHome } from './orchestrator';
