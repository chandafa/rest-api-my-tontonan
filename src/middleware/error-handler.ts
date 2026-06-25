/**
 * Centralized error handler + 404 handler (SDD sec. 14).
 *
 * Why this file exists:
 * The SDD requires scraper failures to return a clear error status (503/500/…)
 * instead of crashing the function. Registering app-level `onError`/`notFound`
 * keeps every route free of try/catch boilerplate: routes just throw typed
 * AppErrors (utils/errors.ts) and this maps them to a consistent JSON shape.
 * Unknown errors are logged in full but returned as a generic 500 so we never
 * leak stack traces or the target URL to the Flutter client.
 */
import type { Hono } from 'hono';
import { isAppError } from '../utils/errors';
import { logger } from '../utils/logger';

interface ErrorBody {
  error: string;
  message: string;
  details?: unknown;
}

export function registerErrorHandler(app: Hono): void {
  app.onError((err, c) => {
    if (isAppError(err)) {
      logger.warn('handled error', {
        code: err.code,
        status: err.status,
        path: c.req.path,
        message: err.message,
      });
      const body: ErrorBody = { error: err.code, message: err.message };
      if (err.details !== undefined) body.details = err.details;
      return c.json(body, err.status as 400 | 404 | 500 | 503);
    }

    // Unexpected: log everything server-side, expose nothing client-side.
    logger.error('unhandled error', {
      path: c.req.path,
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    return c.json<ErrorBody>(
      { error: 'INTERNAL_ERROR', message: 'Something went wrong. Please try again.' },
      500,
    );
  });

  app.notFound((c) =>
    c.json<ErrorBody>({ error: 'NOT_FOUND', message: `No route for ${c.req.path}` }, 404),
  );
}
