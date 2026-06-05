// Centralized error + 404 handlers for the TERANODE API.
//
// Routes/services throw an `HttpError` (or call `httpError(...)`) to surface a
// specific status + message; anything else falls through to a 500. The error
// handler shapes everything into the `ApiError` envelope from @teranode/types.

import type { ErrorRequestHandler, RequestHandler } from 'express';
import type { ApiError } from '@teranode/types';

/** An error carrying an HTTP status code (+ optional structured details). */
export class HttpError extends Error {
  status: number;
  details?: unknown;
  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.details = details;
  }
}

/** Convenience constructor for an HttpError. */
export function httpError(status: number, message: string, details?: unknown): HttpError {
  return new HttpError(status, message, details);
}

/** 404 handler — mounted after all routes. */
export const notFoundHandler: RequestHandler = (req, res) => {
  const body: ApiError = { error: 'not found', details: { path: req.path } };
  res.status(404).json(body);
};

/** Error handler — must be the last `app.use(...)`. */
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof HttpError) {
    const body: ApiError = { error: err.message };
    if (err.details !== undefined) body.details = err.details;
    res.status(err.status).json(body);
    return;
  }
  // Unknown / unexpected error → 500, log full detail server-side.
  console.error('[api]', err);
  const body: ApiError = { error: 'internal server error' };
  res.status(500).json(body);
};
