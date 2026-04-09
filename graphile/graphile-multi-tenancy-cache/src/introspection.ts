/**
 * Introspection Utilities
 *
 * Provides helpers for:
 * 1. Fetching raw introspection JSON from a database
 * 2. Extracting introspection results for external caching (Redis, file, etc.)
 * 3. Initializing PostGraphile with pre-fetched introspection data
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
    // Set the search_path to target schemas for introspection.
    // Use escapeSqlIdentifier from pg-sql2 to safely quote schema names
    // (handles special characters like double quotes in schema names).
    const safePath = schemas.map((s) => escapeSqlIdentifier(s)).join(', ');
    await client.query(`SET search_path TO ${safePath}, public`);

    const result = await client.query<{ introspection: string }>(introspectionQuery);
    const row = result.rows[0];
    if (!row) {
      throw new Error('Introspection query returned no rows');
    }
    // The introspection query returns a single row with an 'introspection' column
    // containing the full JSON string that parseIntrospectionResults expects.
    const introspectionText = row.introspection;

    log.debug(`Introspection fetched: ${introspectionText.length} bytes`);
    return introspectionText;
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
