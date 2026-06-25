/**
 * Local development server (NOT used by Vercel).
 *
 * Why this file exists:
 * Vercel deploys via api/index.ts, but for on-device testing we need the same
 * Hono app served over the LAN. This binds it to 0.0.0.0 so an emulator
 * (10.0.2.2) or a physical phone (the PC's LAN IP) can reach it.
 *
 * Run: npm run serve   (bundled + executed via esbuild/node)
 */
import { serve } from '@hono/node-server';
import app from './index';

const port = Number(process.env.PORT ?? 3000);

serve({ fetch: app.fetch, port, hostname: '0.0.0.0' }, (info) => {
  // eslint-disable-next-line no-console
  console.log(`my-anime-api listening on http://0.0.0.0:${info.port}/api`);
});
