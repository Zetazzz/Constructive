/**
 * Multi-Tenancy Cache
 *
 * The core module that orchestrates template-based multi-tenancy:
 *
 * 1. On first request for a tenant:
 *    - Introspect the tenant's database schemas
 *    - Generate a structural fingerprint (ignoring schema names)
 *    - Check the template map for a matching fingerprint
 *    - If match: reuse the existing PostGraphile instance (shared PgRegistry + GraphQLSchema)
 *    - If no match: build a new instance and store it as a template
 *
 * 2. For each tenant, we create a lightweight "tenant handler" that:
 *    - Points to the shared template's Express handler
 *    - Injects the tenant's schema names into pgSettings at request time
 *    - Uses the shared PgRegistry/GraphQLSchema (zero additional memory)
 *
 * SQL Remapping (Wrapper Approach — no Crystal changes required):
 * - `PgMultiTenancyWrapperPlugin` wraps `client.query()` per-request
 *   via Grafast `prepareArgs` middleware.
 * - `buildSchemaRemapTransform` produces a single-pass regex that replaces
 *   the template's schema identifiers with the real tenant's schema names.
 * - This works with the published Crystal/PostGraphile packages —
 *   no fork or upstream PR required.
 *
 * This approach reduces memory from O(N * schema_size) to O(K * schema_size)
 * where K is the number of *unique* schema structures (typically 1-3) and N
 * is the number of tenants (potentially hundreds).
 */

import { createServer } from 'node:http';

import { Logger } from '@pgpmjs/logger';
import type { Express } from 'express';
import express from 'express';
import { grafserv } from 'grafserv/express/v4';
import type { GraphileConfig } from 'graphile-config';
import type { Pool } from 'pg';
import { postgraphile } from 'postgraphile';

import {
  buildSchemaMap,
  buildSchemaRemapTransform,
  buildTenantPgSettings
} from './dynamic-schema';
import type { IntrospectionCacheStats } from './introspection-cache';
import { clearIntrospectionCache, getIntrospectionCacheStats,getOrCreateIntrospection } from './introspection-cache';
import type { RegistryTemplate } from './registry-template-map';
import {
  clearAllTemplates,
  deregisterTenant,
  getTemplate,
  getTemplateStats,
  registerTenant,
  setTemplate
} from './registry-template-map';

const log = new Logger('multi-tenancy-cache');

// =============================================================================
// Types
// =============================================================================

export interface TenantConfig {
  /** Unique cache key for this tenant (e.g., 'db123.schema456') */
  cacheKey: string;

  /** PostgreSQL connection pool for this tenant's database */
  pool: Pool;

  /** Schema names to expose via GraphQL */
  schemas: string[];

  /** The database name */
  dbname: string;

  /** Anonymous role for unauthenticated requests */
  anonRole: string;

  /** Authenticated role */
  roleName: string;

  /** Optional database ID for context injection */
  databaseId?: string;

  /** Base preset to extend (default: use the provided preset builder) */
  basePreset?: GraphileConfig.Preset;
}

export interface TenantInstance {
  /** The Express handler to route requests through */
  handler: Express;

  /** Whether this tenant is sharing a template (true) or has its own instance (false) */
  isShared: boolean;

  /** The structural fingerprint of this tenant's schema */
  fingerprint: string;

  /** The template schemas this tenant maps from (if shared) */
  templateSchemas: string[];

  /**
   * The sqlTextTransform for this tenant. Replaces the template's
   * schema identifiers with the real tenant's schema names in SQL.
   * Injected per-request by `PgMultiTenancyWrapperPlugin` via
   * `client.query()` interception.
   *
   * Always a function (never null) — for the identity case (template schemas
   * == tenant schemas) this is a no-op that returns the input unchanged.
   */
  sqlTextTransform: (text: string) => string;

  /**
   * pgSettings to inject into each request for this tenant.
   * Includes `search_path` set to the tenant's schemas.
   */
  pgSettings: Record<string, string>;
}

export interface MultiTenancyCacheStats {
  /** Number of unique schema templates */
  templateCount: number;

  /** Number of registered tenants */
  tenantCount: number;

  /** Breakdown by template */
  templates: Array<{
    fingerprint: string;
    refCount: number;
    templateSchemas: string[];
    createdAt: number;
    idleSince: number | null;
  }>;

  /** Memory savings estimate */
  memorySavings: {
    /** Tenants sharing templates (would have been separate instances) */
    sharedTenants: number;
    /** Estimated MB saved (rough: ~50MB per PostGraphile instance) */
    estimatedMbSaved: number;
  };

  /** Introspection cache statistics */
  introspectionCache: IntrospectionCacheStats;
}

// =============================================================================
// Helpers
// =============================================================================

/** No-op transform used when no schema remapping is needed (dedicated instances). */
const identityTransform = (text: string): string => text;

