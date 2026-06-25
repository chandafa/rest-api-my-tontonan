/**
 * Minimal structured logger (SDD sec. 4.2 utils/logger).
 *
 * Why this file exists:
 * Serverless logs are easier to query as single-line JSON. This wraps the
 * console with leveled, structured output and is the only place logging format
 * is defined, so scrapers/middleware stay clean. No external dependency — keeps
 * the cold-start bundle small on Vercel Hobby.
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

function emit(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
  const line = {
    level,
    time: new Date().toISOString(),
    message,
    ...(meta ?? {}),
  };
  const serialized = JSON.stringify(line);
  if (level === 'error') console.error(serialized);
  else if (level === 'warn') console.warn(serialized);
  else console.log(serialized);
}

export const logger = {
  debug: (message: string, meta?: Record<string, unknown>) => emit('debug', message, meta),
  info: (message: string, meta?: Record<string, unknown>) => emit('info', message, meta),
  warn: (message: string, meta?: Record<string, unknown>) => emit('warn', message, meta),
  error: (message: string, meta?: Record<string, unknown>) => emit('error', message, meta),
};
