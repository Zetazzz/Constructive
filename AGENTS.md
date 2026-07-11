# Constructive Agent Navigation Guide

This guide helps AI agents quickly navigate the Constructive monorepo. Constructive provides tooling for building secure, role-aware GraphQL APIs backed by PostgreSQL.

## Quick Start

**Most important packages to know first:**
1. **`pgpm/core`** – PGPM engine: migrations, packaging, dependency resolution ([guide](pgpm/core/AGENTS.md))
2. **`pgpm/pgpm`** – PGPM CLI: database/workspace commands (init/add/deploy/verify/etc)
3. **`packages/cli`** – Constructive CLI (`constructive` / `cnc`), delegates PGPM commands and adds GraphQL workflows ([guide](packages/cli/AGENTS.md))
4. **`postgres/pgsql-test`** – PostgreSQL test harness and seed adapters ([guide](postgres/pgsql-test/AGENTS.md))
5. **`graphql/server`** – Constructive GraphQL server (Express + PostGraphile)
6. **`graphql/codegen`** – GraphQL code generation (types/ops/sdk)

**Key classes and entry points:**
- **`PgpmPackage`** – `pgpm/core/src/core/class/pgpm.ts`
- **`PgpmMigrate`** – `pgpm/core/src/migrate/client.ts`
- **`GraphQLServer`** – `graphql/server/src/server.ts`

## Monorepo Layout

- **`packages/*`** – Constructive CLI + misc packages (`client`, `orm`, `query-builder`, `url-domains`, `server-utils`, etc.)
- **`pgpm/*`** – PGPM engine + CLI + shared types/logger/env
- **`graphql/*`** – GraphQL server, explorer, codegen, types/env, query/react utilities
- **`postgres/*`** – PostgreSQL tooling and tests (`pg-ast`, `pg-codegen`, `introspectron`, `pgsql-test`, etc.)
- **`streaming/*`** – S3 helpers and stream hashing utilities
- **`extensions/*`** – PGPM extension modules (Postgres extensions packaged as PGPM modules)
- **`graphile/*`** – Graphile/PostGraphile plugins (kept under their own namespace)
- **`jobs/*`**, **`functions/*`** – supporting systems and examples

## Entry Points

### PGPM CLI (`pgpm`)

- **Router:** `pgpm/pgpm/src/commands.ts`
- **Executable:** `pgpm/pgpm/src/index.ts`
- **Command implementations:** `pgpm/pgpm/src/commands/*`

### Constructive CLI (`constructive` / `cnc`)

- **Router:** `packages/cli/src/commands.ts`
- **Local GraphQL commands:** `packages/cli/src/commands/*`
- **Delegated PGPM commands:** sourced from `pgpm/pgpm`

### GraphQL Server

- **Entry:** `graphql/server/src/index.ts`
- **Server implementation:** `graphql/server/src/server.ts`
- **Schema wiring:** `graphql/server/src/schema.ts`

## Common Workflows (via CLI)

**Database Operations (pgpm):**
- Initialize workspace/module: `pgpm init workspace`, `pgpm init`
- Create a change: `pgpm add <change>`
- Deploy/verify/revert: `pgpm deploy`, `pgpm verify`, `pgpm revert`
- Install PGPM modules: `pgpm install <pkg@version>`

**GraphQL Operations (cnc/constructive):**
- Start GraphQL server: `cnc server`
- Launch GraphiQL explorer: `cnc explorer`
- Generate types/SDK: `cnc codegen`
- Export schema SDL: `cnc get-graphql-schema`

## Best Practices

### Environment Configuration

There are two configuration levels:

| Scope | Resolver | Guidance |
|-------|----------|----------|
| PGPM/PostgreSQL toolchain | `getPgpmEnvOptions()` from `@pgpmjs/env` | Canonical PGPM resolver. `getEnvOptions` is the same short-name alias but does not restore removed non-PGPM fields. |
| Constructive application/runtime | `getConstructiveEnvOptions()` from `@constructive-io/graphql-env` | Complete view containing PGPM plus GraphQL, storage, jobs, SMTP/Mailgun, functions, runtime, Graphile, codegen, and LLM configuration. |
| Constructive test harness | `getTestEnvOptions()` from `@constructive-io/graphql-env` | Test-only SMTP, GraphQL endpoint/credential, and database inputs. Keep secrets out of logs and snapshots. |
| Low-level PostgreSQL utility | `getPgEnvOptions()` from `pg-env`, or `getPgpmEnvOptions()` when PGPM config-file merging is required | Choose the narrowest result the utility needs. |

