import './types'; // for Request type

import crypto from 'node:crypto';

import type { ConstructiveOptions } from '@constructive-io/graphql-types';
import { getNodeEnv } from '@pgpmjs/env';
import { Logger } from '@pgpmjs/logger';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { GraphQLError, GraphQLFormattedError } from 'grafast/graphql';
import { createGraphileInstance, graphileCache,type GraphileCacheEntry } from 'graphile-cache';
import type { GraphileConfig } from 'graphile-config';
import {
  getMultiTenancyCacheStats,
  getOrCreateTenantInstance,
  shutdownMultiTenancyCache,
  type TenantInstance
} from 'graphile-multi-tenancy-cache';
import { ConstructivePreset, makePgService } from 'graphile-settings';
import { getPgPool } from 'pg-cache';
import { getPgEnvOptions } from 'pg-env';

import { isGraphqlObservabilityEnabled } from '../diagnostics/observability';
import { HandlerCreationError } from '../errors/api-errors';
import { observeGraphileBuild } from './observability/graphile-build-stats';

const maskErrorLog = new Logger('graphile:maskError');

const SAFE_ERROR_CODES = new Set([
  // GraphQL standard
  'GRAPHQL_VALIDATION_FAILED',
  'GRAPHQL_PARSE_FAILED',
  'PERSISTED_QUERY_NOT_FOUND',
  'PERSISTED_QUERY_NOT_SUPPORTED',
  // Auth
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'BAD_USER_INPUT',
  'INCORRECT_PASSWORD',
  'PASSWORD_INSECURE',
  'ACCOUNT_LOCKED_EXCEED_ATTEMPTS',
  'ACCOUNT_DISABLED',
  'ACCOUNT_EXISTS',
  'PASSWORD_LEN',
  'INVITE_NOT_FOUND',
  'INVITE_LIMIT',
  'INVITE_EMAIL_NOT_FOUND',
  'INVALID_CREDENTIALS',
  // PublicKeySignature
  'FEATURE_DISABLED',
  'INVALID_PUBLIC_KEY',
  'INVALID_MESSAGE',
  'INVALID_SIGNATURE',
  'NO_ACCOUNT_EXISTS',
  'BAD_SIGNIN',
  // Upload
  'UPLOAD_MIMETYPE',
  // PostgreSQL constraint violations (surfaced by PostGraphile)
  '23505', // unique_violation
  '23503', // foreign_key_violation
  '23502', // not_null_violation
  '23514', // check_violation
  '23P01' // exclusion_violation
]);

/**
 * Production-aware error masking function.
 *
 * In development: returns errors as-is for debugging.
 * In production: returns errors with explicit codes from the SAFE_ERROR_CODES
 * allowlist as-is, but masks unexpected/database errors with a reference ID
 * and logs the original.
 */
const maskError = (error: GraphQLError): GraphQLError | GraphQLFormattedError => {
  if (getNodeEnv() === 'development') {
    return error;
  }

  // Only expose errors with codes on the safe allowlist.
  // Note: grafserv strips originalError and internal extensions before
  // serializing to the client, so returning the full error object is safe here.
  if (error.extensions?.code && SAFE_ERROR_CODES.has(error.extensions.code as string)) {
    return error;
  }

  // Mask unexpected/database errors with a reference ID
  const errorId = crypto.randomBytes(8).toString('hex');
  maskErrorLog.error(`[masked-error:${errorId}]`, error);

  return {
    message: `An unexpected error occurred. Reference: ${errorId}`,
    extensions: {
      code: 'INTERNAL_SERVER_ERROR',
      errorId
    }
  } as GraphQLFormattedError;
};

// =============================================================================
// Multi-tenancy toggle
// =============================================================================

/**
 * When true, the server uses graphile-multi-tenancy-cache for template-based
 * PostGraphile instance sharing.  Tenants with identical schema structures
 * share a single PostGraphile instance + GraphQLSchema, reducing memory from
 * O(N) to O(K) where K is the number of unique schema structures.
 *
 * Set `USE_MULTI_TENANCY_CACHE=true` to enable.
 */
export const useMultiTenancyCache = process.env.USE_MULTI_TENANCY_CACHE === 'true';

// =============================================================================
// Single-Flight Pattern: In-Flight Tracking (legacy mode)
// =============================================================================

/**
 * Tracks in-flight handler creation promises to prevent duplicate creations.
 * When multiple concurrent requests arrive for the same cache key, only the
 * first request creates the handler while others wait on the same promise.
 */
const creating = new Map<string, Promise<GraphileCacheEntry>>();

/**
 * Returns the number of currently in-flight handler creation operations.
 * Useful for monitoring and debugging.
 */
export function getInFlightCount(): number {
  return creating.size;
}

