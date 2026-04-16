import { Logger } from '@pgpmjs/logger';
import type { Express } from 'express';
import type { Server as HttpServer } from 'http';
import type { PostGraphileInstance } from 'postgraphile';
import type { GrafservBase } from 'grafserv';

const log = new Logger('registry-template-map');

// --- Configuration ---
const MAX_TEMPLATES = 50;
const TTL_MS = 30 * 60 * 1000; // 30 minutes idle
const SWEEP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

// Test-only hook
let maxTemplates = MAX_TEMPLATES;

// --- Types ---

export interface RegistryTemplate {
  fingerprint: string;
  pgl: PostGraphileInstance;
  serv: GrafservBase;
  handler: Express;
  httpServer: HttpServer;
  /** Number of active tenants using this template */
  refCount: number;
  /** Tenant cache keys registered to this template */
  tenantKeys: Set<string>;
  createdAt: number;
  /** When refCount dropped to 0 (undefined if refCount > 0) */
  idleSince?: number;
}

export interface TemplateStats {
  size: number;
  maxSize: number;
  activeCount: number;
  idleCount: number;
}

// --- Internal state ---

const templateMap = new Map<string, RegistryTemplate>();
let sweepTimer: ReturnType<typeof setInterval> | null = null;

function ensureSweepTimer(): void {
  if (sweepTimer) return;
  sweepTimer = setInterval(() => {
    sweepIdleTemplates();
  }, SWEEP_INTERVAL_MS);
  if (sweepTimer.unref) sweepTimer.unref();
}

/**
 * Dispose a template — release PostGraphile instance and close HTTP server.
 */
async function disposeTemplate(template: RegistryTemplate): Promise<void> {
  log.debug(`Disposing template fingerprint=${template.fingerprint.slice(0, 12)}…`);
  try {
    if (template.httpServer?.listening) {
      await new Promise<void>((resolve) => {
        template.httpServer.close(() => resolve());
      });
    }
    if (template.pgl) {
      await template.pgl.release();
    }
  } catch (err) {
    log.error(`Error disposing template ${template.fingerprint.slice(0, 12)}:`, err);
  }
}

// --- Public API ---

/**
 * Get a template by fingerprint.
 */
export function getTemplate(fingerprint: string): RegistryTemplate | undefined {
  return templateMap.get(fingerprint);
}

/**
 * Store a new template in the registry.
 */
export function setTemplate(fingerprint: string, template: RegistryTemplate): void {
  templateMap.set(fingerprint, template);
  ensureSweepTimer();
  log.debug(`Registered template fingerprint=${fingerprint.slice(0, 12)}… size=${templateMap.size}`);
}

/**
 * Register a tenant as using a template — increments refCount.
 */
export function registerTenant(cacheKey: string, fingerprint: string): void {
  const template = templateMap.get(fingerprint);
  if (!template) {
    log.warn(`registerTenant: template ${fingerprint.slice(0, 12)}… not found`);
    return;
  }

  template.tenantKeys.add(cacheKey);
  template.refCount = template.tenantKeys.size;
  template.idleSince = undefined;

  log.debug(
    `Registered tenant key=${cacheKey} on template ${fingerprint.slice(0, 12)}… refCount=${template.refCount}`,
  );
}

/**
 * Deregister a tenant — decrements refCount, marks idle if 0.
 */
export function deregisterTenant(cacheKey: string): void {
  for (const [fingerprint, template] of templateMap) {
    if (template.tenantKeys.has(cacheKey)) {
      template.tenantKeys.delete(cacheKey);
      template.refCount = template.tenantKeys.size;

      if (template.refCount === 0) {
        template.idleSince = Date.now();
      }

      log.debug(
        `Deregistered tenant key=${cacheKey} from template ${fingerprint.slice(0, 12)}… refCount=${template.refCount}`,
      );
      return;
    }
  }
}

/**
 * Evict expired + over-cap templates.
 * Active templates (refCount > 0) are never evicted.
 */
export function sweepIdleTemplates(): void {
  const now = Date.now();
  const toEvict: string[] = [];

  // TTL eviction: idle templates older than TTL
  for (const [fingerprint, template] of templateMap) {
    if (
      template.refCount === 0 &&
      template.idleSince &&
      now - template.idleSince > TTL_MS
    ) {
      toEvict.push(fingerprint);
    }
  }

  // LRU cap eviction: oldest idle templates first
  if (templateMap.size - toEvict.length > maxTemplates) {
    const idle = [...templateMap.entries()]
      .filter(
        ([fp, t]) => t.refCount === 0 && !toEvict.includes(fp),
      )
      .sort((a, b) => (a[1].idleSince || 0) - (b[1].idleSince || 0));

    const excess = templateMap.size - toEvict.length - maxTemplates;
    for (let i = 0; i < Math.min(excess, idle.length); i++) {
      toEvict.push(idle[i][0]);
    }
  }

  for (const fingerprint of toEvict) {
    const template = templateMap.get(fingerprint);
    if (template) {
      templateMap.delete(fingerprint);
      disposeTemplate(template).catch((err) => {
        log.error(`Failed to dispose evicted template ${fingerprint.slice(0, 12)}:`, err);
      });
    }
  }

  if (toEvict.length > 0) {
    log.debug(`Template sweep: evicted=${toEvict.length} remaining=${templateMap.size}`);
  }
}

/**
 * Shutdown cleanup — release all templates.
 */
export async function clearAllTemplates(): Promise<void> {
  if (sweepTimer) {
    clearInterval(sweepTimer);
    sweepTimer = null;
  }

  const entries = [...templateMap.values()];
  templateMap.clear();

  for (const template of entries) {
    await disposeTemplate(template);
  }

  log.debug('All templates cleared');
}

/**
 * Get diagnostic stats.
 */
export function getTemplateStats(): TemplateStats {
  let activeCount = 0;
  let idleCount = 0;

  for (const template of templateMap.values()) {
    if (template.refCount > 0) {
      activeCount++;
    } else {
      idleCount++;
    }
  }

  return {
    size: templateMap.size,
    maxSize: maxTemplates,
    activeCount,
    idleCount,
  };
}

/**
 * Test-only hook to set max templates.
 */
export function _testSetMaxTemplates(n: number): void {
  maxTemplates = n;
}
