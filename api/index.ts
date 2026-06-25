/**
 * Vercel serverless function entry (SDD sec. 9.1 + vercel.json rewrite).
 *
 * Why named HTTP-method exports (GET/POST/…):
 * Vercel's Node runtime treats a `export default` as the classic
 * `(req, res) => void` signature and IGNORES a returned `Response` — which made
 * the request hang until the 60s timeout. Exporting named HTTP methods makes
 * Vercel use the Web `fetch`-style handler (the Response is sent). Every method
 * maps to the same Hono app, which does its own routing.
 */
import { vercelHandler, runtime } from '../src/index';

export { runtime };

export const GET = vercelHandler;
export const POST = vercelHandler;
export const PUT = vercelHandler;
export const PATCH = vercelHandler;
export const DELETE = vercelHandler;
export const OPTIONS = vercelHandler;
export const HEAD = vercelHandler;