/**
 * Returns the cache keys for all currently in-flight handler creation operations.
 * Useful for monitoring and debugging.
 */
export function getInFlightKeys(): string[] {
  return [...creating.keys()];
}

/**
 * Clears the in-flight map. Used for testing purposes.
 */
export function clearInFlightMap(): void {
  creating.clear();
}

const log = new Logger('graphile');
const reqLabel = (req: Request): string => (req.requestId ? `[${req.requestId}]` : '[req]');

// =============================================================================
// Multi-tenancy cache: resolved tenant instances
// =============================================================================

/** Stores resolved TenantInstance objects keyed by the service cache key. */
const tenantInstances = new Map<string, TenantInstance>();

/** In-flight creation promises for multi-tenancy mode. */
const creatingTenants = new Map<string, Promise<TenantInstance>>();

/**
 * Returns multi-tenancy cache statistics (only meaningful when
 * USE_MULTI_TENANCY_CACHE is enabled).
 */
export { getMultiTenancyCacheStats };

// =============================================================================
// Preset builders
// =============================================================================

/**
 * Build a PostGraphile v5 preset for a tenant (legacy mode — one instance per tenant).
 */
const buildPreset = (
  pool: import('pg').Pool,
  schemas: string[],
  anonRole: string,
  roleName: string
): GraphileConfig.Preset => {
  return {
    extends: [ConstructivePreset],
    pgServices: [
      makePgService({
        pool,
        schemas
      })
    ],
    grafserv: {
      graphqlPath: '/graphql',
      graphiqlPath: '/graphiql',
      graphiql: true,
      graphiqlOnGraphQLGET: false,
      maskError
    },
    grafast: {
      explain: process.env.NODE_ENV === 'development',
      context: (requestContext: Partial<Grafast.RequestContext>) => {
      // In grafserv/express/v4, the request is available at requestContext.expressv4.req
        const req = (requestContext as { expressv4?: { req?: Request } })?.expressv4?.req;
        const context: Record<string, string> = {};

        if (req) {
          if (req.databaseId) {
            context['jwt.claims.database_id'] = req.databaseId;
          }
          if (req.clientIp) {
            context['jwt.claims.ip_address'] = req.clientIp;
          }
          if (req.get('origin')) {
            context['jwt.claims.origin'] = req.get('origin') as string;
          }
          if (req.get('User-Agent')) {
            context['jwt.claims.user_agent'] = req.get('User-Agent') as string;
          }

          if (req.token?.user_id) {
            return {
              pgSettings: {
                role: roleName,
                'jwt.claims.token_id': req.token.id,
                'jwt.claims.user_id': req.token.user_id,
                ...context
              }
            };
          }
        }

        return {
          pgSettings: {
            role: anonRole,
            ...context
          }
        };
      }
    }
  };
};

/**
 * Build a PostGraphile v5 preset for multi-tenancy mode.
 *
 * Key difference from the legacy preset:
 * - `gather.pgIdentifiers` is set to `"dynamic"` so schema names in compiled
 *   SQL are wrapped as `"__pgmt_<schema>__"` placeholders.
 * - `grafast.context` injects `pgSqlTextTransform` from `req.sqlTextTransform`
 *   so the PgExecutor can remap placeholders to real tenant schemas per-request.
 */
const buildMultiTenancyPreset = (
  pool: import('pg').Pool,
  schemas: string[],
  anonRole: string,
  roleName: string
): GraphileConfig.Preset => {
  return {
    extends: [ConstructivePreset],
    pgServices: [
      makePgService({
        pool,
        schemas
      })
    ],
    gather: {
      // 'dynamic' mode is added by the Crystal multi-tenancy PR.
      // Use type assertion since the published types only know
      // "qualified" | "unqualified" until Crystal changes are merged.
      pgIdentifiers: 'dynamic' as any
    },
    grafserv: {
      graphqlPath: '/graphql',
      graphiqlPath: '/graphiql',
      graphiql: true,
      graphiqlOnGraphQLGET: false,
      maskError
    },
    grafast: {
      explain: process.env.NODE_ENV === 'development',
      context: (requestContext: Partial<Grafast.RequestContext>) => {
        const req = (requestContext as { expressv4?: { req?: Request } })?.expressv4?.req;
        const context: Record<string, string> = {};

        // Inject the per-request SQL text transform for schema remapping.
        // This is read by PgIntrospectionPlugin's contextCallback and
        // forwarded to PgExecutorContext.sqlTextTransform.
        const pgSqlTextTransform = req?.sqlTextTransform || undefined;

        if (req) {
          if (req.databaseId) {
            context['jwt.claims.database_id'] = req.databaseId;
          }
          if (req.clientIp) {
            context['jwt.claims.ip_address'] = req.clientIp;
          }
          if (req.get('origin')) {
            context['jwt.claims.origin'] = req.get('origin') as string;
          }
          if (req.get('User-Agent')) {
            context['jwt.claims.user_agent'] = req.get('User-Agent') as string;
          }

          if (req.token?.user_id) {
            return {
              pgSqlTextTransform,
              pgSettings: {
                role: roleName,
                'jwt.claims.token_id': req.token.id,
                'jwt.claims.user_id': req.token.user_id,
                ...context
              }
            };
          }
        }

        return {
          pgSqlTextTransform,
          pgSettings: {
            role: anonRole,
            ...context
          }
        };
      }
    }
  };
};

