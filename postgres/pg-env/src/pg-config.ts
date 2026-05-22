export interface PgConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

/**
 * Optional pool sizing configuration.
 *
 * Passed through to node-postgres `pg.Pool` options.
 * When omitted, pg-cache falls back to its own env-var defaults.
 */
export interface PgPoolConfig {
  /** Maximum number of clients in the pool (env: PG_POOL_MAX, default: 5) */
  max?: number;
  /** Close idle clients after this many ms (env: PG_POOL_IDLE_TIMEOUT_MS, default: 30000) */
  idleTimeoutMillis?: number;
  /** Reject pool.connect() after this many ms (env: PG_POOL_CONNECTION_TIMEOUT_MS, default: 5000) */
  connectionTimeoutMillis?: number;
  /** Allow the Node process to exit while idle clients remain (default: false) */
  allowExitOnIdle?: boolean;
}

export const defaultPgConfig: PgConfig = {
  host: 'localhost',
  port: 5432,
  user: 'postgres',
  password: 'password',
  database: 'postgres'
};