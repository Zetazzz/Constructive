# graphile-multi-tenancy-cache — Implementation Spec

## Problem

Constructive's GraphQL server creates a **dedicated PostGraphile instance per tenant** (one `postgraphile()` call per unique `svc_key`). Each instance holds its own `PgRegistry`, `GraphQLSchema`, operation plan cache, and V8 closures — ~50–80 MB per tenant. At scale (hundreds of tenants), this leads to:

- **Unbounded memory growth** — RSS grows linearly with tenant count
- **Slow cold starts** — each new tenant triggers a full schema build (~200–400ms)
- **LRU churn** — when tenant count exceeds `GRAPHILE_CACHE_MAX`, constant eviction/rebuild cycles tank QPS and spike latency

## Solution

A **template-based multi-tenancy cache** that shares a single PostGraphile instance across all tenants with structurally identical schemas. SQL is remapped per-request at the `client.query()` level — no Crystal modifications required.

### Key invariant

Constructive tenant schemas use the naming convention `t_<id>_<purpose>` (e.g., `t_1_services_public`, `t_2_services_public`). These names **never collide** with table/column names (`apis`, `apps`, `domains`), making direct SQL identifier replacement safe without Crystal's placeholder system.

---

## Architecture

### Request flow

```
Request (svc_key)
  │
  ├─ HIT ──► tenantInstances.get(svc_key) ──► inject sqlTextTransform ──► handler
  │
  └─ MISS ──► getOrCreateTenantInstance()
                │
                ├─ Introspect + fingerprint (cached)
                │
                ├─ Template exists for fingerprint?
                │     ├─ YES ──► reuse template, build schema remap transform
                │     └─ NO  ──► build new template (single-flight), register
                │
                └─ Return TenantInstance { handler, sqlTextTransform, pgSettings }
```

### SQL interception (wrapper approach)

```
PgContextPlugin (Crystal, runs first in prepareArgs)
  contextValue["withPgClient"] = withPgClientFromPgService(…)
                    │
PgMultiTenancyWrapperPlugin (this package, runs AFTER)
  contextValue["withPgClient"] = wrap(original, contextValue)
                    │
PgExecutor reads ctx.get("withPgClient") at execution time
  → gets wrapped version
  → client.query({ text }) passes through Proxy
  → SQL text transformed: "t_1_services_public" → "t_2_services_public"
  → PostgreSQL receives tenant-correct SQL
```

The transform is read **lazily** at call time (not at middleware time) because `grafast.context` finalization happens after middleware.

### Three cache layers

| Layer | Key | Value | Eviction |
|---|---|---|---|
| **Tenant Instance** | `svc_key` | `TenantInstance` (handler + transform) | Flush via LISTEN/NOTIFY |
| **Introspection** | `dbname:schema1,schema2` | Parsed introspection + fingerprint | LRU (max 100) + TTL (30min idle) |
| **Template** | SHA-256 fingerprint | PostGraphile instance (pgl + handler + httpServer) | LRU (max 50) + TTL (30min idle) + refCount protection |

---

## Folder structure

### New package: `graphile/graphile-multi-tenancy-cache/`

```
graphile/graphile-multi-tenancy-cache/
├── SPEC.md                          ← this file
├── package.json
├── jest.config.js
├── tsconfig.json
├── tsconfig.esm.json
└── src/
    ├── index.ts                     ← public API exports
    │
    │   # Core modules
    ├── pg-client-wrapper-plugin.ts  ← Grafast middleware (SQL interception via Proxy)
    ├── multi-tenancy-cache.ts       ← orchestrator (getOrCreateTenantInstance, shutdown)
    ├── registry-template-map.ts     ← template registry (LRU/TTL eviction, refCount)
    ├── introspection-cache.ts       ← introspection cache (LRU/TTL eviction)
    ├── fingerprint.ts               ← SHA-256 structural fingerprint (schema-name-agnostic)
    │
    │   # Utilities
    ├── utils/
    │   ├── sql-transform.ts         ← buildSchemaRemapTransform (single-pass regex replacement)
    │   ├── schema-map.ts            ← buildSchemaMap, buildTenantPgSettings, remapSchemas
    │   └── introspection-query.ts   ← fetchIntrospection, parseIntrospection (raw pg_catalog access)
    │
    │   # Tests
    └── __tests__/
        ├── pg-client-wrapper-plugin.test.ts
        ├── registry-template-map.test.ts
        ├── introspection-cache.test.ts
        ├── fingerprint.test.ts
        ├── sql-transform.test.ts
        ├── schema-map.test.ts
        └── single-flight.test.ts
```

### Modified files in existing packages

