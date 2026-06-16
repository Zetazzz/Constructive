// Main exports from pg-cache package
export { 
  close,
  getPgCacheConfig,
  pgCache, 
  PgPoolCacheManager, 
  teardownPgPools
} from './lru';
export {
  buildConnectionString,
  getPgPool,
  getPgPoolConfig
} from './pg';

// Re-export types
export type { PgCacheConfig, PoolCleanupCallback } from './lru';