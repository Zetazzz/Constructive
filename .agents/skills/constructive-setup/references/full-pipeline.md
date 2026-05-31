# Constructive Full Pipeline

Autonomous end-to-end workflow: Docker → deploy platform DB → provision user DB → generate SDK → verify.

## Prerequisites

- Docker running
- Node.js v22+
- `pgpm` installed globally: `npm install -g pgpm`
- `pnpm` installed
- Both repos cloned:
  - `constructive-io/constructive-db` (database + codegen)
  - `constructive-io/constructive` (monorepo with GraphQL server + codegen CLI)

## Phase 1: Start PostgreSQL

```bash
pgpm docker start --image docker.io/constructiveio/postgres-plus:18 --recreate
eval "$(pgpm env)"
pgpm admin-users bootstrap --yes
pgpm admin-users add --test --yes
```

**Verify:** `psql -c "SELECT 1"` returns successfully.

## Phase 2: Deploy Platform Database

```bash
cd <path-to-constructive-db>
pnpm install
dropdb --if-exists constructive
pgpm deploy --database constructive --createdb --yes --package constructive-services
pgpm deploy --database constructive --yes --package constructive-local
```

**Verify:** `psql -d constructive -c "SELECT count(*) FROM metaschema_public.database"` returns without error.

## Phase 3: Start GraphQL Server

```bash
cd <path-to-constructive>/graphql/server
PGDATABASE=constructive pnpm dev
```

**Verify:** `curl -s -o /dev/null -w "%{http_code}" http://api.localhost:3000/graphql` returns `405`.

### Endpoint Reference

| Endpoint | Purpose |
|---|---|
| `http://auth.localhost:3000/graphql` | Main auth |
| `http://api.localhost:3000/graphql` | Main public API |
| `http://auth-<db>.localhost:3000/graphql` | Per-DB auth |
| `http://app-public-<db>.localhost:3000/graphql` | Per-DB app API |
| `http://admin-<db>.localhost:3000/graphql` | Per-DB admin |

## Phase 4: Provision a User Database (via SDK)

See `constructive-sdk` skill for the full auth + provisioning flow.

```typescript
import { createClient as createAuthClient } from '@constructive-db/sdk/auth';
import { createClient as createPublicClient } from '@constructive-db/sdk/public';

// 1. Sign up + sign in
const authDb = createAuthClient({ endpoint: 'http://auth.localhost:3000/graphql' });
await authDb.mutation.signUp({ input: { email, password } }, { select: { ok: true } }).execute();
const result = await authDb.mutation.signIn(
  { input: { email, password } },
  { select: { result: { select: { accessToken: true, userId: true } } } }
).execute();
const { accessToken, userId } = result.signIn.result;

// 2. Provision database with all modules
const publicDb = createPublicClient({
  endpoint: 'http://api.localhost:3000/graphql',
  headers: { Authorization: `Bearer ${accessToken}` },
});
await publicDb.databaseProvisionModule.create({
  data: {
    databaseName: dbName, ownerId: userId, subdomain: dbName, domain: 'localhost',
    modules: ['all'], bootstrapUser: true,
  },
  select: { id: true, databaseId: true, status: true },
}).execute();
```

## Phase 5: Regenerate SDK (Codegen)

```bash
cd <path-to-constructive-db>
pnpm run generate:all
```

| Command | What it runs |
|---|---|
| `generate:constructive-all` | `generate:constructive` + `generate:schemas` |
| `generate:schemas-all` | `generate:schemas` + `generate:sdk` + `generate:sdk-new` + `generate:cli` |
| `generate:all` | Everything in correct order |

## Phase 6: Verify End-to-End

1. **Tests pass:** `cd <path-to-constructive-db> && pnpm test`
2. **SDK types compile:** `cd sdk/constructive-sdk && pnpm tsc --noEmit`
3. **GraphQL server responds:** `curl -s http://api.localhost:3000/graphql -H "Content-Type: application/json" -d '{"query":"{ __typename }"}' | jq .`

## Related Skills

- `constructive-sdk` — Auth flow, database provisioning, secure tables
- `constructive-sdk-database` — Database CRUD, modules, lifecycle
- `pgpm` — Docker, migrations, testing