// =============================================================================
// Middleware
// =============================================================================

export const graphile = (opts: ConstructiveOptions): RequestHandler => {
  const observabilityEnabled = isGraphqlObservabilityEnabled(opts.server?.host);

  if (useMultiTenancyCache) {
    log.info('[graphile] Multi-tenancy cache ENABLED (USE_MULTI_TENANCY_CACHE=true)');
    return multiTenancyHandler(opts);
  }

  log.info('[graphile] Using legacy graphile-cache (USE_MULTI_TENANCY_CACHE not set)');
  return legacyHandler(opts, observabilityEnabled);
};

// =============================================================================
// Legacy handler (graphile-cache, one instance per tenant)
// =============================================================================

function legacyHandler(opts: ConstructiveOptions, observabilityEnabled: boolean): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    const label = reqLabel(req);
    try {
      const api = req.api;
      if (!api) {
        log.error(`${label} Missing API info`);
        return res.status(500).send('Missing API info');
      }
      const key = req.svc_key;
      if (!key) {
        log.error(`${label} Missing service cache key`);
        return res.status(500).send('Missing service cache key');
      }
      const { dbname, anonRole, roleName, schema } = api;
      const schemaLabel = schema?.join(',') || 'unknown';

      // =========================================================================
      // Phase A: Cache Check (fast path)
      // =========================================================================
      const cached = graphileCache.get(key);
      if (cached) {
        log.debug(`${label} PostGraphile cache hit key=${key} db=${dbname} schemas=${schemaLabel}`);
        return cached.handler(req, res, next);
      }

      log.debug(`${label} PostGraphile cache miss key=${key} db=${dbname} schemas=${schemaLabel}`);

      // =========================================================================
      // Phase B: In-Flight Check (single-flight coalescing)
      // =========================================================================
      const inFlight = creating.get(key);
      if (inFlight) {
        log.debug(`${label} Coalescing request for PostGraphile[${key}] - waiting for in-flight creation`);
        try {
          const instance = await inFlight;
          return instance.handler(req, res, next);
        } catch (_error) {
          log.warn(`${label} Coalesced request failed for PostGraphile[${key}], retrying`);
          // Fall through to Phase C to retry creation
        }
      }

      // =========================================================================
      // Phase C: Create New Handler (first request for this key)
      // =========================================================================

      // Re-check cache after coalesced request failure (another retry may have succeeded)
      const recheckedCache = graphileCache.get(key);
      if (recheckedCache) {
        log.debug(`${label} PostGraphile cache hit on re-check key=${key}`);
        return recheckedCache.handler(req, res, next);
      }

      // Re-check in-flight map (another retry may have started creation)
      const retryInFlight = creating.get(key);
      if (retryInFlight) {
        log.debug(`${label} Re-coalescing request for PostGraphile[${key}]`);
        const retryInstance = await retryInFlight;
        return retryInstance.handler(req, res, next);
      }

      log.info(
        `${label} Building PostGraphile v5 handler key=${key} db=${dbname} schemas=${schemaLabel} role=${roleName} anon=${anonRole}`
      );

      const pgConfig = getPgEnvOptions({
        ...opts.pg,
        database: dbname
      });

      // Route through pg-cache so the pool is tracked and can be cleaned up
      // properly, preventing leaked connections during database teardown.
      const pool = getPgPool(pgConfig);

      // Create promise and store in in-flight map BEFORE try block
      const preset = buildPreset(pool, schema || [], anonRole, roleName);
      const creationPromise = observeGraphileBuild(
        {
          cacheKey: key,
          serviceKey: key,
          databaseId: api.databaseId ?? null
        },
        () => createGraphileInstance({ preset, cacheKey: key }),
        { enabled: observabilityEnabled }
      );
      creating.set(key, creationPromise);

      try {
        const instance = await creationPromise;
        graphileCache.set(key, instance);
        log.info(`${label} Cached PostGraphile v5 handler key=${key} db=${dbname}`);
        return instance.handler(req, res, next);
      } catch (error) {
        log.error(`${label} Failed to create PostGraphile[${key}]:`, error);
        throw new HandlerCreationError(
          `Failed to create handler for ${key}: ${error instanceof Error ? error.message : String(error)}`,
          {
            cacheKey: key,
            cause: error instanceof Error ? error.message : String(error)
          }
        );
      } finally {
        // Always clean up in-flight tracker
        creating.delete(key);
      }
    } catch (e: any) {
      log.error(`${label} PostGraphile middleware error`, e);
      if (!res.headersSent) {
        return res.status(500).json({
          error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' }
        });
      }
      next(e);
    }
  };
}

