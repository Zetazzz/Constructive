# graphile-multi-tenancy-cache

Template-based multi-tenancy cache for PostGraphile v5. Allows hundreds of database schemas with identical structures to share the same `PgRegistry` and `GraphQLSchema` objects in memory, reducing RAM usage from O(N) to O(K) where K is the number of unique schema structures.

## How It Works

1. **Fingerprinting**: Each tenant's schema structure is hashed (SHA-256), ignoring the namespace name. `tenant_a.users` and `tenant_b.users` produce the same fingerprint.

2. **Template Sharing**: A global `Map<Fingerprint, RegistryTemplate>` stores built PostGraphile instances. When a new tenant matches an existing fingerprint, the cached instance is reused — zero additional memory, zero build time.

3. **Dynamic SQL Identifiers**: Uses `pgIdentifiers: "dynamic"` (from [crystal](https://github.com/Zetazzz/crystal/pull/5)) to wrap schema names in `__pgmt_<schemaName>__` placeholders during the build phase. At execution time, `PgExecutorContext.sqlTextTransform` replaces these placeholders with the real tenant schema names per-request.

4. **Single-Flight Pattern**: Concurrent requests for the same fingerprint are coalesced — only one PostGraphile build occurs, and all waiting requests share the result.

This approach correctly handles **multi-schema tenants** where different schemas contain tables with the same name (e.g., `t_1_app.users` and `t_1_perf.users`), because the fully qualified identifiers are preserved and remapped independently.

## Server Integration

The cache integrates into `graphql/server` via a dual-mode toggle:

```bash
# Enable multi-tenancy cache (default: uses legacy graphile-cache)
USE_MULTI_TENANCY_CACHE=true
```

When enabled, the server middleware:
- Introspects and fingerprints each tenant's schema on first request
- Shares PostGraphile instances across structurally identical tenants
- Injects `sqlTextTransform` per-request for schema remapping
- Falls back to a dedicated instance if fingerprinting fails

## API

```typescript
import {
  getOrCreateTenantInstance,
  getMultiTenancyCacheStats,
  shutdownMultiTenancyCache,
} from 'graphile-multi-tenancy-cache';

const instance = await getOrCreateTenantInstance(
  {
    cacheKey: 'tenant-abc',
    pool: pgPool,
    schemas: ['t_abc_app', 't_abc_perf'],
    dbname: 'mydb',
    anonRole: 'anonymous',
    roleName: 'authenticated',
  },
  buildPreset,
);

// instance.handler       — Express app (shared across identical tenants)
// instance.isShared      — true if the template was reused
// instance.sqlTextTransform — inject into PgExecutorContext per-request
// instance.pgSettings    — pgSettings with search_path for this tenant
```

## Key Modules

| Module | Purpose |
|--------|---------|
| `fingerprint.ts` | SHA-256 structural hashing (ignores schema names) |
| `registry-template-map.ts` | Global template cache with ref-counting |
| `multi-tenancy-cache.ts` | Orchestrator: introspect → fingerprint → reuse or build |
| `dynamic-schema.ts` | SQL text transformation utilities for schema remapping |
| `introspection.ts` | Fetch and parse database introspection data |

## Performance

Tested end-to-end through `graphql/server` middleware with `apiIsPublic=false`, k=20 tenant databases:

| Metric | Legacy (graphile-cache) | Multi-Tenancy Cache | Improvement |
|--------|------------------------|---------------------|-------------|
| Warmup heap growth | +759.5 MB | -0.5 MB | 99.9% less |
| Graphile builds | 589 (LRU churn) | 0 (1 shared template) | 589 → 0 |
| RPS | 18.6 | 1,984.3 | 107x faster |
| p99 latency | 2,393 ms | 19 ms | 126x faster |
| Final heap | 673 MB | 76 MB | 89% less |
