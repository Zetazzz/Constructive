# graphile-multi-tenancy-cache

Template-based multi-tenancy plugin for PostGraphile v5. Allows hundreds of database schemas with identical structures to share the same `PgRegistry` and `GraphQLSchema` objects in memory, drastically reducing RAM usage and startup time.

## How It Works

1. **Fingerprinting**: Each tenant's schema structure is hashed (SHA-256), ignoring the namespace name. `tenant_a.users` and `tenant_b.users` produce the same fingerprint.

2. **Template Sharing**: A global `Map<Fingerprint, RegistryTemplate>` stores built PostGraphile instances. When a new tenant matches an existing fingerprint, the cached instance is reused.

3. **Dynamic Schema Resolution**: Shared templates inject the tenant's physical schema name at runtime via `pgSettings`, so SQL queries target the correct tenant schema.

## Key Modules

| Module | Purpose |
|--------|---------|
| `fingerprint.ts` | SHA-256 structural hashing (ignores schema names) |
| `registry-template-map.ts` | Global template cache with ref-counting |
| `multi-tenancy-cache.ts` | Orchestrator: introspect → fingerprint → reuse or build |
| `dynamic-schema.ts` | Runtime schema name injection via pgSettings |
| `introspection.ts` | Fetch and parse database introspection data |

## Usage

```typescript
import { getOrCreateTenantInstance } from 'graphile-multi-tenancy-cache';

const instance = await getOrCreateTenantInstance(
  {
    cacheKey: 'tenant-abc',
    pool: pgPool,
    schemas: ['tenant_abc_public'],
    dbname: 'mydb',
    anonRole: 'anonymous',
    roleName: 'authenticated',
  },
  buildPreset, // your preset builder function
);

// instance.handler is an Express app
// instance.isShared tells you if the template was reused
```

## Demo

```bash
cd graphile/graphile-multi-tenancy-cache
PGDATABASE=constructive pnpm demo
```

## Benchmark

```bash
cd graphile/graphile-multi-tenancy-cache
PGDATABASE=constructive BENCHMARK_TENANTS=10 ts-node src/benchmark.ts
```
