/**
 * Typed application errors (SDD sec. 14 + scraper rule "throw proper exceptions").
 *
 * Why this file exists:
 * Scrapers and routes throw these instead of raw `Error`s so the central
 * error-handler (middleware/error-handler.ts) can map each to the correct HTTP
 * status the SDD prescribes — e.g. unreachable source => 503, parse failure =>
 * 500, unknown slug => 404 — without leaking stack traces or the target URL.
 */

export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  /** Optional machine-readable detail (never the raw target URL). */
  readonly details?: unknown;

  constructor(message: string, status = 500, code = 'INTERNAL_ERROR', details?: unknown) {
    super(message);
    this.name = new.target.name;
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** No source site could satisfy the request (all failover targets failed). */
export class SourceUnavailableError extends AppError {
  constructor(message = 'All anime sources are currently unavailable', details?: unknown) {
    super(message, 503, 'SOURCE_UNAVAILABLE', details);
  }
}

/** The HTML/JSON loaded but its structure no longer matches our selectors. */
export class ScrapeParseError extends AppError {
  constructor(message = 'Failed to parse the source response', details?: unknown) {
    super(message, 500, 'PARSE_ERROR', details);
  }
}

/** The requested anime/episode slug does not exist on any source. */
export class NotFoundError extends AppError {
  constructor(message = 'Resource not found', details?: unknown) {
    super(message, 404, 'NOT_FOUND', details);
  }
}

/** A request parameter (e.g. empty search query) failed validation. */
export class BadRequestError extends AppError {
  constructor(message = 'Invalid request', details?: unknown) {
    super(message, 400, 'BAD_REQUEST', details);
  }
}

/** Type guard used by the error handler. */
export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}
