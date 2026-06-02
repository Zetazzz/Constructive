---
name: pgsql-test-jwt-context
description: Setting up JWT claims and role-based context for RLS testing with pgsql-test. Use when testing Row-Level Security policies, simulating authenticated users with JWT claims, or configuring PostgreSQL session variables for RLS.
---

Setting up JWT claims and role-based context for RLS testing with pgsql-test.

## Overview

When testing Row-Level Security (RLS) policies, you need to simulate authenticated users with JWT claims. The `pgsql-test` library provides the `setContext()` method to configure PostgreSQL session variables that RLS policies can read.

## The setContext API

Use `setContext()` to simulate different user roles and JWT claims:

```typescript
db.setContext({
  role: 'authenticated',
  'jwt.claims.user_id': '00000000-0000-0000-0000-000000000001',
  'jwt.claims.org_id': 'acme-corp'
});
```

This applies settings using `SET LOCAL` statements, ensuring they persist only for the current transaction and maintain proper isolation between tests.

## How It Works Internally

The `setContext()` method generates SQL statements:

```sql
-- For the 'role' key, uses SET LOCAL ROLE
SET LOCAL ROLE "authenticated";

-- For other keys, uses set_config() with transaction-local scope
SELECT set_config('jwt.claims.user_id', '00000000-0000-0000-0000-000000000001', true);
SELECT set_config('jwt.claims.org_id', 'acme-corp', true);
```

The third parameter `true` in `set_config()` makes the setting transaction-local, which is essential for test isolation.

## The auth() Helper Method

For common authentication patterns, use the `auth()` helper:

```typescript
// Simple authenticated user
db.auth({
  role: 'authenticated',
  userId: '00000000-0000-0000-0000-000000000001'
});

// Custom user ID key
db.auth({
  role: 'authenticated',
  userId: '123',
  userIdKey: 'request.jwt.claims.sub'
});
```

## Common JWT Claim Patterns

### User Authentication

```typescript
db.setContext({
  role: 'authenticated',
  'jwt.claims.user_id': userId
});
```

### Organization Context

```typescript
db.setContext({
  role: 'authenticated',
  'jwt.claims.user_id': userId,
  'jwt.claims.org_id': orgId
});
```

### Database Context

```typescript
db.setContext({
  role: 'authenticated',
  'jwt.claims.user_id': userId,
  'jwt.claims.database_id': databaseId
});
```

### Additional Claims

```typescript
db.setContext({
  role: 'authenticated',
  'jwt.claims.user_id': userId,
  'jwt.claims.user_agent': 'Mozilla/5.0...',
  'jwt.claims.ip_address': '127.0.0.1'
});
```

## Reading Claims in SQL

Your RLS policies can read these claims using `current_setting()`:

```sql
-- In an RLS policy
CREATE POLICY user_isolation ON my_table
  FOR ALL
  USING (owner_id = current_setting('jwt.claims.user_id', true)::uuid);
```

You can also create helper functions:

```sql
CREATE FUNCTION current_user_id() RETURNS uuid AS $$
  SELECT current_setting('jwt.claims.user_id', true)::uuid;
$$ LANGUAGE sql STABLE;
```

## Clearing Context

To reset context between scenarios:

```typescript
db.clearContext();
```

This nulls all previously set context variables and resets to the default anonymous role.

## Testing Different Access Levels

```typescript
describe('RLS policies', () => {
  const USER_1 = '00000000-0000-0000-0000-000000000001';
  const USER_2 = '00000000-0000-0000-0000-000000000002';

  beforeEach(() => db.beforeEach());
  afterEach(() => db.afterEach());

  it('user can see their own data', async () => {
    db.setContext({
      role: 'authenticated',
      'jwt.claims.user_id': USER_1
    });

    const rows = await db.any('SELECT * FROM my_table WHERE owner_id = $1', [USER_1]);
    expect(rows.length).toBeGreaterThan(0);
  });

  it('user cannot see other users data', async () => {
    db.setContext({
      role: 'authenticated',
      'jwt.claims.user_id': USER_2
    });

    const rows = await db.any('SELECT * FROM my_table WHERE owner_id = $1', [USER_1]);
    expect(rows.length).toBe(0);
  });

  it('anonymous users have no access', async () => {
    db.setContext({ role: 'anonymous' });

    const rows = await db.any('SELECT * FROM my_table');
    expect(rows.length).toBe(0);
  });
});
```

## Context Timing

Call `setContext()` before `beforeEach()` to apply context at the start of each test:

```typescript
describe('authenticated role', () => {
  beforeEach(async () => {
    db.setContext({ role: 'authenticated', 'jwt.claims.user_id': USER_ID });
    await db.beforeEach();
  });

  afterEach(() => db.afterEach());

  it('runs as authenticated', async () => {
    const res = await db.query(`SELECT current_setting('role', true) AS role`);
    expect(res.rows[0].role).toBe('authenticated');
  });
});
```

Or set context within individual tests for scenario-specific testing:

```typescript
it('switches between users', async () => {
  db.setContext({ role: 'authenticated', 'jwt.claims.user_id': USER_1 });
  const user1Data = await db.any('SELECT * FROM my_table');

  db.setContext({ role: 'authenticated', 'jwt.claims.user_id': USER_2 });
  const user2Data = await db.any('SELECT * FROM my_table');

  expect(user1Data).not.toEqual(user2Data);
});
```

## Best Practices

1. Use predefined UUID constants for test user IDs to ensure consistency
2. Set context before `beforeEach()` for describe-level defaults
3. Use `clearContext()` when switching between unrelated scenarios
4. Test both positive cases (user can access) and negative cases (user cannot access)
5. Test anonymous/unauthenticated access explicitly
6. **In `beforeAll()`, wrap context-dependent `db` operations in explicit `db.begin()`/`db.commit()`** — `set_config(..., true)` is transaction-local, so without an active transaction the context is lost between queries. See [pgsql-test-transactions.md](./pgsql-test-transactions.md) for details.