// =============================================================================
// Multi-tenancy handler (graphile-multi-tenancy-cache, shared templates)
// =============================================================================

function multiTenancyHandler(opts: ConstructiveOptions): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    const label = reqLabel(req);
    try {
      const api = req.api;
      if (!api) {
        log.error(`${label} Missing API info`);
        return res.status(500).send('Missing API info');
      }
      const key = req.svc_key;
      if (!key) {
        log.error(`${label} Missing service cache key`);
        return res.status(500).send('Missing service cache key');
      }
      const { dbname, anonRole, roleName, schema } = api;
      const schemaLabel = schema?.join(',') || 'unknown';

      // =========================================================================
      // Phase A: Check resolved tenant cache (fast path)
      // =========================================================================
      const existing = tenantInstances.get(key);
      if (existing) {
        log.debug(
          `${label} Multi-tenancy cache hit key=${key} db=${dbname} schemas=${schemaLabel} ` +
          `shared=${existing.isShared} fingerprint=${existing.fingerprint.substring(0, 12)}...`
        );
        // Inject the per-request sqlTextTransform so the PgExecutor can
        // remap __pgmt__ placeholders to the real tenant schemas.
        req.sqlTextTransform = existing.sqlTextTransform;
        return existing.handler(req, res, next);
      }

      log.debug(`${label} Multi-tenancy cache miss key=${key} db=${dbname} schemas=${schemaLabel}`);

      // =========================================================================
      // Phase B: In-Flight Check (single-flight coalescing)
      // =========================================================================
      const inFlight = creatingTenants.get(key);
      if (inFlight) {
        log.debug(`${label} Coalescing multi-tenancy request for [${key}]`);
        try {
          const tenant = await inFlight;
          req.sqlTextTransform = tenant.sqlTextTransform;
          return tenant.handler(req, res, next);
        } catch (_error) {
          log.warn(`${label} Coalesced multi-tenancy request failed for [${key}], retrying`);
        }
      }

      // Re-check after coalesce failure
      const rechecked = tenantInstances.get(key);
      if (rechecked) {
        req.sqlTextTransform = rechecked.sqlTextTransform;
        return rechecked.handler(req, res, next);
      }

      // =========================================================================
      // Phase C: Create / Reuse Tenant Instance
      // =========================================================================
      log.info(
        `${label} Resolving multi-tenancy instance key=${key} db=${dbname} schemas=${schemaLabel} ` +
        `role=${roleName} anon=${anonRole}`
      );

      const pgConfig = getPgEnvOptions({
        ...opts.pg,
        database: dbname
      });

      const pool = getPgPool(pgConfig);

      const creationPromise = getOrCreateTenantInstance(
        {
          cacheKey: key,
          pool,
          schemas: schema || [],
          dbname,
          anonRole,
          roleName,
          databaseId: api.databaseId
        },
        buildMultiTenancyPreset
      );
      creatingTenants.set(key, creationPromise);

      try {
        const tenant = await creationPromise;
        tenantInstances.set(key, tenant);
        log.info(
          `${label} Multi-tenancy instance resolved key=${key} db=${dbname} ` +
          `shared=${tenant.isShared} fingerprint=${tenant.fingerprint.substring(0, 12)}...`
        );
        req.sqlTextTransform = tenant.sqlTextTransform;
        return tenant.handler(req, res, next);
      } catch (error) {
        log.error(`${label} Failed to resolve multi-tenancy instance [${key}]:`, error);
        throw new HandlerCreationError(
          `Failed to create handler for ${key}: ${error instanceof Error ? error.message : String(error)}`,
          {
            cacheKey: key,
            cause: error instanceof Error ? error.message : String(error)
          }
        );
      } finally {
        creatingTenants.delete(key);
      }
    } catch (e: any) {
      log.error(`${label} PostGraphile middleware error`, e);
      if (!res.headersSent) {
        return res.status(500).json({
          error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' }
        });
      }
      next(e);
    }
  };
}

/**
 * Shut down multi-tenancy cache and release all shared templates.
 * Called during server shutdown.
 */
export async function shutdownMultiTenancy(): Promise<void> {
  tenantInstances.clear();
  creatingTenants.clear();
  await shutdownMultiTenancyCache();
}