`@pgpmjs/env` remains the lower layer and must never import `@constructive-io/graphql-env`. It projects defaults, config, environment, and overrides to PostgreSQL/PGPM-owned keys only. `@constructive-io/graphql-env` calls it and then adds all Constructive-owned groups; do not create another domain-specific env package.

Constructive resolution uses **defaults → projected config section → environment variables → runtime overrides**. Arrays use replacement semantics. Required provider credentials and function URLs are validated lazily at the capability boundary, not while resolving the global object.

`PORT` is context-sensitive. Use the process helper from `@constructive-io/graphql-env` so GraphQL (`3000`), email functions (`8080`), and the Knative example (`10101`) retain distinct defaults.

```typescript
// GOOD: resolve once at a PGPM process root
import { getPgpmEnvOptions } from '@pgpmjs/env';
const opts = getPgpmEnvOptions({ pg: { database: 'mydb' } });

// BAD — scattered, untyped, no defaults
const host = process.env.PGHOST || 'localhost';
const port = parseInt(process.env.PGPORT || '5432');
```

The final ownership decision and variable inventory are recorded in [Environment Ownership Decision](docs/plan/environment-ownership-follow-up.md).

### Testing

Constructive provides a layered testing framework stack. **Always use the appropriate framework** — never manually create `pg.Pool` or `pg.Client` instances in tests.

#### Which Framework to Use

| Scenario | Framework | Import |
|----------|-----------|--------|
| Raw SQL, RLS policies, database functions | `pgsql-test` | `import { getConnections } from 'pgsql-test'` |
| PostGraphile schema, basic GraphQL queries | `graphile-test` | `import { getConnections } from 'graphile-test'` |
| GraphQL with Constructive plugins (search, pgvector, etc.) | `@constructive-io/graphql-test` | `import { getConnections } from '@constructive-io/graphql-test'` |
| HTTP endpoints, auth headers, middleware | `@constructive-io/graphql-server-test` | `import { getConnections } from '@constructive-io/graphql-server-test'` |

Each layer builds on `pgsql-test` underneath — they all create isolated test databases with proper teardown.

#### Required Test Hooks

Always include `beforeEach`/`afterEach` hooks to ensure test isolation via savepoints:

```typescript
import { getConnections, PgTestClient } from 'pgsql-test';

let pg: PgTestClient;
let db: PgTestClient;
let teardown: () => Promise<void>;

beforeAll(async () => {
  ({ pg, db, teardown } = await getConnections());
});

afterAll(async () => {
  await teardown();
});

beforeEach(async () => {
  await pg.beforeEach();
  await db.beforeEach();
});

afterEach(async () => {
  await db.afterEach();
  await pg.afterEach();
});
```

#### Anti-Patterns to Avoid

- **Never** create `new pg.Pool()` or `new pg.Client()` in tests — use `getConnections()` from the appropriate framework
- **Never** use `getPgPool()` from `pg-cache` in tests — that's for production connection pooling
- **Never** manually create/drop databases in tests — `pgsql-test` handles this automatically
- **Never** skip `beforeEach`/`afterEach` hooks — tests will leak state to each other
- **Never** construct connection strings manually — use the env configuration system

## Tooling Skills

The `.agents/skills/` directory contains tooling-focused skills for this monorepo:

| Skill | Description | When to Use |
|-------|-------------|-------------|
| `pgpm` | PostgreSQL Package Manager — migrations, CLI, Docker, CI/CD, project scaffolding, table creation rules, DB export | Database migrations, workspace/module creation, `pgpm init`, deploy/revert |
| `constructive-pnpm` | PNPM workspace management — monorepo config, dist-folder publishing with makage/lerna, dependency management | Configuring pnpm workspaces, publishing packages, managing monorepo dependencies |
| `constructive-setup` | Monorepo setup — install dependencies, start PostgreSQL, bootstrap users, build, run tests, local email services | Setting up the development environment, local dev, full pipeline |
| `constructive-testing` | PostgreSQL testing frameworks — pgsql-test, drizzle-orm-test, supabase-test | Writing database tests, testing RLS policies, seeding test data |
| `constructive-cli` | Generated CLI commands — how the CLI is generated from GraphQL schemas, codegen options, multi-target CLI | Generating CLI tools, running generated CLI, understanding codegen pipeline |
| `graphile-search` | Unified PostGraphile v5 search plugin — tsvector, BM25, pg_trgm, pgvector adapters, composite searchScore | Adding search to GraphQL, configuring search adapters, querying search via SDK |

## Tips

1. Start with `pgpm/core/AGENTS.md` to understand the migration and plan model.
2. Use `packages/cli/AGENTS.md` to understand Constructive's command routing.
3. Use `postgres/pgsql-test/AGENTS.md` for patterns around isolated test DBs and seeding.
