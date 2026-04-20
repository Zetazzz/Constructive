/**
 * Multi-tenancy cache orchestrator (v4-buildkey).
 *
 * Caches one independent PostGraphile handler per **buildKey** (derived from
 * the inputs that materially affect Graphile handler construction).
 *
 * Multiple svc_key values with identical build inputs share the same handler.
 * svc_key remains the request routing key and flush targeting key.
 *
 * No template sharing, no SQL rewrite, no fingerprinting.
 *
 * Index structures:
 *   handlerCache:          buildKey  → TenantInstance
 *   svcKeyToBuildKey:      svc_key   → buildKey
 *   databaseIdToBuildKeys: databaseId → Set<buildKey>
 */

import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { Logger } from '@pgpmjs/logger';
import express from 'express';
import { postgraphile } from 'postgraphile';
import { grafserv } from 'grafserv/express/v4';
import type { Pool } from 'pg';
import type { GraphileConfig } from 'graphile-config';

const log = new Logger('multi-tenancy-cache');

// --- Types ---

export interface TenantConfig {
  svcKey: string;
  pool: Pool;
  schemas: string[];
  anonRole: string;
  roleName: string;
  databaseId?: string;
}

export interface TenantInstance {
  buildKey: string;
  handler: import('express').Express;
  schemas: string[];
  pgl: import('postgraphile').PostGraphileInstance;
  httpServer: import('http').Server;
  createdAt: number;
  lastUsedAt: number;
}

export interface MultiTenancyCacheStats {
  handlerCacheSize: number;
  svcKeyMappings: number;
  databaseIdMappings: number;
  inflightCreations: number;
}

// --- Internal state ---

/** buildKey → TenantInstance (the real handler cache) */
const handlerCache = new Map<string, TenantInstance>();

/** svc_key → buildKey (routing index) */
const svcKeyToBuildKey = new Map<string, string>();

/** databaseId → Set<buildKey> (flush-by-database index) */
const databaseIdToBuildKeys = new Map<string, Set<string>>();

/** buildKey → Promise<TenantInstance> (single-flight coalescing) */
const creatingHandlers = new Map<string, Promise<TenantInstance>>();

/** The preset builder, set once by configureMultiTenancyCache(). */
let presetBuilder: ((
  pool: Pool,
  schemas: string[],
  anonRole: string,
  roleName: string,
) => GraphileConfig.Preset) | null = null;

// --- Configuration ---

export interface MultiTenancyCacheConfig {
  basePresetBuilder: (
    pool: Pool,
    schemas: string[],
    anonRole: string,
    roleName: string,
  ) => GraphileConfig.Preset;
}

/**
 * One-time package bootstrap. Stores the preset builder.
 * Must be called before any getOrCreateTenantInstance() calls.
 */
export function configureMultiTenancyCache(config: MultiTenancyCacheConfig): void {
  presetBuilder = config.basePresetBuilder;
  log.info('Multi-tenancy cache configured (v4-buildkey — buildKey-based handler caching)');
}

// --- BuildKey computation ---

/**
 * Derive the pool connection identity from a pg.Pool instance.
 * Uses host, port, database, and user — the fields that determine
 * which database server and role the pool connects as.
 */
function getPoolIdentity(pool: Pool): string {
  const opts = (pool as unknown as { options: Record<string, unknown> }).options || {};
  return `${opts.host || 'localhost'}:${opts.port || 5432}/${opts.database || ''}@${opts.user || ''}`;
}

/**
 * Compute the buildKey from the inputs that materially affect
 * Graphile handler construction.
 *
 * Includes:
 *   - connection identity (host:port/database@user)
 *   - schemas (order preserved — NOT sorted)
 *   - anonRole
 *   - roleName
 *
 * Does NOT include:
 *   - svc_key (routing-only)
 *   - databaseId (metadata-only)
 *   - token data, host/domain, transient headers
 */
