/**
 * request-id — Per-request correlation ID middleware
 *
 * Generates a UUID v4 request ID (or uses an incoming X-Request-Id header)
 * and attaches it to `req.requestId`. This ID propagates through pgSettings
 * into billing ledger entries and inference logs for distributed tracing.
 */

import { randomUUID } from 'crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';

/**
 * Middleware that ensures every request has a correlation ID.
 *
 * Priority: `X-Request-Id` header → new UUID v4
 */
export function requestIdMiddleware(): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    req.requestId = (req.get('X-Request-Id') || randomUUID()) as string;
    next();
  };
}
