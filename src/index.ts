/**
 * Hono application entry point (SDD sec. 9.1).
 *
 * Why this file exists:
 * It constructs the single Hono app, mounts global middleware (CORS now;
 * rate-limit + cache + error-handler are wired in Phase 2/4), and registers the
 * four feature routes under the `/api` base path. The Vercel serverless function
 * (api/index.ts) simply re-exports the `handle()`-wrapped app from here, so all
 * routing lives in one place exactly as the SDD specifies.
 *
 * NOTE: Feature routes (/home, /search, /anime, /episode) are added in Phase 4.
 * Phase 1 ships a compiling app skeleton with CORS + health/version endpoints.
 */
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { handle } from 'hono/vercel';
import { config } from './config';
import { rateLimit } from './middleware/rate-limit';
import { registerErrorHandler } from './middleware/error-handler';
import homeRoute from './routes/home';
import searchRoute from './routes/search';
import animeRoute from './routes/anime';
import episodeRoute from './routes/episode';
import donghuaRoute from './routes/donghua';
import filmRoute from './routes/film';

// Vercel: force the Node.js runtime (cheerio + fetch streaming need Node, not Edge).
export const runtime = 'nodejs';

const app = new Hono().basePath('/api');

// --- Global middleware -------------------------------------------------------
app.use(
  '*',
  cors({
    // Empty corsOrigins => reflect any origin ('*'); otherwise restrict.
    origin: config.corsOrigins.length === 0 ? '*' : config.corsOrigins,
    allowMethods: ['GET', 'OPTIONS'],
    maxAge: 86400,
  }),
);

// Per-IP rate limiting protects our Vercel quota and the source sites.
app.use('*', rateLimit());

// Map thrown AppErrors -> clean JSON; catch-all 404. Registered before routes.
registerErrorHandler(app);

// --- Meta routes -------------------------------------------------------------
// Lightweight health check (useful for uptime pings; avoids a cold scrape).
app.get('/health', (c) =>
  c.json({ status: 'ok', service: 'my-anime-api', runtime }),
);

app.get('/', (c) =>
  c.json({
    name: 'my-anime-api',
    version: '1.0.0',
    endpoints: ['/api/home', '/api/search', '/api/anime/:slug', '/api/episode/:slug'],
  }),
);

// --- Feature routes (SDD sec. 9.1) ------------------------------------------
app.route('/home', homeRoute);
app.route('/search', searchRoute);
app.route('/anime', animeRoute);
app.route('/episode', episodeRoute);
app.route('/donghua', donghuaRoute);
app.route('/film', filmRoute);

export default app;
export const vercelHandler = handle(app);
