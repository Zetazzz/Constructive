---
name: pgsql-test-exceptions
description: Handle PostgreSQL aborted transactions when testing operations that should fail. Use when testing RLS policy violations, constraint errors, permission denied errors, or any expected database exceptions. Essential for security testing.
compatibility: Node.js 18+, pgsql-test package, PostgreSQL
metadata:
  author: constructive-io
  version: "1.0.0"
---

# Testing Exceptions and Aborted Transactions

Handle PostgreSQL's transaction abort behavior when testing operations that should fail. This is essential for security testing where you verify that unauthorized operations are rejected.

## When to Apply

Use this skill when:
- Testing RLS policy violations (user can't access other users' data)
- Testing constraint violations (unique, foreign key, check)
- Testing permission denied errors
- Testing any operation that should throw an error
- Verifying database state after a failed operation

## The Problem

When PostgreSQL encounters an error inside a transaction, it aborts the entire transaction. The connection rejects all further commands until you explicitly end the transaction:

```
current transaction is aborted, commands ignored until end of transaction block
```

This breaks naive exception testing:

```typescript
// THIS WILL FAIL
it('users cannot insert pets for other users', async () => {
  db.setContext({
    role: 'authenticated',
    'jwt.claims.user_id': bob
  });

  await expect(
    db.query(`INSERT INTO pets (name, owner_id) VALUES ('Fake', $1)`, [alice])
  ).rejects.toThrow(/violates row-level security/);

  // ERROR: transaction is aborted, this query fails!
  const count = await db.query(`SELECT COUNT(*) FROM pets WHERE owner_id = $1`, [alice]);
});
```

## The Solution: Savepoints

Create a savepoint before the failing operation, then roll back to it:

```typescript
it('users cannot insert pets for other users', async () => {
  db.setContext({
    role: 'authenticated',
    'jwt.claims.user_id': bob
  });

  // 1. Create savepoint before expected failure
  await db.savepoint('insert_attempt');

  // 2. Test the operation that should fail
  await expect(
    db.query(`INSERT INTO pets (name, owner_id) VALUES ('Fake', $1)`, [alice])
  ).rejects.toThrow(/violates row-level security/);

  // 3. Roll back to clear the error state
  await db.rollback('insert_attempt');

  // 4. Continue with verification queries
  const count = await db.query(`SELECT COUNT(*) FROM pets WHERE owner_id = $1`, [alice]);
  expect(parseInt(count.rows[0].count)).toBe(2);
});
```

## Pattern Template

```typescript
// 1. Create savepoint
await db.savepoint('my_savepoint_name');

// 2. Execute operation that should fail
await expect(
  db.query(`...`)
).rejects.toThrow(/expected error pattern/);

// 3. Roll back to savepoint
await db.rollback('my_savepoint_name');

// 4. Continue with additional queries
const result = await db.query(`...`);
```

## Common Scenarios

### RLS Policy Violations

```typescript
it('users cannot modify other users data', async () => {
  db.setContext({ role: 'authenticated', 'jwt.claims.user_id': bob });

  await db.savepoint('update_attempt');
  await expect(
    db.query(`UPDATE items SET name = 'stolen' WHERE owner_id = $1`, [alice])
  ).rejects.toThrow(/violates row-level security/);
  await db.rollback('update_attempt');

  // Verify data unchanged
  db.setContext({ role: 'authenticated', 'jwt.claims.user_id': alice });
  const item = await db.query(`SELECT name FROM items WHERE owner_id = $1`, [alice]);
  expect(item.rows[0].name).toBe('original');
});
```

### Permission Denied

```typescript
it('anonymous users cannot modify data', async () => {
  db.setContext({ role: 'anonymous' });

  await db.savepoint('anon_insert');
  await expect(
    db.query(`INSERT INTO users (name) VALUES ('hacker')`)
  ).rejects.toThrow(/permission denied/);
  await db.rollback('anon_insert');

  await db.savepoint('anon_update');
  await expect(
    db.query(`UPDATE users SET name = 'hacked'`)
  ).rejects.toThrow(/permission denied/);
  await db.rollback('anon_update');

  await db.savepoint('anon_delete');
  await expect(
    db.query(`DELETE FROM users`)
  ).rejects.toThrow(/permission denied/);
  await db.rollback('anon_delete');
});
```

### Constraint Violations

```typescript
it('rejects duplicate emails', async () => {
  await db.query(`INSERT INTO users (email) VALUES ('test@example.com')`);

  await db.savepoint('duplicate_email');
  await expect(
    db.query(`INSERT INTO users (email) VALUES ('test@example.com')`)
  ).rejects.toThrow(/duplicate key value violates unique constraint/);
  await db.rollback('duplicate_email');

  // Verify only one user exists
  const count = await db.query(`SELECT COUNT(*) FROM users`);
  expect(parseInt(count.rows[0].count)).toBe(1);
});
```

### PLPGSQL Function Validation

```typescript
describe('plpgsql_expr', () => {
  it('rejects NULL query', async () => {
    await db.savepoint('null_query');
    await expect(
      db.any(`SELECT my_function(NULL)`)
    ).rejects.toThrow('query cannot be NULL');
    await db.rollback('null_query');
  });

  it('rejects invalid input', async () => {
    await db.savepoint('invalid_input');
    await expect(
      db.any(`SELECT my_function('{"invalid": true}'::jsonb)`)
    ).rejects.toThrow('invalid input format');
    await db.rollback('invalid_input');
  });
});
```

### Multiple Failure Tests in Sequence

```typescript
it('validates all input constraints', async () => {
  // Test 1: null name
  await db.savepoint('null_name');
  await expect(
    db.query(`INSERT INTO products (name, price) VALUES (NULL, 10)`)
  ).rejects.toThrow(/null value in column "name"/);
  await db.rollback('null_name');

  // Test 2: negative price
  await db.savepoint('negative_price');
  await expect(
    db.query(`INSERT INTO products (name, price) VALUES ('item', -5)`)
  ).rejects.toThrow(/violates check constraint/);
  await db.rollback('negative_price');

  // Test 3: valid insert works
  await db.query(`INSERT INTO products (name, price) VALUES ('item', 10)`);
  const result = await db.query(`SELECT * FROM products`);
  expect(result.rows).toHaveLength(1);
});
```

## Key Rules

1. **Always use unique savepoint names** - Avoid conflicts between tests
2. **Roll back immediately after the expected failure** - Before any other queries
3. **Use descriptive savepoint names** - Makes debugging easier
4. **Each failure needs its own savepoint** - Can't reuse savepoints after rollback

## Why This Matters

Without savepoints, you cannot verify database state after a failed operation. That verification is often the most important part of a security test - confirming that the malicious operation had no effect.

## References

- Related skill: `pgpm` (`references/testing.md`) for general test setup
- Related skill: `pgpm` (`references/env.md`) for environment configuration
