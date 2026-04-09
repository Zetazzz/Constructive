/**
 * Introspection Utilities
 *
 * Provides helpers for:
 * 1. Fetching raw introspection JSON from a database
 * 2. Extracting introspection results for external caching (Redis, file, etc.)
 * 3. Initializing PostGraphile with pre-fetched introspection data
 *
 * ## Connection Pool Safety
 *
 * `fetchIntrospection()` uses `SET LOCAL` inside a transaction so that the
 * `search_path` change is confined to the transaction and never leaks to other
 * borrowers of the same pooled connection.  This prevents "Tenant B sees
 * Tenant A's schema" contamination.
 *
 * The PostGraphile/Grafast execution path is safe by a different mechanism:
 * `pgSettings` (including `search_path`) are applied via `SET LOCAL` inside
 * the per-request transaction managed by `PgExecutor`.  The connection is
 * returned to the pool after `COMMIT`/`ROLLBACK`, so session state is
 * automatically scoped.
 */

import { Logger } from '@pgpmjs/logger';
import type { Pool } from 'pg';
import { makeIntrospectionQuery, parseIntrospectionResults } from 'pg-introspection';
import { escapeSqlIdentifier } from 'pg-sql2';
import type { MinimalIntrospection } from './fingerprint';

const log = new Logger('multi-tenancy-cache:introspection');

/**
 * Fetch raw introspection JSON from a PostgreSQL database.
 *
 * This runs the pg-introspection query against the specified schemas
 * and returns the raw text result that can be:
 * 1. Cached externally (Redis, file, etc.)
 * 2. Parsed later with parseIntrospectionResults()
 * 3. Used for fingerprinting
 *
 * **Connection safety:** The `search_path` is set with `SET LOCAL` inside
 * a transaction, so it never contaminates the underlying pooled connection.
 * When the transaction commits, PostgreSQL automatically reverts to the
 * connection's default `search_path`.
 *
 * @param pool - PostgreSQL connection pool
 * @param schemas - Schema names to introspect
 * @returns Raw introspection text (JSON string)
 */
export async function fetchIntrospection(
  pool: Pool,
  schemas: string[],
): Promise<string> {
  const introspectionQuery = makeIntrospectionQuery();

  log.debug(`Fetching introspection for schemas: ${schemas.join(', ')}`);

  const client = await pool.connect();
  try {
    // Wrap in a transaction so SET LOCAL scopes the search_path to this
    // transaction only.  Without the transaction, a plain SET would persist
    // on the physical connection and leak to the next borrower — causing
    // cross-tenant contamination.
    await client.query('BEGIN');

    // Use SET LOCAL (not SET) to confine the search_path to this transaction.
    // escapeSqlIdentifier from pg-sql2 safely quotes schema names that
    // contain special characters (e.g., double quotes).
    const safePath = schemas.map((s) => escapeSqlIdentifier(s)).join(', ');
    await client.query(`SET LOCAL search_path TO ${safePath}, public`);

    const result = await client.query<{ introspection: string }>(introspectionQuery);

    await client.query('COMMIT');

    const row = result.rows[0];
    if (!row) {
      throw new Error('Introspection query returned no rows');
    }
    // The introspection query returns a single row with an 'introspection' column
    // containing the full JSON string that parseIntrospectionResults expects.
    const introspectionText = row.introspection;

    log.debug(`Introspection fetched: ${introspectionText.length} bytes`);
    return introspectionText;
  } catch (err) {
    // Rollback on any error so the connection is returned clean
    try {
      await client.query('ROLLBACK');
    } catch (_rollbackErr) {
      // Ignore rollback errors — the connection may already be broken
    }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Parse raw introspection text into a structured Introspection object.
 */
export function parseIntrospection(introspectionText: string): MinimalIntrospection {
  const parsed = parseIntrospectionResults(introspectionText);
  return parsed as unknown as MinimalIntrospection;
}

/**
 * Fetch and parse introspection in one step.
 * Returns both the raw text (for caching) and the parsed result (for fingerprinting).
 */
export async function fetchAndParseIntrospection(
  pool: Pool,
  schemas: string[],
): Promise<{
  raw: string;
  parsed: MinimalIntrospection;
}> {
  const raw = await fetchIntrospection(pool, schemas);
  const parsed = parseIntrospection(raw);
  return { raw, parsed };
}