export function computeBuildKey(
  pool: Pool,
  schemas: string[],
  anonRole: string,
  roleName: string,
): string {
  const input = JSON.stringify({
    conn: getPoolIdentity(pool),
    schemas,
    anonRole,
    roleName,
  });
  return createHash('sha256').update(input).digest('hex').slice(0, 16);
}

// --- Index management ---

/**
 * Register a svc_key → buildKey mapping and update the databaseId index.
 */
function registerMapping(svcKey: string, buildKey: string, databaseId?: string): void {
  svcKeyToBuildKey.set(svcKey, buildKey);
  if (databaseId) {
    let keys = databaseIdToBuildKeys.get(databaseId);
    if (!keys) {
      keys = new Set();
      databaseIdToBuildKeys.set(databaseId, keys);
    }
    keys.add(buildKey);
  }
}

/**
 * Collect all svc_keys that map to a given buildKey.
 */
function getSvcKeysForBuildKey(buildKey: string): string[] {
  const result: string[] = [];
  for (const [svcKey, bk] of svcKeyToBuildKey) {
    if (bk === buildKey) result.push(svcKey);
  }
  return result;
}

/**
 * Remove a buildKey from all indexes and dispose the handler.
 */
function evictBuildKey(buildKey: string): void {
  const handler = handlerCache.get(buildKey);
  if (!handler) return;

  handlerCache.delete(buildKey);

  // Remove all svc_key → buildKey mappings pointing to this buildKey
  for (const svcKey of getSvcKeysForBuildKey(buildKey)) {
    svcKeyToBuildKey.delete(svcKey);
  }

  // Remove from databaseId index
  for (const [dbId, keys] of databaseIdToBuildKeys) {
    keys.delete(buildKey);
    if (keys.size === 0) databaseIdToBuildKeys.delete(dbId);
  }

  disposeTenant(handler).catch((err) => {
    log.error(`Failed to dispose handler buildKey=${buildKey}:`, err);
  });

  log.debug(`Evicted handler buildKey=${buildKey}`);
}

// --- Core API ---

/**
 * Fast-path lookup: svc_key → buildKey → handler.
 */
export function getTenantInstance(svcKey: string): TenantInstance | undefined {
  const buildKey = svcKeyToBuildKey.get(svcKey);
  if (!buildKey) return undefined;

  const handler = handlerCache.get(buildKey);
  if (handler) {
    handler.lastUsedAt = Date.now();
  }
  return handler;
}

/**
 * Resolve the buildKey for a given svc_key (for diagnostics / external use).
 */
export function getBuildKeyForSvcKey(svcKey: string): string | undefined {
  return svcKeyToBuildKey.get(svcKey);
}

/**
 * Resolve or create a tenant handler.
 *
 * Flow:
 * 1. Compute buildKey from config's build inputs
 * 2. Register svc_key → buildKey mapping
 * 3. Check handlerCache (fast path) → return if hit
 * 4. Check creatingHandlers (single-flight coalesce) → wait if in-flight
 * 5. Create a new independent PostGraphile instance keyed by buildKey
 * 6. Store in handlerCache → return
 */
export async function getOrCreateTenantInstance(
  config: TenantConfig,
): Promise<TenantInstance> {
  const { svcKey, pool, schemas, anonRole, roleName, databaseId } = config;

  if (!presetBuilder) {
    throw new Error('Multi-tenancy cache not configured. Call configureMultiTenancyCache() first.');
  }

  const buildKey = computeBuildKey(pool, schemas, anonRole, roleName);

  // Always register / update the mapping (cheap idempotent operation)
  registerMapping(svcKey, buildKey, databaseId);

  // Step 1: Fast path — handler already cached
  const existing = handlerCache.get(buildKey);
  if (existing) {
    existing.lastUsedAt = Date.now();
    return existing;
  }

  // Step 2: Single-flight coalesce — handler being created
  const pending = creatingHandlers.get(buildKey);
  if (pending) {
    return pending;
  }

  const promise = doCreateHandler(buildKey, pool, schemas, anonRole, roleName);
  creatingHandlers.set(buildKey, promise);

  try {
    return await promise;
  } finally {
    creatingHandlers.delete(buildKey);
  }
}

