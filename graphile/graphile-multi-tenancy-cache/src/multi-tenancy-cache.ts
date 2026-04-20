/**
 * Multi-tenancy cache orchestrator (v4 — de-templated).
 *
 * Creates and caches one independent PostGraphile handler per svc_key.
 * No template sharing, no SQL rewrite, no fingerprinting.
 *
 * Keeps the same public API surface as v3 so the server-side wiring
 * (multiTenancyHandler, createFlushMiddleware, shutdownMultiTenancy)
 * continues to work unchanged.
 */

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
  cacheKey: string;
  pool: Pool;
  schemas: string[];
  anonRole: string;
  roleName: string;
  databaseId?: string;
}

export interface TenantInstance {
  cacheKey: string;
  handler: import('express').Express;
  schemas: string[];
  pgl: import('postgraphile').PostGraphileInstance;
  httpServer: import('http').Server;
  createdAt: number;
  lastUsedAt: number;
}

export interface MultiTenancyCacheStats {
  tenantInstances: number;
  inflightTenants: number;
}

// --- Internal state ---

const tenantInstances = new Map<string, TenantInstance>();
const creatingTenants = new Map<string, Promise<TenantInstance>>();

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
 *
 * v4: no wrapping — the preset builder is used as-is to create
 * one independent PostGraphile instance per svc_key.
 */
export function configureMultiTenancyCache(config: MultiTenancyCacheConfig): void {
  presetBuilder = config.basePresetBuilder;
  log.info('Multi-tenancy cache configured (v4 — independent handlers)');
}

// --- Core API ---

/**
 * Fast-path lookup from internal tenant instances map.
 */
export function getTenantInstance(cacheKey: string): TenantInstance | undefined {
  const tenant = tenantInstances.get(cacheKey);
  if (tenant) {
    tenant.lastUsedAt = Date.now();
  }
  return tenant;
}

/**
 * Resolve or create a tenant instance.
 *
 * v4 flow (simplified — no template sharing):
 * 1. Check tenantInstances map (fast path) → return if hit
 * 2. Check creatingTenants map (single-flight coalesce) → wait if in-flight
 * 3. Create a new independent PostGraphile instance for this svc_key
 * 4. Store in tenantInstances map → return
 */
export async function getOrCreateTenantInstance(
  config: TenantConfig,
): Promise<TenantInstance> {
  const { cacheKey } = config;

  if (!presetBuilder) {
    throw new Error('Multi-tenancy cache not configured. Call configureMultiTenancyCache() first.');
  }

  // Step 1: Fast path
  const existing = tenantInstances.get(cacheKey);
  if (existing) {
    existing.lastUsedAt = Date.now();
    return existing;
  }

  // Step 2: Single-flight coalesce
  const pending = creatingTenants.get(cacheKey);
  if (pending) {
    return pending;
  }

  const promise = doCreateTenantInstance(config);
  creatingTenants.set(cacheKey, promise);

  try {
    return await promise;
  } finally {
    creatingTenants.delete(cacheKey);
  }
}

async function doCreateTenantInstance(
  config: TenantConfig,
): Promise<TenantInstance> {
  const { cacheKey, pool, schemas, anonRole, roleName } = config;
  const schemaLabel = schemas.join(',') || 'unknown';

  log.info(`Building independent handler key=${cacheKey} schemas=${schemaLabel}`);

  const preset = presetBuilder!(pool, schemas, anonRole, roleName);
  const pgl = postgraphile(preset);
  const serv = pgl.createServ(grafserv);

  const handler = express();
  const httpServer = createServer(handler);
  await serv.addTo(handler, httpServer);
  await serv.ready();

  const tenant: TenantInstance = {
    cacheKey,
    handler,
    schemas,
    pgl,
    httpServer,
    createdAt: Date.now(),
    lastUsedAt: Date.now(),
  };

  tenantInstances.set(cacheKey, tenant);

  log.info(`Tenant instance created key=${cacheKey} schemas=${schemaLabel}`);
  return tenant;
}

/**
 * Evict a tenant from the cache and release its PostGraphile instance.
 */
export function flushTenantInstance(cacheKey: string): void {
  const tenant = tenantInstances.get(cacheKey);
  if (!tenant) return;

  tenantInstances.delete(cacheKey);
  disposeTenant(tenant).catch((err) => {
    log.error(`Failed to dispose tenant ${cacheKey}:`, err);
  });

  log.debug(`Flushed tenant instance key=${cacheKey}`);
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
    log.error(`Error disposing tenant ${tenant.cacheKey}:`, err);
  }
}

/**
 * Get diagnostic stats for the multi-tenancy cache system.
 */
export function getMultiTenancyCacheStats(): MultiTenancyCacheStats {
  return {
    tenantInstances: tenantInstances.size,
    inflightTenants: creatingTenants.size,
  };
}

/**
 * Release all resources — tenant instances and in-flight trackers.
 */
export async function shutdownMultiTenancyCache(): Promise<void> {
  log.info('Shutting down multi-tenancy cache...');

  // Dispose all tenant instances
  const disposals: Promise<void>[] = [];
  for (const tenant of tenantInstances.values()) {
    disposals.push(disposeTenant(tenant));
  }
  await Promise.allSettled(disposals);

  tenantInstances.clear();
  creatingTenants.clear();
  presetBuilder = null;

  log.info('Multi-tenancy cache shutdown complete');
}
