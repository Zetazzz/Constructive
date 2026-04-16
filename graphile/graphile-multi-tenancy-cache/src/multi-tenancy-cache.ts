/**
 * Multi-tenancy cache orchestrator.
 *
 * Owns the full tenant lifecycle: tenant instance cache, template
 * registry interaction, introspection cache interaction, single-flight
 * coalescing, and preset wrapping.
 */

import { createServer } from 'node:http';
import { Logger } from '@pgpmjs/logger';
import express from 'express';
import { postgraphile } from 'postgraphile';
import { grafserv } from 'grafserv/express/v4';
import type { Pool } from 'pg';
import type { GraphileConfig } from 'graphile-config';

import { PgMultiTenancyWrapperPlugin } from './plugins/pg-client-wrapper-plugin';
import {
  getOrCreateIntrospection,
  invalidateIntrospection,
  clearIntrospectionCache,
  getIntrospectionCacheStats,
  getConnectionKey,
} from './introspection-cache';
import {
  getTemplate,
  setTemplate,
  registerTenant,
  deregisterTenant,
  clearAllTemplates,
  getTemplateStats,
  sweepIdleTemplates,
  type RegistryTemplate,
} from './registry-template-map';
import { buildSchemaRemapTransform, clearRewriteCache, getRewriteCacheStats } from './utils/sql-transform';
import { buildSchemaMap } from './utils/schema-map';

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
  sqlTextTransform: ((text: string) => Promise<string>) | null;
  fingerprint: string;
  schemas: string[];
  isDedicated: boolean;
  createdAt: number;
  lastUsedAt: number;
}

export interface DedicatedInstance {
  cacheKey: string;
  handler: import('express').Express;
  pgl: import('postgraphile').PostGraphileInstance;
  httpServer: import('http').Server;
  createdAt: number;
  lastUsedAt: number;
  source: 'introspection-failure';
}

export interface MultiTenancyCacheStats {
  tenantInstances: number;
  templates: ReturnType<typeof getTemplateStats>;
  introspection: ReturnType<typeof getIntrospectionCacheStats>;
  rewriteCache: ReturnType<typeof getRewriteCacheStats>;
  dedicatedInstances: number;
  inflightTenants: number;
  inflightTemplates: number;
}

// --- Internal state ---

const tenantInstances = new Map<string, TenantInstance>();
const creatingTenants = new Map<string, Promise<TenantInstance>>();
const creatingTemplates = new Map<string, Promise<RegistryTemplate>>();
const dedicatedInstances = new Map<string, DedicatedInstance>();