async function doCreateHandler(
  buildKey: string,
  pool: Pool,
  schemas: string[],
  anonRole: string,
  roleName: string,
): Promise<TenantInstance> {
  const schemaLabel = schemas.join(',') || 'unknown';

  log.info(`Building handler buildKey=${buildKey} schemas=${schemaLabel}`);

  const preset = presetBuilder!(pool, schemas, anonRole, roleName);
  const pgl = postgraphile(preset);
  const serv = pgl.createServ(grafserv);

  const handler = express();
  const httpServer = createServer(handler);
  await serv.addTo(handler, httpServer);
  await serv.ready();

  const tenant: TenantInstance = {
    buildKey,
    handler,
    schemas,
    pgl,
    httpServer,
    createdAt: Date.now(),
    lastUsedAt: Date.now(),
  };

  handlerCache.set(buildKey, tenant);

  log.info(`Handler created buildKey=${buildKey} schemas=${schemaLabel}`);
  return tenant;
}

/**
 * Flush by svc_key: resolve to buildKey, evict the handler.
 *
 * This removes the handler AND all svc_key mappings pointing to
 * the same buildKey. Other svc_keys that shared the handler will
 * re-create it on next request.
 */
export function flushTenantInstance(svcKey: string): void {
  const buildKey = svcKeyToBuildKey.get(svcKey);
  if (!buildKey) return;

  evictBuildKey(buildKey);
  log.debug(`Flushed via svc_key=${svcKey} → buildKey=${buildKey}`);
}

/**
 * Flush all handlers associated with a databaseId.
 */
export function flushByDatabaseId(databaseId: string): void {
  const buildKeys = databaseIdToBuildKeys.get(databaseId);
  if (!buildKeys || buildKeys.size === 0) return;

  // Copy to avoid mutation during iteration
  const keysToEvict = [...buildKeys];
  for (const buildKey of keysToEvict) {
    evictBuildKey(buildKey);
  }

  // Clean up the databaseId entry (evictBuildKey already removes individual keys)
  databaseIdToBuildKeys.delete(databaseId);

  log.debug(`Flushed ${keysToEvict.length} handler(s) for databaseId=${databaseId}`);
}

async function disposeTenant(tenant: TenantInstance): Promise<void> {
  try {
    if (tenant.httpServer?.listening) {
      await new Promise<void>((resolve) => {
        tenant.httpServer.close(() => resolve());
      });
    }
    if (tenant.pgl) {
      await tenant.pgl.release();
    }
  } catch (err) {
    log.error(`Error disposing handler buildKey=${tenant.buildKey}:`, err);
  }
}

/**
 * Get diagnostic stats for the multi-tenancy cache system.
 */
export function getMultiTenancyCacheStats(): MultiTenancyCacheStats {
  return {
    handlerCacheSize: handlerCache.size,
    svcKeyMappings: svcKeyToBuildKey.size,
    databaseIdMappings: databaseIdToBuildKeys.size,
    inflightCreations: creatingHandlers.size,
  };
}

/**
 * Release all resources — handler cache, indexes, and in-flight trackers.
 */
export async function shutdownMultiTenancyCache(): Promise<void> {
  log.info('Shutting down multi-tenancy cache...');

  // Dispose all cached handlers
  const disposals: Promise<void>[] = [];
  for (const handler of handlerCache.values()) {
    disposals.push(disposeTenant(handler));
  }
  await Promise.allSettled(disposals);

  // Clear all state
  handlerCache.clear();
  svcKeyToBuildKey.clear();
  databaseIdToBuildKeys.clear();
  creatingHandlers.clear();
  presetBuilder = null;

  log.info('Multi-tenancy cache shutdown complete');
}
