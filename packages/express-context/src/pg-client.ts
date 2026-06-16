/**
 * pg-client — Re-exports withPgClient from pg-query-context
 *
 * This module exists for backwards compatibility. The implementation
 * lives in pg-query-context which provides both the single-query API
 * and the callback-based withPgClient API.
 */

export { withPgClient } from 'pg-query-context';