/**
 * Build a TenantInstance from a shared (or first-use) template.
 *
 * Centralizes the repeated pattern of:
 *   buildSchemaMap → buildSchemaRemapTransform → buildTenantPgSettings
 * into a single call site.
 */
function buildTenantResult(
  handler: Express,
  isShared: boolean,
  fingerprint: string,
  templateSchemas: string[],
  tenantSchemas: string[]
): TenantInstance {
  const schemaMap = buildSchemaMap(templateSchemas, tenantSchemas);
  const transform = buildSchemaRemapTransform(schemaMap);
  const pgSettings = buildTenantPgSettings(tenantSchemas);

  return {
    handler,
    isShared,
    fingerprint,
    templateSchemas,
    sqlTextTransform: transform,
    pgSettings
  };
}

// =============================================================================
// Single-Flight Pattern for Template Creation
// =============================================================================

const creatingTemplates = new Map<string, Promise<RegistryTemplate>>();

/**
 * Tracks dedicated (non-shared) PostGraphile instances so they can be
 * properly released during shutdown.
 */
const dedicatedInstances = new Map<string, {
  pgl: ReturnType<typeof postgraphile>;
  httpServer: import('node:http').Server;
}>();

// =============================================================================
// Core Multi-Tenancy Cache Functions
// =============================================================================

/**
 * Get or create a tenant instance using template-based sharing.
 *
 * This is the main entry point for the multi-tenancy cache. It:
 * 1. Introspects the tenant's schemas
 * 2. Fingerprints the structure
 * 3. Reuses an existing template if the fingerprint matches
 * 4. Creates a new template if no match
 *
 * When a template is reused, a `sqlTextTransform` is provided that
 * remaps the template's schema identifiers to the tenant's actual
 * schema names.  This transform is applied per-request by
 * `PgMultiTenancyWrapperPlugin` at the `client.query()` level.
 *
 * @param config - Tenant configuration
 * @param presetBuilder - Function to build the GraphileConfig preset.
 *   IMPORTANT: The preset MUST include `PgMultiTenancyWrapperPlugin`
 *   in its plugins so that per-request SQL remapping is applied.
 * @returns Tenant instance with handler, transform, and metadata
 */
export async function getOrCreateTenantInstance(
  config: TenantConfig,
  presetBuilder: (pool: Pool, schemas: string[], anonRole: string, roleName: string) => GraphileConfig.Preset
): Promise<TenantInstance> {
  const { cacheKey, pool, schemas, dbname, anonRole, roleName } = config;

  log.info(`Resolving tenant instance: key=${cacheKey} db=${dbname} schemas=${schemas.join(',')}`);

  // Step 1: Introspect and fingerprint (with in-memory cache)
  let fingerprint: string;
  try {
    const cached = await getOrCreateIntrospection(pool, schemas, dbname);
    fingerprint = cached.fingerprint;
  } catch (err) {
    log.error(`Introspection failed for tenant ${cacheKey}:`, err);
    // Fallback: create a dedicated instance without sharing
    return createDedicatedInstance(config, presetBuilder);
  }

  log.debug(`Tenant ${cacheKey} fingerprint: ${fingerprint.substring(0, 16)}...`);

  // Step 2: Check template map
  const existingTemplate = getTemplate(fingerprint);
  if (existingTemplate) {
    log.info(
      `Template REUSE for tenant ${cacheKey} ` +
      `(fingerprint: ${fingerprint.substring(0, 16)}..., ` +
      `template schemas: ${existingTemplate.templateSchemas.join(',')})`
    );

    registerTenant(cacheKey, fingerprint);

    return buildTenantResult(
      existingTemplate.handler,
      true,
      fingerprint,
      existingTemplate.templateSchemas,
      schemas
    );
  }

  // Step 3: Check single-flight for this fingerprint
  const inFlight = creatingTemplates.get(fingerprint);
  if (inFlight) {
    log.debug(`Coalescing template creation for fingerprint ${fingerprint.substring(0, 16)}...`);
    try {
      const template = await inFlight;
      registerTenant(cacheKey, fingerprint);

      return buildTenantResult(
        template.handler,
        true,
        fingerprint,
        template.templateSchemas,
        schemas
      );
    } catch (err) {
      log.warn(`Coalesced template creation failed for tenant ${cacheKey} ` +
        `(fingerprint: ${fingerprint.substring(0, 16)}...):`, err);
      throw err;
    }
  }

  // Step 4: Create new template (with pgIdentifiers: "dynamic")
  log.info(`Creating NEW template for tenant ${cacheKey} (fingerprint: ${fingerprint.substring(0, 16)}...)`);

  const createPromise = createTemplate(config, presetBuilder, fingerprint);
  creatingTemplates.set(fingerprint, createPromise);

  try {
    const template = await createPromise;
    registerTenant(cacheKey, fingerprint);

    // First tenant for this template — identity transform
    // (template schemas == tenant schemas, so placeholders map to same names)
    return buildTenantResult(
      template.handler,
      false,
      fingerprint,
      template.templateSchemas,
      schemas
    );
  } catch (err) {
    log.error(`Template creation failed for fingerprint ${fingerprint.substring(0, 16)}...:`, err);
    throw err;
  } finally {
    creatingTemplates.delete(fingerprint);
  }
}

