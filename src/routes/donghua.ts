/**
 * Routes: GET /api/donghua/home and /api/donghua/search?q=...
 *
 * Why this file exists:
 * Donghua (Chinese animation) is a separate content type with its own failover
 * chain (donghub primary, sankavollerei backup). Only listing endpoints are
 * needed here — donghua DETAIL and PLAYBACK reuse /api/anime/:slug and
 * /api/episode/:slug, since every slug is source-prefixed and the orchestrator
 * routes it to the owning donghua adapter automatically.
 */
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { responseCache } from '../middleware/cache';
import { scrapeDonghuaHome, scrapeDonghuaSearch } from '../scrapers/orchestrator';
import { BadRequestError } from '../utils/errors';

const querySchema = z.object({
  q: z.string().trim().min(1, 'Query parameter "q" is required'),
});

const donghua = new Hono();

donghua.get('/home', responseCache(), async (c) => {
  return c.json(await scrapeDonghuaHome());
});

donghua.get(
  '/search',
  zValidator('query', querySchema, (result) => {
    if (!result.success) {
      throw new BadRequestError('Query parameter "q" is required', result.error.flatten());
    }
  }),
  responseCache(120),
  async (c) => {
    const { q } = c.req.valid('query');
    return c.json(await scrapeDonghuaSearch(q));
  },
);

export default donghua;
