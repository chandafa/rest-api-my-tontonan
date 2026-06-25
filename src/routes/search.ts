/**
 * Route: GET /api/search?q=... (SDD sec. 9.2).
 *
 * Why this file exists:
 * Validates the query with @hono/zod-validator (SDD lists it as the validator),
 * then delegates to the failover search scraper. A missing/empty `q` returns a
 * clean 400 via our typed BadRequestError instead of a raw framework error.
 */
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { responseCache } from '../middleware/cache';
import { scrapeSearch } from '../scrapers/search-scraper';
import { BadRequestError } from '../utils/errors';

const querySchema = z.object({
  q: z.string().trim().min(1, 'Query parameter "q" is required'),
});

const search = new Hono();

search.get(
  '/',
  zValidator('query', querySchema, (result) => {
    if (!result.success) {
      throw new BadRequestError('Query parameter "q" is required', result.error.flatten());
    }
  }),
  responseCache(120),
  async (c) => {
    const { q } = c.req.valid('query');
    const data = await scrapeSearch(q);
    return c.json(data);
  },
);

export default search;
