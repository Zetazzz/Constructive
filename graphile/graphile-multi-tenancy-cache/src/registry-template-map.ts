/**
 * Registry Template Map
 *
 * A global, static Map<Fingerprint, TemplateEntry> that stores "Template Registries."
 * When a new tenant is initialized, its schema is fingerprinted. If a matching
 * fingerprint exists, the existing PgRegistry + GraphQLSchema are reused,
 * drastically reducing RAM and startup time.
 */

import { Logger } from '@pgpmjs/logger';

const log = new Logger('multi-tenancy-cache:registry-map');

/**
 * A template entry caches the expensive-to-build objects that can be
 * shared across tenants with identical schema structures.
 */
export interface RegistryTemplate {
  /** The structural fingerprint that produced this template */
  fingerprint: string;

  /**
   * The PostGraphile instance from the first tenant with this structure.
   * Contains the PgRegistry, GraphQLSchema, and all plan resolvers.
   * This is an in-memory object with live function references — not serializable.
   */
  pgl: import('postgraphile').PostGraphileInstance;

  /**
   * The grafserv instance bound to this template.
   */
  serv: import('grafserv').GrafservBase;

  /**
   * The Express handler for this template.
   */
  handler: import('express').Express;

  /**
   * HTTP server instance (required by grafserv).
   */
  httpServer: import('http').Server;

  /**
   * The original preset used to build this template (sans pgServices).
   * Used for reference/debugging.
   */
  basePresetSnapshot: Record<string, unknown>;

  /** Timestamp when this template was first created */
  createdAt: number;

  /** Number of tenants currently sharing this template */
  refCount: number;

  /** Schema names of the first tenant (the "template" schema) */
  templateSchemas: string[];
}

/**
 * Global template registry: fingerprint -> RegistryTemplate
 */
const templateMap = new Map<string, RegistryTemplate>();

/**
 * Reverse lookup: tenant cache key -> fingerprint
 * Used to decrement refCount when a tenant is evicted.
 */
const tenantFingerprints = new Map<string, string>();

/**
 * Get or create a template entry for the given fingerprint.
 * Returns the existing template if one exists, or null if none found.
 */
export function getTemplate(fingerprint: string): RegistryTemplate | null {
  const template = templateMap.get(fingerprint);
  if (template) {
    log.debug(`Template hit for fingerprint ${fingerprint.substring(0, 16)}... (refCount: ${template.refCount})`);
    return template;
  }
  log.debug(`Template miss for fingerprint ${fingerprint.substring(0, 16)}...`);
  return null;
}

/**
 * Store a new template entry.
 */
export function setTemplate(fingerprint: string, template: RegistryTemplate): void {
  templateMap.set(fingerprint, template);
  log.info(
    `Template stored: ${fingerprint.substring(0, 16)}... ` +
    `(schemas: ${template.templateSchemas.join(',')}, total templates: ${templateMap.size})`,
  );
}

/**
 * Register a tenant as using a specific template.
 */
export function registerTenant(cacheKey: string, fingerprint: string): void {
  const existing = tenantFingerprints.get(cacheKey);
  if (existing === fingerprint) {
    return; // Already registered
  }

  // If tenant was previously registered with a different fingerprint, deregister first
  if (existing) {
    deregisterTenant(cacheKey);
  }

  tenantFingerprints.set(cacheKey, fingerprint);
  const template = templateMap.get(fingerprint);
  if (template) {
    template.refCount++;
    log.debug(`Tenant ${cacheKey} registered with template ${fingerprint.substring(0, 16)}... (refCount: ${template.refCount})`);
  }
}

/**
 * Deregister a tenant from its template.
 * Called when the tenant's cache entry is evicted.
 */
export function deregisterTenant(cacheKey: string): void {
  const fingerprint = tenantFingerprints.get(cacheKey);
  if (!fingerprint) return;

  tenantFingerprints.delete(cacheKey);
  const template = templateMap.get(fingerprint);
  if (template) {
    template.refCount = Math.max(0, template.refCount - 1);
    log.debug(`Tenant ${cacheKey} deregistered from template ${fingerprint.substring(0, 16)}... (refCount: ${template.refCount})`);

    // Do NOT auto-dispose templates with refCount=0 — they may be reused soon.
    // Templates are only cleaned up via explicit clearAllTemplates().
  }
}

/**
 * Get statistics about the template registry.
 */
export function getTemplateStats(): {
  templateCount: number;
  tenantCount: number;
  templates: Array<{
    fingerprint: string;
    refCount: number;
    templateSchemas: string[];
    createdAt: number;
  }>;
} {
  const templates = [...templateMap.values()].map((t) => ({
    fingerprint: t.fingerprint,
    refCount: t.refCount,
    templateSchemas: t.templateSchemas,
    createdAt: t.createdAt,
  }));

  return {
    templateCount: templateMap.size,
    tenantCount: tenantFingerprints.size,
    templates,
  };
}

/**
 * Get the fingerprint for a specific tenant cache key.
 */
export function getTenantFingerprint(cacheKey: string): string | null {
  return tenantFingerprints.get(cacheKey) || null;
}

/**
 * Clear all templates and release resources.
 * Used during shutdown or full cache invalidation.
 */
export async function clearAllTemplates(): Promise<void> {
  log.info(`Clearing all templates (${templateMap.size} templates, ${tenantFingerprints.size} tenants)`);

  const disposePromises: Promise<void>[] = [];

  for (const [fingerprint, template] of templateMap) {
    disposePromises.push(
      (async () => {
        try {
          if (template.httpServer?.listening) {
            await new Promise<void>((resolve) => {
              template.httpServer.close(() => resolve());
            });
          }
          if (template.pgl) {
            await template.pgl.release();
          }
          log.debug(`Template ${fingerprint.substring(0, 16)}... disposed`);
        } catch (err) {
          log.error(`Error disposing template ${fingerprint.substring(0, 16)}...:`, err);
        }
      })(),
    );
  }

  await Promise.allSettled(disposePromises);
  templateMap.clear();
  tenantFingerprints.clear();
  log.info('All templates cleared');
}
