/**
 * Route: GET /api/anime/:slug (SDD sec. 9.2).
 *
 * Why this file exists:
 * Returns anime detail + episode list. `:slug` is the source-prefixed slug the
 * client received from /home or /search, so the orchestrator routes it back to
 * the exact source that produced it. Detail changes rarely, so it gets the
 * longest cache TTL.
 */
import { Hono } from 'hono';
import { responseCache } from '../middleware/cache';
import { scrapeAnime } from '../scrapers/anime-scraper';
import { BadRequestError } from '../utils/errors';

const anime = new Hono();

anime.get('/:slug', responseCache(600), async (c) => {
  const slug = c.req.param('slug');
  if (!slug) throw new BadRequestError('Anime slug is required');
  const data = await scrapeAnime(slug);
  return c.json(data);
});

export default anime;