```
graphql/server/src/middleware/
├── graphile.ts                      ← add multiTenancyHandler + buildMultiTenancyPreset
├── types.ts                         ← add sqlTextTransform to Express.Request
└── flush.ts                         ← add multi-tenancy cache invalidation

graphql/server/src/
├── server.ts                        ← wire shutdownMultiTenancyCache, createFlushMiddleware
└── index.ts                         ← export createFlushMiddleware

graphql/env/src/
└── env.ts                           ← add USE_MULTI_TENANCY_CACHE env var

graphql/types/src/
└── graphile.ts                      ← add useMultiTenancyCache to ApiOptions
```

### Benchmark scripts: `graphql/server/perf/`

E2E benchmark scripts live at the server level (not in the package) since they
start the actual GraphQL server, manage databases, and do HTTP load testing.

```
graphql/server/perf/
├── README.md                        ← usage docs
├── common.mjs                       ← shared utilities (fetch, timing, pool helpers)
├── run-k-sweep.mjs                  ← orchestrator: run both modes, compare results
├── run-test-spec.mjs                ← single-mode runner (dedicated or multi-tenant)
├── phase1-preflight.mjs             ← pre-flight checks (DB connectivity, server health)
├── phase1-tech-validate-dbpm.mjs    ← validate DBPM tenant databases exist
├── phase2-load.mjs                  ← HTTP load generator (configurable workers, duration)
├── seed-real-multitenant.mjs        ← seed k tenant databases for benchmarking
├── build-token-pool.mjs             ← generate auth tokens for load testing
├── build-keyspace-profiles.mjs      ← build tenant keyspace profiles
├── build-business-op-profiles.mjs   ← build business operation profiles
├── prepare-public-test-access.mjs   ← prepare public API test access
├── public-test-access-lib.mjs       ← shared lib for public test access
├── reset-business-test-data.mjs     ← reset test data between runs
├── run-comparison.sh                ← shell wrapper: run both modes + compare
└── results/                         ← raw JSON benchmark results (gitignored)
```

---

## Module specifications

### 1. `pg-client-wrapper-plugin.ts`

**Purpose:** Grafast middleware plugin that intercepts `client.query()` to transform SQL per-request.

**Exports:**
- `PgMultiTenancyWrapperPlugin: GraphileConfig.Plugin`

**Internal functions:**
- `createSqlTransformProxy<T>(client, transform)` — Proxy wrapping `query()` and `withTransaction()`
- `wrapWithPgClient(original, contextValue)` — lazy wrapper that reads `pgSqlTextTransform` at call time

**Behavior:**
1. Runs in `grafast.middleware.prepareArgs` (after `PgContextPlugin`)
2. Iterates all `pgServices`, wraps each `withPgClient` function on `contextValue`
3. At execution time, reads `contextValue.pgSqlTextTransform`
4. If transform exists: proxy `client.query()` to transform `opts.text`
5. If no transform: pass through unchanged
6. Also wraps `client.withTransaction()` for transaction-scoped queries

**Dependencies:** None (pure Grafast plugin, no external imports)

### 2. `multi-tenancy-cache.ts`

**Purpose:** Top-level orchestrator — the main consumer-facing API.

**Exports:**
- `getOrCreateTenantInstance(config, presetBuilder)` → `Promise<TenantInstance>`
- `onTenantEvicted(cacheKey)` — notify cache of tenant removal
- `getMultiTenancyCacheStats()` → `MultiTenancyCacheStats`
- `shutdownMultiTenancyCache()` — release all resources
- Types: `TenantConfig`, `TenantInstance`, `MultiTenancyCacheStats`

**Flow (getOrCreateTenantInstance):**
1. `getOrCreateIntrospection(pool, schemas, dbname)` → fingerprint
2. `getTemplate(fingerprint)` → hit? → reuse, `registerTenant()`
3. Miss → check single-flight (`creatingTemplates` map)
4. Miss → `createTemplate()` (builds PostGraphile instance, `setTemplate()`)
5. Return `TenantInstance` with `buildSchemaRemapTransform()` as `sqlTextTransform`

**Fallback:** If introspection fails, creates a dedicated (non-shared) instance.

**Dependencies:** `introspection-cache`, `registry-template-map`, `utils/sql-transform`, `utils/schema-map`, `postgraphile`, `grafserv`, `express`

### 3. `registry-template-map.ts`

**Purpose:** Global template registry with lifecycle management.

**Exports:**
- `getTemplate(fingerprint)` → `RegistryTemplate | undefined`
- `setTemplate(fingerprint, template)`
- `registerTenant(cacheKey, fingerprint)` — increment refCount
- `deregisterTenant(cacheKey)` — decrement refCount, mark idle
- `sweepIdleTemplates()` — evict expired + over-cap templates
- `clearAllTemplates()` — shutdown cleanup
- `getTemplateStats()` — diagnostic stats
- `_testSetMaxTemplates(n)` — test-only hook
- Type: `RegistryTemplate`

