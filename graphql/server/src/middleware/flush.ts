import { ConstructiveOptions } from '@constructive-io/graphql-types';
import { Logger } from '@pgpmjs/logger';
import { svcCache } from '@pgpmjs/server-utils';
import { NextFunction, Request, RequestHandler, Response } from 'express';
import { graphileCache } from 'graphile-cache';
import { onTenantEvicted } from 'graphile-multi-tenancy-cache';
import { getPgPool } from 'pg-cache';
import './types'; // for Request type
import { isMultiTenancyCacheEnabled, flushTenantInstance } from './graphile';

const log = new Logger('flush');

/**
 * Evict a single cache key from all cache layers (graphile-cache,
 * svcCache, and multi-tenancy cache if enabled).
 */
function flushCacheEntry(key: string, multiTenancy: boolean): void {
  graphileCache.delete(key);
  svcCache.delete(key);
  if (multiTenancy) {
    onTenantEvicted(key);
    flushTenantInstance(key);
  }
}

/**
 * Create the flush middleware.
 *
 * Reads `opts.api.useMultiTenancyCache` via the unified env system
 * to decide whether multi-tenancy cache layers need invalidation.
 */
export const createFlushMiddleware = (opts: ConstructiveOptions): RequestHandler => {
  const multiTenancy = isMultiTenancyCacheEnabled(opts);

  return async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    if (req.url === '/flush') {
      // TODO: check bearer for a flush / special key
      const key = (req as any).svc_key;
      if (key) {
        flushCacheEntry(key, multiTenancy);
      }
      res.status(200).send('OK');
      return;
    }
    return next();
  };
};

/**
 * @deprecated Use createFlushMiddleware(opts) instead.
 * Kept for backwards compatibility during migration.
 */
export const flush = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  if (req.url === '/flush') {
    const key = (req as any).svc_key;
    if (key) {
      flushCacheEntry(key, false);
    }
    res.status(200).send('OK');
    return;
  }
  return next();
};

export const flushService = async (
  opts: ConstructiveOptions,
  databaseId: string
): Promise<void> => {
  const multiTenancy = isMultiTenancyCacheEnabled(opts);
  const pgPool = getPgPool(opts.pg);
  log.info('flushing db ' + databaseId);

  const api = new RegExp(`^api:${databaseId}:.*`);
  const schemata = new RegExp(`^schemata:${databaseId}:.*`);
  const meta = new RegExp(`^metaschema:api:${databaseId}`);

  if (!opts.api.isPublic) {
    graphileCache.forEach((_, k: string) => {
      if (api.test(k) || schemata.test(k) || meta.test(k)) {
        flushCacheEntry(k, multiTenancy);
      }
    });
  }

  const svc = await pgPool.query(
    `SELECT *
     FROM services_public.domains
     WHERE database_id = $1`,
    [databaseId]
  );

  if (svc.rowCount === 0) return;

  for (const row of svc.rows) {
    let key: string | undefined;
    if (row.domain && !row.subdomain) {
      key = row.domain;
    } else if (row.domain && row.subdomain) {
      key = `${row.subdomain}.${row.domain}`;
    }
    if (key) {
      flushCacheEntry(key, multiTenancy);
    }
  }
};
