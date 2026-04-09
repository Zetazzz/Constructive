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
}

export interface IntrospectionCacheStats {
  /** Number of cached introspection results */
  size: number;

  /** Cache keys (dbname:schemas) */
  entries: Array<{
    key: string;
    cachedAt: number;
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
 */
const inflight = new Map<string, Promise<CachedIntrospection>>();

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
    log.debug(`Introspection cache HIT: ${key} (fingerprint: ${cached.fingerprint.substring(0, 16)}...)`);
    return cached;
  }

  // Single-flight: if another call is already fetching this key, wait for it
  const existing = inflight.get(key);
  if (existing) {
    log.debug(`Introspection cache coalescing: ${key}`);
    return existing;
  }

  // Cache miss — fetch, fingerprint, and cache
  log.info(`Introspection cache MISS: ${key} — fetching from database`);

  const fetchPromise = (async (): Promise<CachedIntrospection> => {
    const { raw, parsed } = await fetchAndParseIntrospection(pool, schemas);
    const fingerprint = getSchemaFingerprint(parsed, schemas);

    const entry: CachedIntrospection = {
      raw,
      parsed,
      fingerprint,
      cachedAt: Date.now()
    };

    cache.set(key, entry);
    log.info(
      `Introspection cached: ${key} ` +
      `(fingerprint: ${fingerprint.substring(0, 16)}..., ` +
      `raw size: ${raw.length} bytes, cache size: ${cache.size})`
    );

    return entry;
  })();

  inflight.set(key, fetchPromise);

  try {
    return await fetchPromise;
  } finally {
    inflight.delete(key);
  }
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

/**
 * Clear the entire introspection cache.
 * Called during shutdown.
 */
export function clearIntrospectionCache(): void {
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
    fingerprint: entry.fingerprint
  }));

  return {
    size: cache.size,
    entries
  };
}