/** The wrapped preset builder, set once by configureMultiTenancyCache(). */
let wrappedPresetBuilder: ((
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
 * One-time package bootstrap. Stores the wrapped preset builder internally.
 * Must be called before any getOrCreateTenantInstance() calls.
 */
export function configureMultiTenancyCache(config: MultiTenancyCacheConfig): void {
  const { basePresetBuilder } = config;

  wrappedPresetBuilder = (pool, schemas, anonRole, roleName) => {
    const basePreset = basePresetBuilder(pool, schemas, anonRole, roleName);

    // Add the wrapper plugin
    const plugins = [...(basePreset.plugins || []), PgMultiTenancyWrapperPlugin];

    // Add Grafast context callback that injects pgSqlTextTransform
    const originalContext = basePreset.grafast?.context;

    const wrappedContext = (requestContext: Partial<Grafast.RequestContext>, args: any) => {
      const base = typeof originalContext === 'function'
        ? (originalContext as Function)(requestContext, args)
        : (originalContext || {});

      // Read svc_key from Express request
      const req = (requestContext as any)?.expressv4?.req;
      const svcKey = req?.svc_key as string | undefined;

      if (svcKey) {
        const tenant = tenantInstances.get(svcKey);
        if (tenant?.sqlTextTransform) {
          return {
            ...base,
            pgSqlTextTransform: tenant.sqlTextTransform,
          };
        }
      }

      return base;
    };

    return {
      ...basePreset,
      plugins,
      grafast: {
        ...basePreset.grafast,
        context: wrappedContext,
      },
    };
  };

  log.info('Multi-tenancy cache configured');
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
 * Flow:
 * 1. Check tenantInstances map (fast path) → return if hit
 * 2. Check creatingTenants map (single-flight coalesce) → wait if in-flight
 * 3. getOrCreateIntrospection(pool, schemas, connectionKey) → fingerprint
 * 4. getTemplate(fingerprint) → hit? → reuse, registerTenant()
 * 5. Miss → check creatingTemplates (single-flight for template)
 * 6. Miss → createTemplate() (builds PostGraphile instance, setTemplate())
 * 7. Build TenantInstance with buildSchemaRemapTransform() as sqlTextTransform
 * 8. Store in tenantInstances map → return
 */
export async function getOrCreateTenantInstance(
  config: TenantConfig,
): Promise<TenantInstance> {
  const { cacheKey, pool, schemas, anonRole, roleName } = config;

  if (!wrappedPresetBuilder) {
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

  // Step 3: Introspect + fingerprint
  let fingerprint: string;
  let templateSchemas: string[];

  try {
    const connectionKey = getConnectionKey(pool);
    const introspection = await getOrCreateIntrospection(pool, schemas, connectionKey);
    fingerprint = introspection.fingerprint;
    templateSchemas = schemas; // The schemas used for introspection become the template schemas
  } catch (err) {
    // Fallback: create dedicated (non-shared) instance
    log.warn(`Introspection failed for ${cacheKey}, falling back to dedicated instance`, err);
    return createDedicatedFallback(config);
  }

  // Step 4: Check template cache
  let template = getTemplate(fingerprint);

  if (!template) {
    // Step 5: Check single-flight for template creation
    const pendingTemplate = creatingTemplates.get(fingerprint);
    if (pendingTemplate) {
      template = await pendingTemplate;
    } else {
      // Step 6: Create new template
      const templatePromise = doCreateTemplate(
        fingerprint,
        pool,
        schemas,
        anonRole,
        roleName,
      );
      creatingTemplates.set(fingerprint, templatePromise);

      try {
        template = await templatePromise;
      } finally {
        creatingTemplates.delete(fingerprint);
      }
    }
  }

  // Step 7: Build tenant instance with SQL remap transform
  // The template was built with templateSchemas. Build the remap
  // from template schemas to this tenant's schemas.
  const schemaMap = buildSchemaMap(
    // Template uses the first tenant's schemas as its base
    [...template.tenantKeys][0]
      ? tenantInstances.get([...template.tenantKeys][0])?.schemas || schemas
      : schemas,
    schemas,
  );

  const sqlTextTransform = Object.keys(schemaMap).length > 0
    ? buildSchemaRemapTransform(schemaMap)
    : null;

  const tenant: TenantInstance = {
    cacheKey,
    handler: template.handler,
    sqlTextTransform,
    fingerprint,
    schemas,
    isDedicated: false,
    createdAt: Date.now(),
    lastUsedAt: Date.now(),
  };

  // Step 8: Store and register
  tenantInstances.set(cacheKey, tenant);
  registerTenant(cacheKey, fingerprint);

  log.info(
    `Tenant instance created key=${cacheKey} fingerprint=${fingerprint.slice(0, 12)}… ` +
    `shared=${template.tenantKeys.size > 0} schemaMapSize=${Object.keys(schemaMap).length}`,
  );

  return tenant;
}

async function doCreateTemplate(
  fingerprint: string,
  pool: Pool,
  schemas: string[],
  anonRole: string,
  roleName: string,
): Promise<RegistryTemplate> {
  log.info(`Building new template fingerprint=${fingerprint.slice(0, 12)}…`);

  const preset = wrappedPresetBuilder!(pool, schemas, anonRole, roleName);
  const pgl = postgraphile(preset);
  const serv = pgl.createServ(grafserv);

  const handler = express();
  const httpServer = createServer(handler);
  await serv.addTo(handler, httpServer);
  await serv.ready();

  const template: RegistryTemplate = {
    fingerprint,
    pgl,
    serv,
    handler,
    httpServer,
    refCount: 0,
    tenantKeys: new Set(),
    createdAt: Date.now(),
  };

  setTemplate(fingerprint, template);
  return template;
}

/**
 * Create a dedicated (non-shared) fallback instance when introspection fails.
 * Tracked with lifecycle metadata for cleanup.
 */
async function createDedicatedFallback(
  config: TenantConfig,
): Promise<TenantInstance> {
  const { cacheKey, pool, schemas, anonRole, roleName } = config;

  log.warn(`Creating dedicated fallback instance for ${cacheKey}`);

  const preset = wrappedPresetBuilder!(pool, schemas, anonRole, roleName);
  const pgl = postgraphile(preset);
  const serv = pgl.createServ(grafserv);

  const handler = express();
  const httpServer = createServer(handler);
  await serv.addTo(handler, httpServer);
  await serv.ready();

  const dedicated: DedicatedInstance = {
    cacheKey,
    handler,
    pgl,
    httpServer,
    createdAt: Date.now(),
    lastUsedAt: Date.now(),
    source: 'introspection-failure',
  };

  dedicatedInstances.set(cacheKey, dedicated);

  const tenant: TenantInstance = {
    cacheKey,
    handler,
    sqlTextTransform: null,
    fingerprint: `dedicated:${cacheKey}`,
    schemas,
    isDedicated: true,
    createdAt: Date.now(),
    lastUsedAt: Date.now(),
  };

  tenantInstances.set(cacheKey, tenant);
  return tenant;
}

/**
 * Evict a tenant from the cache + deregister from template refCount.
 * Also releases any dedicated fallback instance.
 */
export function flushTenantInstance(cacheKey: string): void {
  const tenant = tenantInstances.get(cacheKey);
  if (!tenant) return;

  tenantInstances.delete(cacheKey);

  if (!tenant.isDedicated) {
    deregisterTenant(cacheKey);
  }

  // Release dedicated instance if it exists
  const dedicated = dedicatedInstances.get(cacheKey);
  if (dedicated) {
    dedicatedInstances.delete(cacheKey);
    disposeDedicated(dedicated).catch((err) => {
      log.error(`Failed to dispose dedicated instance ${cacheKey}:`, err);
    });
  }

  log.debug(`Flushed tenant instance key=${cacheKey}`);
}

async function disposeDedicated(dedicated: DedicatedInstance): Promise<void> {
  try {
    if (dedicated.httpServer?.listening) {
      await new Promise<void>((resolve) => {
        dedicated.httpServer.close(() => resolve());
      });
    }
    if (dedicated.pgl) {
      await dedicated.pgl.release();
    }
  } catch (err) {
    log.error(`Error disposing dedicated instance ${dedicated.cacheKey}:`, err);
  }
}

/**
 * Get diagnostic stats for the entire multi-tenancy cache system.
 */
export function getMultiTenancyCacheStats(): MultiTenancyCacheStats {
  return {
    tenantInstances: tenantInstances.size,
    templates: getTemplateStats(),
    introspection: getIntrospectionCacheStats(),
    rewriteCache: getRewriteCacheStats(),
    dedicatedInstances: dedicatedInstances.size,
    inflightTenants: creatingTenants.size,
    inflightTemplates: creatingTemplates.size,
  };
}

/**
 * Release all resources — templates, dedicated instances, introspection cache, tenantInstances.
 */
export async function shutdownMultiTenancyCache(): Promise<void> {
  log.info('Shutting down multi-tenancy cache...');

  // Clear tenant instances
  tenantInstances.clear();
  creatingTenants.clear();
  creatingTemplates.clear();

  // Dispose dedicated instances
  for (const dedicated of dedicatedInstances.values()) {
    await disposeDedicated(dedicated);
  }
  dedicatedInstances.clear();

  // Clear caches
  await clearAllTemplates();
  clearIntrospectionCache();
  clearRewriteCache();

  wrappedPresetBuilder = null;

  log.info('Multi-tenancy cache shutdown complete');
}
