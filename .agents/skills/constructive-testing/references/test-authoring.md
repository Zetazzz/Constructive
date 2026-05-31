# Test Authoring: Lean, Readable, Fast

How to structure tests — which preset to pick, which utilities to call, and how to keep test files short and expressive. For CI shard balancing see `ci-test-optimization.md`. For RLS/transaction mechanics see `integration-testing.md`.

## Rule #1: Provision the Minimum

Every module added to a preset costs provisioning time (~3–8s per module). The single biggest lever for fast tests is provisioning only what the test exercises.

### Preset Selection Decision Tree

```
What does your test exercise?
│
├─ Table/field/trigger generators (no RLS, no auth)
│  → preset: 'minimal'  (~5s)
│
├─ App-level memberships or permissions (no orgs)
│  → preset: 'permissions_app'  (~10s)
│
├─ Memberships with data manipulation (no RLS enforcement)
│  → preset: 'memberships'  (~12s)
│
├─ Memberships with RLS (org creation via createOrg)
│  → preset: 'memberships_rls'  (~14s)
│
├─ Auth flows (login, register, sessions, tokens)
│  → preset: 'accounts'  (~20s)
│
├─ Invite workflows
│  → preset: 'invites'  (~22s)
│
├─ Org chart / hierarchy
│  → preset: 'hierarchy'  (~18s)
│
├─ Feature needs specific modules not in a preset
│  → Custom array: preset: ['users_module', 'agent_chat_module']
│
└─ Blueprint construction / "needs everything"
   → preset: 'full'  (~50-60s) — use sparingly
```

### Anti-Pattern: Over-Provisioning

```typescript
// ❌ 60s provisioning to test a feature that only needs users_module
const { testHelper } = await provisionTestDatabase(db, pg, { preset: 'full' });

// ✅ 5s provisioning, tests exactly what it needs
const { testHelper } = await provisionTestDatabase(db, pg, { preset: 'minimal' });
```

## Infrastructure Belongs in CI, Not in Tests

Roles are bootstrapped by CI before tests run. Tests must assume roles already exist. Never call `CREATE EXTENSION` in test code — declare in `.control` file.

## Test File Skeleton

```typescript
jest.setTimeout(120000);
process.env.LOG_SCOPE = 'pgsql-test';

import { getConnections, PgTestClient, snapshot } from 'pgsql-test';
import { TestHelper, provisionTestDatabase } from '../../test-utils/test-helpers';

let db: PgTestClient;
let pg: PgTestClient;
let teardown: () => Promise<void>;
let t: TestHelper;

beforeAll(async () => {
  ({ db, pg, teardown } = await getConnections());
  const { testHelper } = await provisionTestDatabase(db, pg, { preset: 'minimal' });
  t = testHelper;
});

afterAll(() => teardown());
beforeEach(async () => { await db.beforeEach(); });
afterEach(async () => { await db.afterEach(); });
```

### DbMetaTest (Higher-Level API)

For tests needing org charts, labeled snapshots, or `asUser()` context isolation:

```typescript
let ctx: DbMetaTest;
beforeAll(async () => { ctx = await DbMetaTest.setup({ preset: 'hierarchy' }); });
afterAll(() => ctx.teardown());
ctx.installHooks();
```

## Using Test Utilities for Readable Tests

Tests should read like scenarios, not SQL:

```typescript
// ❌ Hard to read
const limitsTable = await pg.one(`SELECT s.schema_name, lm.limits_table::text FROM ...`);
await pg.any(`INSERT INTO "${limitsTable.schema_name}"."${limitsTable.limits_table}" ...`);

// ✅ Readable
const limitsTable = await t.getLimitsTable('app');
await pg.any(`INSERT INTO ${limitsTable} (name, num, max, actor_id) VALUES ('seats', 0, 3, $1)`, [user.id]);
const result = await t.callLimitIncrement('seats', 'app');
```