/**
 * Create a new template from a tenant's configuration.
 * The template is built with the tenant's real schema names — no
 * placeholder mode required.  Schema remapping is handled at runtime
 * by `PgMultiTenancyWrapperPlugin`.
 */
async function createTemplate(
  config: TenantConfig,
  presetBuilder: (pool: Pool, schemas: string[], anonRole: string, roleName: string) => GraphileConfig.Preset,
  fingerprint: string
): Promise<RegistryTemplate> {
  const { pool, schemas, anonRole, roleName } = config;

  let pgl: ReturnType<typeof postgraphile> | undefined;
  let httpServer: import('node:http').Server | undefined;

  try {
    const preset = presetBuilder(pool, schemas, anonRole, roleName);
    pgl = postgraphile(preset);
    const serv = pgl.createServ(grafserv);

    const handler = express();
    httpServer = createServer(handler);
    await serv.addTo(handler as any, httpServer);
    await serv.ready();

    const template: RegistryTemplate = {
      fingerprint,
      pgl,
      serv,
      handler,
      httpServer,
      basePresetSnapshot: { schemas, anonRole, roleName },
      createdAt: Date.now(),
      refCount: 0,
      idleSince: Date.now(), // Starts idle — registerTenant() will clear this
      templateSchemas: [...schemas]
    };

    setTemplate(fingerprint, template);
    return template;
  } catch (err) {
    // Clean up partially created resources to prevent leaks
    if (httpServer) {
      try { httpServer.close(); } catch (_) { /* best-effort */ }
    }
    if (pgl) {
      try { await pgl.release(); } catch (_) { /* best-effort */ }
    }
    throw err;
  }
}

/**
 * Fallback: create a dedicated (non-shared) PostGraphile instance.
 * Used when introspection/fingerprinting fails or schema is unique.
 */
async function createDedicatedInstance(
  config: TenantConfig,
  presetBuilder: (pool: Pool, schemas: string[], anonRole: string, roleName: string) => GraphileConfig.Preset
): Promise<TenantInstance> {
  const { pool, schemas, anonRole, roleName } = config;

  log.warn(`Creating dedicated (non-shared) instance for tenant ${config.cacheKey}`);

  const preset = presetBuilder(pool, schemas, anonRole, roleName);
  const pgl = postgraphile(preset);
  const serv = pgl.createServ(grafserv);

  const handler = express();
  const httpServer = createServer(handler);
  await serv.addTo(handler as any, httpServer);
  await serv.ready();

  // Track for proper cleanup during shutdown
  dedicatedInstances.set(config.cacheKey, { pgl, httpServer });

  return {
    handler,
    isShared: false,
    fingerprint: 'dedicated-' + config.cacheKey,
    templateSchemas: [...schemas],
    sqlTextTransform: identityTransform,
    pgSettings: buildTenantPgSettings(schemas)
  };
}

/**
 * Notify the multi-tenancy cache that a tenant has been evicted.
 * Should be called when a tenant's cache entry is evicted.
 */
export function onTenantEvicted(cacheKey: string): void {
  deregisterTenant(cacheKey);
}

/**
 * Get comprehensive cache statistics.
 */
export function getMultiTenancyCacheStats(): MultiTenancyCacheStats {
  const stats = getTemplateStats();
  const sharedTenants = stats.tenantCount - stats.templateCount;

  return {
    ...stats,
    memorySavings: {
      sharedTenants: Math.max(0, sharedTenants),
      // Rough estimate: each PostGraphile instance uses ~50MB for a typical schema
      estimatedMbSaved: Math.max(0, sharedTenants) * 50
    },
    introspectionCache: getIntrospectionCacheStats()
  };
}

/**
 * Shut down all templates and dedicated instances, releasing resources.
 */
export async function shutdownMultiTenancyCache(): Promise<void> {
  log.info('Shutting down multi-tenancy cache...');
  creatingTemplates.clear();
  clearIntrospectionCache();

  // Release dedicated (non-shared) instances
  for (const [key, { pgl, httpServer }] of dedicatedInstances) {
    try {
      await pgl.release();
      httpServer.close();
      log.debug(`Released dedicated instance: ${key}`);
    } catch (err) {
      log.warn(`Error releasing dedicated instance ${key}:`, err);
    }
  }
  dedicatedInstances.clear();

  await clearAllTemplates();
  log.info('Multi-tenancy cache shut down');
}
