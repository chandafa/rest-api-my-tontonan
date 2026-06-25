/**
 * Route: GET /api/home (SDD sec. 9.2).
 *
 * Why this file exists:
 * Thin HTTP layer over the scraper façade — it does NO parsing (SDD rule
 * "never mix parsing logic with routes"). The failover orchestrator picks a
 * healthy source; this just serializes the normalized result and applies the
 * short-lived in-memory cache to spare the upstream sites.
 */
import { Hono } from 'hono';
import { responseCache } from '../middleware/cache';
import { scrapeHome } from '../scrapers/home-scraper';

const home = new Hono();

home.get('/', responseCache(), async (c) => {
  const data = await scrapeHome();
  return c.json(data);
});

export default home;
