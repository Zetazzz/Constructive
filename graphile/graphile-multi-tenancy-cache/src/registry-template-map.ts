/**
 * Registry Template Map
 *
 * A global, static Map<Fingerprint, TemplateEntry> that stores "Template Registries."
 * When a new tenant is initialized, its schema is fingerprinted. If a matching
 * fingerprint exists, the existing PgRegistry + GraphQLSchema are reused,
 * drastically reducing RAM and startup time.
 *
 * ## Eviction Policy
 *
 * Templates are decommissioned when they become idle (refCount reaches 0) and
 * remain idle longer than `IDLE_TTL_MS`.  Additionally, when the total number
 * of templates exceeds `MAX_TEMPLATES`, the oldest idle templates are evicted
 * first (LRU-style).  Eviction properly releases all resources (`pgl.release()`,
 * `httpServer.close()`).
 *
 * A periodic sweep timer runs every `SWEEP_INTERVAL_MS` to clean up expired
 * templates automatically.
 */

import { Logger } from '@pgpmjs/logger';

const log = new Logger('multi-tenancy-cache:registry-map');

// =============================================================================
// Eviction Configuration
// =============================================================================

/** Time in milliseconds an idle template (refCount === 0) is kept before eviction. Default: 30 minutes. */
const IDLE_TTL_MS = 30 * 60 * 1000;

/** Maximum number of templates allowed in the map. Oldest idle templates are evicted first. */
let maxTemplates = 50;

/** Interval for the automatic idle-template sweep. Default: 5 minutes. */
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Override the max-templates cap for testing.  Pass `undefined` to restore the
 * production default (50).  This is intentionally **not** re-exported from
 * the package index — only test files should import it directly.
 *
 * @internal — test-only hook
 */
export function _testSetMaxTemplates(n: number | undefined): void {
  maxTemplates = n ?? 50;
}

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
   * Snapshot of the preset parameters used to build this template.
   * Kept for debugging and diagnostics.
   */
  basePresetSnapshot: {
    schemas: string[];
    anonRole: string;
    roleName: string;
  };

  /** Timestamp when this template was first created */
  createdAt: number;

  /** Number of tenants currently sharing this template */
  refCount: number;

  /**
   * Timestamp when refCount last dropped to 0 (idle since).
   * `null` when the template is actively referenced (refCount > 0).
   * Used by the eviction sweep to determine idle duration.
   */
  idleSince: number | null;

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
 * Handle for the periodic sweep timer.
 * Cleared on shutdown to allow clean process exit.
 */
let sweepTimer: ReturnType<typeof setInterval> | null = null;

// =============================================================================
// Sweep / Eviction
// =============================================================================

/**
 * Dispose a single template: close its HTTP server and release the
 * PostGraphile instance.  Safe to call multiple times.
 */
async function disposeTemplate(fingerprint: string, template: RegistryTemplate): Promise<void> {
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
}

/**
 * Remove all tenant→fingerprint entries that point to a given fingerprint.
 * Called when a template is evicted so the reverse-lookup map stays consistent.
 */
function removeTenantEntriesForFingerprint(fingerprint: string): void {
  for (const [key, fp] of tenantFingerprints) {
    if (fp === fingerprint) {
      tenantFingerprints.delete(key);
    }
  }
}

/**
 * Sweep the template map and evict templates that are both idle (refCount === 0)
 * and have exceeded the idle TTL.
 *
 * Also enforces the MAX_TEMPLATES cap by evicting the longest-idle templates
 * first when the map is over capacity.
 *
 * This function is safe to call at any time (including concurrently).
 */