**Eviction policy:**
- **TTL:** Templates with `refCount === 0` and `idleSince` older than 30min are evicted
- **LRU cap:** When `templateMap.size > MAX_TEMPLATES` (50), oldest idle templates evicted first
- **Periodic sweep:** Every 5min (lazy-started, `unref()`'d for clean exit)
- **Active protection:** Templates with `refCount > 0` are never evicted
- **Cleanup:** `disposeTemplate()` calls `pgl.release()` + `httpServer.close()`

### 4. `introspection-cache.ts`

**Purpose:** In-memory cache for parsed introspection results + fingerprints.

**Exports:**
- `getOrCreateIntrospection(pool, schemas, dbname)` → `Promise<CachedIntrospection>`
- `invalidateIntrospection(dbname, schemas?)` — targeted invalidation
- `clearIntrospectionCache()` — full clear + stop sweep timer
- `sweepIntrospectionCache()` — evict expired + over-cap entries
- `getIntrospectionCacheStats()` → `IntrospectionCacheStats`
- `_testSetMaxEntries(n)` — test-only hook
- Types: `CachedIntrospection`, `IntrospectionCacheStats`

**Key:** `dbname:schema1,schema2` (schemas sorted alphabetically)

**Eviction policy:** Same pattern as template cache — TTL (30min idle) + LRU cap (100 entries) + periodic sweep (5min).

**Single-flight:** `inflight` Map coalesces concurrent requests. `finally` block guarantees cleanup. Failed entries are NOT cached.

### 5. `fingerprint.ts`

**Purpose:** Schema-name-agnostic structural fingerprinting.

**Exports:**
- `getSchemaFingerprint(introspection, schemaNames?)` → SHA-256 hex string
- `fingerprintsMatch(a, b)` → boolean
- Types: `MinimalIntrospection`, `IntrospectionClass`, `IntrospectionAttribute`, `IntrospectionConstraint`, `IntrospectionType`, `IntrospectionNamespace`, `IntrospectionProc`

**What's included in fingerprint:** Table names, column names, data types, constraints, function signatures.

**What's excluded:** Schema/namespace names, OIDs, instance-specific identifiers. This ensures `t_1_services_public.apis` and `t_2_services_public.apis` produce the same fingerprint.

### 6. `utils/sql-transform.ts`

**Purpose:** SQL text transform — the single-pass regex replacement logic.

**Exports:**
- `buildSchemaRemapTransform(schemaMap)` → `(text: string) => string`

**How it works:**
1. Pre-computes escaped identifier forms using `pg-sql2.escapeSqlIdentifier()`
2. Builds a single regex: `/"t_1_services_public"|"t_1_services_private"/g`
3. Returns a function that does one `text.replace(regex, lookupFn)` per query
4. Empty schema map → identity function (no-op)

### 7. `utils/schema-map.ts`

**Purpose:** Schema mapping and pgSettings helpers.

**Exports:**
- `buildSchemaMap(templateSchemas, tenantSchemas)` → `Record<string, string>`
- `buildTenantPgSettings(tenantSchemas)` → `Record<string, string>` (includes `search_path`)
- `remapSchemas(templateSchemas, templatePrefix, tenantPrefix)` → `string[]`
- Type: `SchemaMapping`

### 8. `utils/introspection-query.ts`

**Purpose:** Low-level introspection fetch + parse.

**Exports:**
- `fetchIntrospection(pool, schemas)` → raw JSON string
- `parseIntrospection(text)` → `MinimalIntrospection`
- `fetchAndParseIntrospection(pool, schemas)` → `{ raw, parsed }`

**Connection safety:** Uses `BEGIN` + `SET LOCAL search_path` + `COMMIT` so the search_path never leaks to pooled connections.

---

## Server integration

### `graphile.ts` changes

**New function: `multiTenancyHandler(opts)`**
- Selected when `opts.api.useMultiTenancyCache === true`
- Three-phase request handling: cache check → single-flight coalesce → create/reuse
- Injects `req.sqlTextTransform` before routing to template handler

**New function: `buildMultiTenancyPreset(pool, schemas, anonRole, roleName)`**
- Same as `buildPreset()` but adds:
  - `plugins: [PgMultiTenancyWrapperPlugin]`
  - `pgSqlTextTransform` injection in `grafast.context`

**New exports:**
- `isMultiTenancyCacheEnabled(opts)` — boolean check
- `flushTenantInstance(key)` — evict from local `tenantInstances` map
- `shutdownMultiTenancy()` — graceful shutdown (called from `server.ts`)

### `flush.ts` changes

**New function: `createFlushMiddleware(opts)`**
- Replaces `flush` (deprecated but kept for backwards compat)
- Adds multi-tenancy cache invalidation: `onTenantEvicted()`, `flushTenantInstance()`, `invalidateIntrospection()`

**`flushService()` changes:**
- When multi-tenancy enabled: looks up `dbname` from `databaseId`, calls `invalidateIntrospection(dbname)`

### `types.ts` changes

Add to `Express.Request`:
```ts
sqlTextTransform?: (text: string) => string;
```

### `env.ts` + `graphile.ts` (types) changes

- Add `USE_MULTI_TENANCY_CACHE` env var → `api.useMultiTenancyCache: boolean`
- Default: `false` (opt-in)

---

## Activation

```bash
# Enable multi-tenancy cache
USE_MULTI_TENANCY_CACHE=true

# For old (dedicated) mode, enlarge cache to avoid eviction churn:
# GRAPHILE_CACHE_MAX=<K×6> where K = tenant count (min 100)
```

When `useMultiTenancyCache` is `false` (default), the server uses the existing `graphile-cache` (one PostGraphile instance per `svc_key`) — zero behavioral change.

---

## Dependencies

```json
{
  "dependencies": {
    "@pgpmjs/logger": "workspace:^",
    "express": "^5.2.1",
    "grafserv": "1.0.0",
    "graphile-config": "1.0.0",
    "pg": "^8.11.3",
    "pg-env": "workspace:^",
    "pg-introspection": "1.0.0",
    "pg-sql2": "5.0.0",
    "postgraphile": "5.0.0"
  },
  "devDependencies": {
    "@types/express": "^5.0.6",
    "@types/pg": "^8.10.9",
    "makage": "^0.3.0",
    "ts-node": "^10.9.2"
  }
}
```

No Crystal fork. No `link:` overrides. Works with published Crystal/PostGraphile packages.

---

## Test plan

### Unit tests (in `src/__tests__/`)

| Test file | Coverage |
|---|---|
| `pg-client-wrapper-plugin.test.ts` | Proxy intercepts query/withTransaction, lazy transform read, no-op passthrough, release preservation |
| `registry-template-map.test.ts` | register/deregister refCount, TTL eviction, LRU cap eviction, active-template protection, sweep timer, exact-cap boundary |
| `introspection-cache.test.ts` | Cache hit/miss, single-flight coalescing, failure retry, TTL eviction, LRU cap eviction, invalidation |
| `fingerprint.test.ts` | Same-structure-different-schema → same fingerprint, different-structure → different fingerprint, constraint normalization |
| `sql-transform.test.ts` | Single-pass regex replacement, identity transform, multi-schema remap |
| `schema-map.test.ts` | Schema mapping, pgSettings generation, prefix remapping |
| `single-flight.test.ts` | Concurrent creation coalescing, failure propagation |

### E2E validation

- Start server with `USE_MULTI_TENANCY_CACHE=true`
- Send requests for k tenants with identical schemas
- Assert: 0 errors, template count = 1, all tenants sharing
- Compare QPS/latency/memory vs dedicated mode

---

## Expected performance (from v2 benchmarks, k=20)

| Metric | Dedicated (Old) | Multi-tenant (New) | Improvement |
|---|---|---|---|
| QPS | 706 | 780 | +10.5% |
| p50 latency | 11ms | 11ms | same |
| p99 latency | 42ms | 29ms | -31% |
| Heap growth | +1,276 MB | +334 MB | 73.8% less |
| RSS growth | +1,697 MB | +845 MB | 50.2% less |
| PostGraphile builds | 20 | 0 | eliminated |
| Cold start (2nd+) | 412ms | 7ms | 98.3% faster |

*Old mode given `GRAPHILE_CACHE_MAX=120` (best-case, zero eviction). New mode still wins.*

---

## Implementation order

1. **Package scaffolding** — `package.json`, tsconfig, jest config
2. **Utilities** — `utils/sql-transform.ts`, `utils/schema-map.ts`, `utils/introspection-query.ts`, `fingerprint.ts`
3. **Cache layers** — `introspection-cache.ts`, `registry-template-map.ts`
4. **Plugin** — `pg-client-wrapper-plugin.ts`
5. **Orchestrator** — `multi-tenancy-cache.ts`
6. **Public API** — `index.ts`
7. **Server integration** — `graphile.ts`, `flush.ts`, `types.ts`, `env.ts`, `graphile.ts` (types), `server.ts`, `index.ts`
8. **Tests** — unit tests for all modules
9. **Benchmark scripts** — `graphql/server/perf/` (e2e load testing framework)
10. **Validation** — e2e test run
