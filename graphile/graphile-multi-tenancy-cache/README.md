# graphile-multi-tenancy-cache

Template-based multi-tenancy plugin for PostGraphile v5. Allows hundreds of database schemas with identical structures to share the same `PgRegistry` and `GraphQLSchema` objects in memory, drastically reducing RAM usage and startup time.

## How It Works

1. **Fingerprinting**: Each tenant's schema structure is hashed (SHA-256), ignoring the namespace name. `tenant_a.users` and `tenant_b.users` produce the same fingerprint.

2. **Template Sharing**: A global `Map<Fingerprint, RegistryTemplate>` stores built PostGraphile instances. When a new tenant matches an existing fingerprint, the cached instance is reused.

3. **Dynamic SQL Identifiers** (Crystal-Level): The preset uses `pgIdentifiers: "dynamic"` which wraps schema names in `__pgmt_<schemaName>__` placeholders during the build phase. At execution time, `PgExecutorContext.sqlTextTransform` replaces these placeholders with the real tenant schema names.

This approach correctly handles **multi-schema tenants** where different schemas contain tables with the same name (e.g., `t_1_app.users` and `t_1_perf.users`), because the fully qualified identifiers are preserved and remapped independently per-request.

## Crystal Dependencies

This package requires the following crystal-level changes (see [crystal PR](https://github.com/Zetazzz/crystal/pull/5)):

- **`PgExecutorContext.sqlTextTransform`** — Optional callback on `@dataplan/pg`'s executor context that transforms SQL text before execution.
- **`pgIdentifiers: "dynamic"`** — New mode in `PgBasicsPlugin` that wraps schema names in `__pgmt__` placeholders.
- **`buildSchemaRemapTransform()`** — Utility in `graphile-build-pg` for creating the transform function.

## Key Modules

| Module | Purpose |
|--------|---------|
| `fingerprint.ts` | SHA-256 structural hashing (ignores schema names) |
| `registry-template-map.ts` | Global template cache with ref-counting |
| `multi-tenancy-cache.ts` | Orchestrator: introspect → fingerprint → reuse or build |
| `dynamic-schema.ts` | SQL text transformation utilities for schema remapping |
| `introspection.ts` | Fetch and parse database introspection data |

## Usage

```typescript
import { getOrCreateTenantInstance } from 'graphile-multi-tenancy-cache';

const instance = await getOrCreateTenantInstance(
  {
    cacheKey: 'tenant-abc',
    pool: pgPool,
    schemas: ['t_abc_app', 't_abc_perf'],
    dbname: 'mydb',
    anonRole: 'anonymous',
    roleName: 'authenticated',
  },
  buildPreset, // must include gather: { pgIdentifiers: 'dynamic' }
);

// instance.handler — Express app (shared with other tenants of same structure)
// instance.isShared — true if the template was reused
// instance.sqlTextTransform — function to inject into PgExecutorContext
// instance.pgSettings — pgSettings to inject per-request
```

### Preset Builder

Your preset builder **must** include `pgIdentifiers: "dynamic"`:

```typescript
function buildPreset(pool, schemas, anonRole, roleName) {
  return {
    extends: [PostGraphileAmberPreset],
    pgServices: [makePgService({ pool, schemas })],
    gather: {
      pgIdentifiers: 'dynamic', // REQUIRED for multi-tenancy
    },
  };
}
```

## Demo

```bash
cd graphile/graphile-multi-tenancy-cache
PGDATABASE=constructive pnpm demo
```

The demo creates two multi-schema tenants (`t_1_app`/`t_1_perf` and `t_2_app`/`t_2_perf`) with overlapping table names, then verifies that the SQL text transformation correctly rewrites `"__pgmt_t_1_app__"` → `"t_2_app"` for tenant 2.

## Benchmark

```bash
cd graphile/graphile-multi-tenancy-cache
PGDATABASE=constructive BENCHMARK_TENANTS=10 ts-node src/benchmark.ts
```