export async function sweepIdleTemplates(): Promise<number> {
  const now = Date.now();
  const toEvict: Array<{ fingerprint: string; template: RegistryTemplate }> = [];

  // Phase 1: Collect TTL-expired idle templates
  for (const [fingerprint, template] of templateMap) {
    if (template.refCount === 0 && template.idleSince !== null) {
      const idleDuration = now - template.idleSince;
      if (idleDuration >= IDLE_TTL_MS) {
        toEvict.push({ fingerprint, template });
      }
    }
  }

  // Phase 2: Enforce max-templates cap — evict oldest idle templates first
  if (templateMap.size - toEvict.length > maxTemplates) {
    const alreadyEvicting = new Set(toEvict.map((e) => e.fingerprint));

    // Gather remaining idle templates sorted by idleSince (oldest first)
    const idleCandidates: Array<{ fingerprint: string; template: RegistryTemplate; idleSince: number }> = [];
    for (const [fingerprint, template] of templateMap) {
      if (!alreadyEvicting.has(fingerprint) && template.refCount === 0 && template.idleSince !== null) {
        idleCandidates.push({ fingerprint, template, idleSince: template.idleSince });
      }
    }
    idleCandidates.sort((a, b) => a.idleSince - b.idleSince);

    const excess = templateMap.size - toEvict.length - maxTemplates;
    for (let i = 0; i < Math.min(excess, idleCandidates.length); i++) {
      toEvict.push(idleCandidates[i]);
    }
  }

  if (toEvict.length === 0) return 0;

  log.info(`Evicting ${toEvict.length} idle template(s) (map size: ${templateMap.size})`);

  // Phase 3: Dispose and remove
  const disposePromises = toEvict.map(async ({ fingerprint, template }) => {
    templateMap.delete(fingerprint);
    removeTenantEntriesForFingerprint(fingerprint);
    await disposeTemplate(fingerprint, template);
  });

  await Promise.allSettled(disposePromises);

  log.info(`Eviction complete. Remaining templates: ${templateMap.size}`);
  return toEvict.length;
}

/**
 * Start the periodic sweep timer.  Called lazily on the first `setTemplate`.
 * Uses `unref()` so the timer does not prevent Node from exiting.
 */
function ensureSweepTimer(): void {
  if (sweepTimer) return;
  sweepTimer = setInterval(() => {
    sweepIdleTemplates().catch((err) => {
      log.error('Sweep timer error:', err);
    });
  }, SWEEP_INTERVAL_MS);
  // unref so the timer doesn't prevent process exit
  if (typeof sweepTimer === 'object' && 'unref' in sweepTimer) {
    sweepTimer.unref();
  }
}

// =============================================================================
// Public API
// =============================================================================

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
 *
 * Also starts the periodic eviction sweep (if not already running) and
 * triggers an immediate sweep if the map exceeds MAX_TEMPLATES.
 */
export function setTemplate(fingerprint: string, template: RegistryTemplate): void {
  templateMap.set(fingerprint, template);
  log.info(
    `Template stored: ${fingerprint.substring(0, 16)}... ` +
    `(schemas: ${template.templateSchemas.join(',')}, total templates: ${templateMap.size})`,
  );

  ensureSweepTimer();

  // Trigger async eviction if we're over the cap
  if (templateMap.size > maxTemplates) {
    sweepIdleTemplates().catch((err) => {
      log.error('Post-setTemplate sweep error:', err);
    });
  }
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
    // Template is now actively referenced — clear idle marker
    template.idleSince = null;
    log.debug(`Tenant ${cacheKey} registered with template ${fingerprint.substring(0, 16)}... (refCount: ${template.refCount})`);
  }
}

/**
 * Deregister a tenant from its template.
 * Called when the tenant's cache entry is evicted.
 *
 * When refCount drops to 0 the template is marked as idle.  It will be
 * evicted by the periodic sweep once it exceeds IDLE_TTL_MS.
 */
export function deregisterTenant(cacheKey: string): void {
  const fingerprint = tenantFingerprints.get(cacheKey);
  if (!fingerprint) return;

  tenantFingerprints.delete(cacheKey);
  const template = templateMap.get(fingerprint);
  if (template) {
    template.refCount = Math.max(0, template.refCount - 1);
    log.debug(`Tenant ${cacheKey} deregistered from template ${fingerprint.substring(0, 16)}... (refCount: ${template.refCount})`);

    // Mark idle when no tenants reference this template
    if (template.refCount === 0 && template.idleSince === null) {
      template.idleSince = Date.now();
      log.debug(`Template ${fingerprint.substring(0, 16)}... marked idle`);
    }
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
    idleSince: number | null;
  }>;
} {
  const templates = [...templateMap.values()].map((t) => ({
    fingerprint: t.fingerprint,
    refCount: t.refCount,
    templateSchemas: t.templateSchemas,
    createdAt: t.createdAt,
    idleSince: t.idleSince,
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
 *
 * Also stops the periodic sweep timer.
 */
export async function clearAllTemplates(): Promise<void> {
  log.info(`Clearing all templates (${templateMap.size} templates, ${tenantFingerprints.size} tenants)`);

  // Stop the sweep timer
  if (sweepTimer) {
    clearInterval(sweepTimer);
    sweepTimer = null;
  }

  const disposePromises: Promise<void>[] = [];

  for (const [fingerprint, template] of templateMap) {
    disposePromises.push(disposeTemplate(fingerprint, template));
  }

  await Promise.allSettled(disposePromises);
  templateMap.clear();
  tenantFingerprints.clear();
  log.info('All templates cleared');
}
