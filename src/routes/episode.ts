/**
 * Route: GET /api/episode/:slug (SDD sec. 9.2).
 *
 * Why this file exists:
 * Returns playable sources + prev/next for an episode. Per SDD sec. 13 & 16,
 * scraped video URLs are signed and expire within hours, so this endpoint is
 * deliberately NOT cached (`Cache-Control: no-store`) and always re-scrapes to
 * hand the client a fresh URL.
 */
import { Hono } from 'hono';
import { scrapeEpisode } from '../scrapers/episode-scraper';
import { BadRequestError } from '../utils/errors';

const episode = new Hono();

episode.get('/:slug', async (c) => {
  const slug = c.req.param('slug');
  if (!slug) throw new BadRequestError('Episode slug is required');
  const data = await scrapeEpisode(slug);
  c.header('Cache-Control', 'no-store');
  return c.json(data);
});

export default episode;
