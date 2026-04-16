import crypto from 'node:crypto';
import { Logger } from '@pgpmjs/logger';
import { parse } from 'pgsql-parser';
import { deparse } from 'pgsql-deparser';

const log = new Logger('sql-transform');

/**
 * LRU cache for rewritten SQL. Keyed by (sqlTextHash, schemaMapHash).
 * Bounded to prevent unbounded growth.
 */
const MAX_CACHE_ENTRIES = 10000;
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

interface CacheEntry {
  result: string;
  lastUsedAt: number;
}

const rewriteCache = new Map<string, CacheEntry>();

// Sweep timer for cache TTL
let sweepTimer: ReturnType<typeof setInterval> | null = null;
const SWEEP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

function ensureSweepTimer(): void {
  if (sweepTimer) return;
  sweepTimer = setInterval(() => {
    sweepRewriteCache();
  }, SWEEP_INTERVAL_MS);
  if (sweepTimer.unref) sweepTimer.unref();
}

/**
 * Evict expired and over-cap entries from the rewrite cache.
 */
export function sweepRewriteCache(): void {
  const now = Date.now();
  const expired: string[] = [];

  for (const [key, entry] of rewriteCache) {
    if (now - entry.lastUsedAt > CACHE_TTL_MS) {
      expired.push(key);
    }
  }

  for (const key of expired) {
    rewriteCache.delete(key);
  }

  // LRU cap: if still over limit, evict oldest
  if (rewriteCache.size > MAX_CACHE_ENTRIES) {
    const sorted = [...rewriteCache.entries()].sort(
      (a, b) => a[1].lastUsedAt - b[1].lastUsedAt,
    );
    const toEvict = sorted.slice(0, rewriteCache.size - MAX_CACHE_ENTRIES);
    for (const [key] of toEvict) {
      rewriteCache.delete(key);
    }
  }
}

/**
 * Clear the rewrite cache and stop the sweep timer.
 */
export function clearRewriteCache(): void {
  rewriteCache.clear();
  if (sweepTimer) {
    clearInterval(sweepTimer);
    sweepTimer = null;
  }
}

/**
 * Get rewrite cache stats for diagnostics.
 */
export function getRewriteCacheStats(): { size: number; maxSize: number } {
  return { size: rewriteCache.size, maxSize: MAX_CACHE_ENTRIES };
}

/**
 * Compute a fast hash for a string.
 */
function quickHash(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex');
}

/**
 * Compute a stable hash for a schema map.
 */
function schemaMapHash(schemaMap: Record<string, string>): string {
  const entries = Object.entries(schemaMap).sort(([a], [b]) => a.localeCompare(b));
  return quickHash(entries.map(([k, v]) => `${k}=${v}`).join('|'));
}

/**
 * Recursively rewrite schema names in a pgsql-parser AST node.
 *
 * Only rewrites schema fields on relation namespace / schema-qualified
 * references. Does NOT touch literals, comments, dollar-quoted blocks,
 * aliases, or unqualified identifiers.
 */
function rewriteAstNode(node: any, schemaMap: Record<string, string>): any {
  if (node === null || node === undefined) return node;
  if (typeof node !== 'object') return node;

  if (Array.isArray(node)) {
    return node.map((item) => rewriteAstNode(item, schemaMap));
  }

  const result: Record<string, any> = {};

  for (const [key, value] of Object.entries(node)) {
    // RangeVar.schemaname — FROM / JOIN / INSERT INTO / UPDATE / DELETE
    if (key === 'schemaname' && typeof value === 'string' && value in schemaMap) {
      result[key] = schemaMap[value];
      continue;
    }

    // Schema-qualified function calls: FuncCall.funcname = [{String: {sval: schema}}, {String: {sval: func}}]
    if (key === 'funcname' && Array.isArray(value) && value.length === 2) {
      const first = value[0];
      if (first?.String?.sval && first.String.sval in schemaMap) {
        result[key] = [
          { String: { sval: schemaMap[first.String.sval] } },
          rewriteAstNode(value[1], schemaMap),
        ];
        continue;
      }
    }

    // ColumnRef with schema-qualified path: [{String: {sval: schema}}, {String: {sval: table}}, ...]
    if (key === 'fields' && Array.isArray(value) && value.length >= 2) {
      const first = value[0];
      if (first?.String?.sval && first.String.sval in schemaMap) {
        result[key] = [
          { String: { sval: schemaMap[first.String.sval] } },
          ...value.slice(1).map((v: any) => rewriteAstNode(v, schemaMap)),
        ];
        continue;
      }
    }

    // TypeName with schema-qualified names
    if (key === 'names' && Array.isArray(value) && value.length >= 2) {
      const first = value[0];
      if (first?.String?.sval && first.String.sval in schemaMap) {
        result[key] = [
          { String: { sval: schemaMap[first.String.sval] } },
          ...value.slice(1).map((v: any) => rewriteAstNode(v, schemaMap)),
        ];
        continue;
      }
    }

    result[key] = rewriteAstNode(value, schemaMap);
  }

  return result;
}

