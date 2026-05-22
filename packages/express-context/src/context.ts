/**
 * context — Builds `req.constructive` from resolved API + auth token
 *
 * This middleware runs AFTER the API resolver and auth middleware have
 * populated `req.api` and `req.token`. It composes:
 *
 *   - pgSettings (role, claims, request_id, database_id)
 *   - Tenant database pool (via pg-cache)
 *   - withPgClient (transaction-scoped RLS helper)
 *   - Convenience fields (userId, databaseId, requestId)
 *
 * The result is a single `req.constructive` object that any downstream
 * route handler can use for tenant-scoped database operations.
 */

import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { Pool } from 'pg';
import { getPgPool } from 'pg-cache';
import type { PgpmOptions } from '@pgpmjs/types';

import { withPgClient as withPgClientFn } from './pg-client';
import { buildPgSettings } from './pg-settings';
import type { ConstructiveContext } from './types';

export interface ContextMiddlewareOptions {
  /** Base PG options for pool creation (host, port, user, password) */
  pg?: PgpmOptions['pg'];
}

/**
 * Build the ConstructiveContext from the current request state.
 *
 * Requires `req.api` and `req.requestId` to be set by upstream middleware.
 * `req.token` is optional (anonymous requests get null).
 */
export function buildContext(
  req: Request,
  opts: ContextMiddlewareOptions = {}
): ConstructiveContext | null {
  const api = req.api;
  if (!api) return null;

  const token = req.token ?? null;
  const requestId = req.requestId || '';

  const pgSettings = buildPgSettings({
    api,
    token,
    requestId,
    clientIp: req.clientIp,
  });

  const pool: Pool = getPgPool({
    ...opts.pg,
    database: api.dbname,
  });

  return {
    api,
    token,
    pgSettings,
    databaseId: api.databaseId ?? null,
    userId: token?.user_id ?? null,
    requestId,
    pool,
    withPgClient: <T>(fn: (client: any) => Promise<T>) =>
      withPgClientFn(pool, pgSettings, fn),
  };
}

/**
 * Express middleware that builds `req.constructive` from the resolved
 * API config and auth token.
 *
 * Mount AFTER the API resolver and auth middleware:
 *
 * ```typescript
 * app.use(apiMiddleware);       // sets req.api
 * app.use(authMiddleware);      // sets req.token
 * app.use(contextMiddleware()); // sets req.constructive
 * ```
 */
export function createContextMiddleware(
  opts: ContextMiddlewareOptions = {}
): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const ctx = buildContext(req, opts);
    if (ctx) {
      req.constructive = ctx;
    }
    next();
  };
}
