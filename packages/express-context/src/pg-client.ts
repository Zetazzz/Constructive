/**
 * pg-client — Tenant-scoped database transaction helper
 *
 * Provides a `withPgClient` function that:
 *   1. Acquires a client from the tenant database pool
 *   2. Begins a transaction
 *   3. Sets pgSettings via SET LOCAL (role, JWT claims, request_id)
 *   4. Calls the user callback
 *   5. Commits (or rolls back on error)
 *   6. Releases the client
 *
 * This is the same pattern used by Graphile's withPgClient, extracted
 * so any Express-based service can use it without PostGraphile.
 */

import type { Pool, PoolClient } from 'pg';

/**
 * Execute a function within a tenant-scoped RLS transaction.
 *
 * pgSettings are applied via `SELECT set_config($1, $2, true)` which
 * scopes them to the current transaction (the `true` = is_local flag).
 */
export async function withPgClient<T>(
  pool: Pool,
  pgSettings: Record<string, string>,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const [key, value] of Object.entries(pgSettings)) {
      await client.query('SELECT set_config($1, $2, true)', [key, value]);
    }
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
