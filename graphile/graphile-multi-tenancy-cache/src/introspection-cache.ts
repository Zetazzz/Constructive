/**
 * Introspection Cache
 *
 * In-memory cache for introspection results, keyed by `dbname:schema1,schema2`.
 * Avoids redundant SQL queries against pg_catalog when the same database+schemas
 * combination is requested multiple times (e.g., 3 API endpoints for the same
 * tenant database each trigger introspection — with this cache, only the first
 * one hits the database).
 *
 * The cache also stores the computed fingerprint, since it's deterministically
 * derived from the parsed introspection and would be wasted work to recompute.
 *
 * ## Eviction Policy
 *
 * Entries are evicted when they have not been accessed for longer than
 * `IDLE_TTL_MS` (default: 30 minutes).  Additionally, when the total number
 * of entries exceeds `MAX_ENTRIES`, the least-recently-accessed entries are
 * evicted first (LRU-style).  A periodic sweep runs every `SWEEP_INTERVAL_MS`
 * to clean up expired entries automatically.
 *
 * ## Single-Flight Exception Safety
 *
 * The `inflight` map coalesces concurrent requests for the same cache key.
 * The cleanup (`inflight.delete(key)`) is inside the IIFE's `finally` block,
 * guaranteeing removal regardless of success or failure.  On rejection:
 *
 * 1. The failed entry is NOT cached (only successful results are stored).
 * 2. The `inflight` entry is removed, unblocking future retry attempts.
 * 3. All waiters (original + coalesced) receive the same rejection.
 * 4. The next request for that key will trigger a fresh fetch.
 *
 * Invalidation:
 * - invalidateIntrospection(dbname) — clears all entries for a database
 *   (called on schema change via LISTEN/NOTIFY flush)
 * - invalidateIntrospection(dbname, schemas) — clears a specific entry
 * - clearIntrospectionCache() — clears everything (called on shutdown)
 */

import { Logger } from '@pgpmjs/logger';
import type { Pool } from 'pg';

import type { MinimalIntrospection } from './fingerprint';
import { getSchemaFingerprint } from './fingerprint';
import { fetchAndParseIntrospection } from './introspection';

const log = new Logger('multi-tenancy-cache:introspection-cache');

// =============================================================================
// Eviction Configuration
// =============================================================================

/** Time in milliseconds a cache entry is kept without being accessed. Default: 30 minutes. */
const IDLE_TTL_MS = 30 * 60 * 1000;

/** Maximum number of entries allowed in the cache. Least-recently-accessed entries are evicted first. */
const MAX_ENTRIES = 100;

/** Interval for the automatic idle-entry sweep. Default: 5 minutes. */
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

// =============================================================================
// Types
// =============================================================================

export interface CachedIntrospection {
  /** Raw introspection JSON text (for external caching if needed) */
  raw: string;

  /** Parsed introspection result (for building PostGraphile instances) */
  parsed: MinimalIntrospection;

  /** Structural fingerprint derived from the parsed result */
  fingerprint: string;

  /** Timestamp when this entry was cached */
  cachedAt: number;

  /** Timestamp when this entry was last accessed (for LRU eviction) */
  lastAccessedAt: number;
}

export interface IntrospectionCacheStats {
  /** Number of cached introspection results */
  size: number;

  /** Cache keys (dbname:schemas) */
  entries: Array<{
    key: string;
    cachedAt: number;
    lastAccessedAt: number;
    fingerprint: string;
  }>;
}

// =============================================================================
// Internal State
// =============================================================================

/**
 * In-memory cache: key = "dbname:schema1,schema2" (schemas sorted) -> cached introspection + fingerprint
 */
const cache = new Map<string, CachedIntrospection>();

/**
 * Single-flight guard to prevent concurrent fetches for the same key.
 * Entries are guaranteed to be removed in the IIFE's `finally` block,
 * even if the fetch rejects.
 */
const inflight = new Map<string, Promise<CachedIntrospection>>();

/**
 * Handle for the periodic sweep timer.
 * Cleared on shutdown to allow clean process exit.
 */
let sweepTimer: ReturnType<typeof setInterval> | null = null;

