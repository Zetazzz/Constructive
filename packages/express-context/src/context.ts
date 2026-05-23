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
 *   - Module config (via LoaderRegistry, if provided)
 *
 * The result is a single `req.constructive` object that any downstream
 * route handler can use for tenant-scoped database operations.
 */

import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { Pool } from 'pg';
import { getPgPool } from 'pg-cache';
import type { PgpmOptions } from '@pgpmjs/types';

import type { LoaderRegistry } from './loaders/registry';
import type { LoaderContext } from './loaders/types';
import { withPgClient as withPgClientFn } from './pg-client';
import { buildPgSettings } from './pg-settings';
import type { ConstructiveContext, ResolvedModules } from './types';

export interface ContextMiddlewareOptions {
  /** Base PG options for pool creation (host, port, user, password) */
  pg?: PgpmOptions['pg'];
  /** Module loader registry for per-database cached lookups */
  loaders?: LoaderRegistry;
}

/**
 * Build the ConstructiveContext from the current request state.
 *
 * Requires `req.api` and `req.requestId` to be set by upstream middleware.
 * `req.token` is optional (anonymous requests get null).
 *
 * When a LoaderRegistry is provided, resolves all registered module
 * loaders in parallel and attaches the results to `ctx.modules`.
 */
export async function buildContext(
  req: Request,
  opts: ContextMiddlewareOptions = {}
): Promise<ConstructiveContext | null> {
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

  const tenantPool: Pool = getPgPool({
    ...opts.pg,
    database: api.dbname,
  });

  // Resolve module loaders (if registry provided)
  let modules: ResolvedModules = {};
  if (opts.loaders && api.databaseId) {
    const servicesPool: Pool = getPgPool(opts.pg);
    const loaderCtx: LoaderContext = {
      servicesPool,
      tenantPool,
      databaseId: api.databaseId,
      apiId: api.apiId,
      dbname: api.dbname,
    };
    modules = await opts.loaders.resolveAll(loaderCtx) as ResolvedModules;
  }

  return {
    api,
    token,
    pgSettings,
    databaseId: api.databaseId ?? null,
    userId: token?.user_id ?? null,
    requestId,
    pool: tenantPool,
    withPgClient: <T>(fn: (client: any) => Promise<T>) =>
      withPgClientFn(tenantPool, pgSettings, fn),
    modules,
  };
}

/**
 * Express middleware that builds `req.constructive` from the resolved
 * API config and auth token.
 *
 * Mount AFTER the API resolver and auth middleware:
 *
 * ```typescript
 * import { createContextMiddleware, createDefaultRegistry } from '@constructive-io/express-context';
 *
 * app.use(apiMiddleware);       // sets req.api
 * app.use(authMiddleware);      // sets req.token
 * app.use(createContextMiddleware({
 *   loaders: createDefaultRegistry(),
 * }));
 *
 * app.post('/v1/chat', (req, res) => {
 *   const { modules } = req.constructive;
 *   if (modules.rlsModule) { ... }
 * });
 * ```
 */
export function createContextMiddleware(
  opts: ContextMiddlewareOptions = {}
): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      const ctx = await buildContext(req, opts);
      if (ctx) {
        req.constructive = ctx;
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}
