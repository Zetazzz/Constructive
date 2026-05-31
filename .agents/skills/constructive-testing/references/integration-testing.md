# Integration Testing in constructive-db

## The Two Clients: `pg` vs `db`

Every integration test gets two database clients from `pgsql-test`:

```typescript
import { getConnections, PgTestClient } from 'pgsql-test';

let db: PgTestClient;  // RLS-enforced (authenticated role)
let pg: PgTestClient;  // Superuser (bypasses RLS)
let teardown: () => Promise<void>;

beforeAll(async () => {
  ({ db, pg, teardown } = await getConnections());
});
afterAll(() => teardown());
```

### The Cardinal Rule

> **`pg` is ONLY used in `beforeAll` for bootstrap/DDL/catalog queries. `db` is used for ALL data operations and test queries.**

- `pg` (superuser) bypasses RLS entirely. Use it **only** for: creating test users, provisioning databases, DDL operations, and read-only catalog queries.
- `db` (authenticated or administrator role) enforces triggers and FK constraints. Use it for all data operations.
- Never use `pg` inside `it()` blocks for queries you're testing.

### The Three Roles

| Role | Client | Bypasses RLS? | When to use |
|------|--------|---------------|-------------|
| **superuser** | `pg` | Yes | Bootstrap only: `createTestUser`, `provisionDatabase`, DDL |
| **administrator** | `db` with `setContext({ role: 'administrator' })` | Effectively yes | Elevated data operations: adding members, creating buckets |
| **authenticated** | `db` with `setContext({ role: 'authenticated', ... })` | No (full RLS) | All test queries — this is what real users get |

### Cross-Connection Visibility

> **Data written by `db` inside a per-test savepoint is invisible to `pg` (separate connection).**

```typescript
// WRONG — pg can't see db's savepoint data
const row = await pg.one(`SELECT ... WHERE actor_id = $1`, [user.user_id]);

// CORRECT — use db with administrator role
db.setContext({ role: 'administrator' });
const row = await db.one(`SELECT ... WHERE actor_id = $1`, [user.user_id]);
```

### Cross-Connection Deadlock: NEVER mix `pg` and `db` for the same rows

If a test body needs to seed data AND act on it, ALL operations must go through `db`:

```typescript
// WRONG — deadlocks: pg holds lock, db blocks waiting
it('test', async () => {
  await limits.insert({ ... }); // pg
  db.setContext({ role: 'authenticated', ... });
  const ok = await limits_as_user.increment(...); // db → DEADLOCK
});

// CORRECT — single connection
it('test', async () => {
  db.setContext({ role: 'administrator' });
  await limits_as_user.insert({ ... }); // db
  db.setContext({ role: 'authenticated', ... });
  const ok = await limits_as_user.increment(...); // db → works
});
```

**When is `pg` safe?** Only in `beforeAll`, where there are no savepoints yet.

## Test File Structure

```typescript
jest.setTimeout(300000);
process.env.LOG_SCOPE = 'pgsql-test';

import { getConnections, PgTestClient } from 'pgsql-test';

const ALICE_ID = '00000000-0000-0000-0000-00000000a001';
const BOB_ID   = '00000000-0000-0000-0000-00000000b002';

let db: PgTestClient;
let pg: PgTestClient;
let teardown: () => Promise<void>;

beforeAll(async () => {
  ({ db, pg, teardown } = await getConnections());
  // 1. Bootstrap — pg (superuser, auto-commits)
  // 2. Set membership defaults — pg
  // 3. Resolve schema/table names — pg (read-only)
  // 4. Add members — db as administrator (triggers populate SPRT)
});

afterAll(() => teardown());
beforeEach(async () => { await db.beforeEach(); });
afterEach(async () => { await db.afterEach(); });
```

## Setting Actor Context

```typescript
db.setContext({ role: 'authenticated', 'jwt.claims.user_id': ALICE_ID });
const rows = await db.any(`SELECT * FROM "${schema}"."${table}" WHERE owner_id = $1`, [ALICE_ID]);
```

Some tests also use `db.auth({ userId: ALICE_ID })` as a shorthand.
