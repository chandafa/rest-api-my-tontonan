/**
 * Vercel serverless function entry (SDD sec. 9.1 + vercel.json rewrite).
 *
 * Why this file exists:
 * Vercel maps files under `api/` to serverless functions. The `vercel.json`
 * rewrite sends every `/api/*` request here, where Hono's `handle()` adapter
 * dispatches it to the right route. All real app logic lives in `src/index.ts`;
 * this file is a thin, framework-required adapter so the SDD's single-app design
 * stays intact.
 */
import { vercelHandler, runtime } from '../src/index';

export { runtime };
export default vercelHandler;