// =============================================================================
// Key Construction
// =============================================================================

/**
 * Build a cache key from database name and schemas.
 * Schemas are sorted to ensure consistent keys regardless of input order.
 */
function makeIntrospectionCacheKey(dbname: string, schemas: string[]): string {
  return `${dbname}:${[...schemas].sort().join(',')}`;
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Get a cached introspection result, or fetch and cache it if not present.
 *
 * This is the main entry point — it replaces direct calls to
 * `fetchAndParseIntrospection()` + `getSchemaFingerprint()`.
 *
 * ## Error handling
 *
 * If the fetch fails (DB timeout, connection error, etc.):
 * - The error is propagated to ALL waiters (original + coalesced).
 * - The `inflight` entry is removed so the **next** request retries.
 * - Nothing is written to the cache (only successful results are cached).
 *
 * @param pool - PostgreSQL connection pool
 * @param schemas - Schema names to introspect
 * @param dbname - Database name (used as part of the cache key)
 * @returns Cached introspection with fingerprint
 */
export async function getOrCreateIntrospection(
  pool: Pool,
  schemas: string[],
  dbname: string
): Promise<CachedIntrospection> {
  const key = makeIntrospectionCacheKey(dbname, schemas);

  // Check cache
  const cached = cache.get(key);
  if (cached) {
    cached.lastAccessedAt = Date.now();
    log.info(`Introspection cache HIT: ${key} (fingerprint: ${cached.fingerprint.substring(0, 16)}...)`);
    return cached;
  }

  // Single-flight: if another call is already fetching this key, wait for it.
  // If that fetch fails, the rejection propagates here and the caller can
  // decide to retry — the inflight entry will already be cleaned up.
  const existing = inflight.get(key);
  if (existing) {
    log.debug(`Introspection cache coalescing: ${key}`);
    return existing;
  }

  // Cache miss — fetch, fingerprint, and cache
  log.info(`Introspection cache MISS: ${key} — fetching from database`);

  // The cleanup of `inflight` is inside the IIFE's `finally` block,
  // guaranteeing removal regardless of whether the promise resolves or rejects.
  // This prevents a failed fetch from permanently blocking future attempts.
  const fetchPromise = (async (): Promise<CachedIntrospection> => {
    try {
      const { raw, parsed } = await fetchAndParseIntrospection(pool, schemas);
      const fingerprint = getSchemaFingerprint(parsed, schemas);

      const now = Date.now();
      const entry: CachedIntrospection = {
        raw,
        parsed,
        fingerprint,
        cachedAt: now,
        lastAccessedAt: now
      };

      // Only cache successful results — never cache failures
      cache.set(key, entry);
      ensureSweepTimer();

      // Trigger async eviction if we're over the cap
      if (cache.size > MAX_ENTRIES) {
        sweepIntrospectionCache().catch((err) => {
          log.error('Post-cache-set sweep error:', err);
        });
      }

      log.info(
        `Introspection cached: ${key} ` +
        `(fingerprint: ${fingerprint.substring(0, 16)}..., ` +
        `raw size: ${raw.length} bytes, cache size: ${cache.size})`
      );

      return entry;
    } catch (err) {
      // Log and re-throw — do NOT cache the failure.
      // The inflight entry is cleaned up in `finally`, so the next
      // request for this key will trigger a fresh fetch attempt.
      log.error(`Introspection fetch failed for ${key}:`, err);
      throw err;
    } finally {
      // GUARANTEE: inflight entry is always removed, even on rejection.
      // This is the critical safety measure — without it, a single DB
      // timeout could permanently block all future introspection attempts
      // for this database+schemas combination.
      inflight.delete(key);
    }
  })();

  inflight.set(key, fetchPromise);

  return fetchPromise;
}

/**
 * Invalidate cached introspection entries.
 *
 * When called with only `dbname`, all entries for that database are cleared
 * (useful when you know a database's schema changed but don't know which schemas).
 *
 * When called with `dbname` + `schemas`, only that specific entry is cleared.
 *
 * @param dbname - Database name
 * @param schemas - Optional specific schemas to invalidate
 */
export function invalidateIntrospection(dbname: string, schemas?: string[]): void {
  if (schemas) {
    // Invalidate a specific entry
    const key = makeIntrospectionCacheKey(dbname, schemas);
    const had = cache.delete(key);
    if (had) {
      log.info(`Introspection invalidated: ${key}`);
    }
  } else {
    // Invalidate all entries for this database
    const prefix = dbname + ':';
    let count = 0;
    for (const key of [...cache.keys()]) {
      if (key.startsWith(prefix)) {
        cache.delete(key);
        count++;
      }
    }
    if (count > 0) {
      log.info(`Introspection invalidated: ${count} entries for database "${dbname}"`);
    }
  }
}

// =============================================================================
// Sweep / Eviction
// =============================================================================

/**
 * Sweep the introspection cache and evict entries that have not been accessed
 * within the idle TTL.
 *
 * Also enforces the MAX_ENTRIES cap by evicting the least-recently-accessed
 * entries first when the cache is over capacity.
 *
 * This function is safe to call at any time (including concurrently).
 */
export async function sweepIntrospectionCache(): Promise<number> {
  const now = Date.now();
  const toEvict: string[] = [];

  // Phase 1: Collect TTL-expired entries
  for (const [key, entry] of cache) {
    const idleDuration = now - entry.lastAccessedAt;
    if (idleDuration >= IDLE_TTL_MS) {
      toEvict.push(key);
    }
  }

  // Phase 2: Enforce MAX_ENTRIES cap — evict least-recently-accessed first
  if (cache.size - toEvict.length > MAX_ENTRIES) {
    const alreadyEvicting = new Set(toEvict);

    // Gather remaining entries sorted by lastAccessedAt (oldest first = LRU)
    const candidates: Array<{ key: string; lastAccessedAt: number }> = [];
    for (const [key, entry] of cache) {
      if (!alreadyEvicting.has(key)) {
        candidates.push({ key, lastAccessedAt: entry.lastAccessedAt });
      }
    }
    candidates.sort((a, b) => a.lastAccessedAt - b.lastAccessedAt);

    const excess = cache.size - toEvict.length - MAX_ENTRIES;
    for (let i = 0; i < Math.min(excess, candidates.length); i++) {
      toEvict.push(candidates[i].key);
    }
  }

  if (toEvict.length === 0) return 0;

  log.info(`Evicting ${toEvict.length} introspection cache entries (cache size: ${cache.size})`);

  for (const key of toEvict) {
    cache.delete(key);
  }

  log.info(`Eviction complete. Remaining entries: ${cache.size}`);
  return toEvict.length;
}

/**
 * Start the periodic sweep timer. Called lazily on the first cache insertion.
 * Uses `unref()` so the timer does not prevent Node from exiting.
 */
function ensureSweepTimer(): void {
  if (sweepTimer) return;
  sweepTimer = setInterval(() => {
    sweepIntrospectionCache().catch((err) => {
      log.error('Sweep timer error:', err);
    });
  }, SWEEP_INTERVAL_MS);
  // unref so the timer doesn't prevent process exit
  if (typeof sweepTimer === 'object' && 'unref' in sweepTimer) {
    sweepTimer.unref();
  }
}

/**
 * Clear the entire introspection cache.
 * Called during shutdown.
 *
 * Also stops the periodic sweep timer.
 */
export function clearIntrospectionCache(): void {
  // Stop the sweep timer
  if (sweepTimer) {
    clearInterval(sweepTimer);
    sweepTimer = null;
  }

  const size = cache.size;
  cache.clear();
  inflight.clear();
  if (size > 0) {
    log.info(`Introspection cache cleared (${size} entries)`);
  }
}

/**
 * Get statistics about the introspection cache.
 */
export function getIntrospectionCacheStats(): IntrospectionCacheStats {
  const entries = [...cache.entries()].map(([key, entry]) => ({
    key,
    cachedAt: entry.cachedAt,
    lastAccessedAt: entry.lastAccessedAt,
    fingerprint: entry.fingerprint
  }));

  return {
    size: cache.size,
    entries
  };
}