/**
 * Build an async SQL text transform function for a given schema map.
 *
 * Uses AST-based rewrite with cache-backed fast path:
 * 1. Computes a cache key from (sqlTextHash, schemaMapHash)
 * 2. On cache hit: returns pre-rewritten SQL immediately (hot path)
 * 3. On cache miss: parse -> rewrite semantic schema nodes -> deparse
 * 4. Stores rewritten SQL in LRU/TTL cache for subsequent hits
 * 5. Empty schema map → identity function (no-op)
 *
 * The function is async because pgsql-parser's parse() and
 * pgsql-deparser's deparse() are WASM-backed async operations.
 * The cache provides a synchronous fast path for repeated queries.
 *
 * @param schemaMap - Mapping from template schema names to tenant schema names
 * @returns Async transform function: (sqlText) => Promise<rewrittenSqlText>
 */
export function buildSchemaRemapTransform(
  schemaMap: Record<string, string>,
): (text: string) => Promise<string> {
  // Empty schema map → identity function (no-op)
  const entries = Object.entries(schemaMap);
  if (entries.length === 0) {
    return async (text: string) => text;
  }

  // Pre-compute the schema map hash for cache key construction
  const mapHash = schemaMapHash(schemaMap);

  ensureSweepTimer();

  return async (text: string): Promise<string> => {
    // Hot path: cache lookup (synchronous)
    const textHash = quickHash(text);
    const cacheKey = `${textHash}:${mapHash}`;

    const cached = rewriteCache.get(cacheKey);
    if (cached) {
      cached.lastUsedAt = Date.now();
      return cached.result;
    }

    // Cold path: AST parse -> rewrite -> deparse (async)
    let rewritten: string;
    try {
      const parseResult = await parse(text);

      // Rewrite schema names in the AST
      const rewrittenParseResult = {
        ...parseResult,
        stmts: rewriteAstNode(parseResult.stmts, schemaMap),
      };

      // Deparse back to SQL
      rewritten = await deparse(rewrittenParseResult);
    } catch (err) {
      // Fail-closed: do not silently pass-through original SQL
      log.error('SQL remap parse/rewrite/deparse failed', {
        sqlHash: textHash,
        schemaMapHash: mapHash,
        error: err instanceof Error ? err.message : String(err),
      });
      throw new SqlRemapError(
        `SQL remap failed: ${err instanceof Error ? err.message : String(err)}`,
        textHash,
        mapHash,
      );
    }

    // Cache the result
    rewriteCache.set(cacheKey, {
      result: rewritten,
      lastUsedAt: Date.now(),
    });

    return rewritten;
  };
}

/**
 * Structured error for SQL remap failures (fail-closed policy).
 */
export class SqlRemapError extends Error {
  public readonly sqlHash: string;
  public readonly schemaMapHash: string;

  constructor(message: string, sqlHash: string, schemaMapHash: string) {
    super(message);
    this.name = 'SqlRemapError';
    this.sqlHash = sqlHash;
    this.schemaMapHash = schemaMapHash;
  }
}
