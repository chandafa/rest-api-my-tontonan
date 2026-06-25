/**
 * Routes: GET /api/film/home and /api/film/search?q=...
 *
 * Film (movies) is a third content type with its own failover chain. Detail and
 * playback reuse /api/anime/:slug + /api/episode/:slug (slug-prefixed routing) —
 * a movie is modeled as a single-episode title.
 */
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { responseCache } from '../middleware/cache';
import { scrapeFilmHome, scrapeFilmSearch } from '../scrapers/orchestrator';
import { BadRequestError } from '../utils/errors';

const querySchema = z.object({ q: z.string().trim().min(1, 'Query parameter "q" is required') });

const film = new Hono();

film.get('/home', responseCache(), async (c) => c.json(await scrapeFilmHome()));

film.get(
  '/search',
  zValidator('query', querySchema, (result) => {
    if (!result.success) {
      throw new BadRequestError('Query parameter "q" is required', result.error.flatten());
    }
  }),
  responseCache(120),
  async (c) => {
    const { q } = c.req.valid('query');
    return c.json(await scrapeFilmSearch(q));
  },
);

export default film;
