---
name: pgsql-test-helpers
description: Creating reusable test helper functions and constants for consistent, maintainable database tests. Use when extracting common test patterns into helpers, defining shared constants, or reducing duplication in pgsql-test suites.
---

Creating reusable test helper functions and constants for consistent, maintainable database tests.

## Overview

As test suites grow, common patterns emerge: creating users, setting up contexts, querying specific tables. Extracting these into helper functions improves readability, reduces duplication, and makes tests more maintainable.

## Predefined Constants

### Test User IDs

Use predefined UUIDs for test users to ensure consistency across tests:

```typescript
export const TEST_USER_IDS = {
  USER_1: '00000000-0000-0000-0000-000000000001',
  USER_2: '00000000-0000-0000-0000-000000000002',
  USER_3: '00000000-0000-0000-0000-000000000003',
  ADMIN: '00000000-0000-0000-0000-000000000099',
} as const;
```

Benefits:
- Easy to identify in database queries and logs
- Consistent across all test files
- Type-safe with `as const`

### Scope/Role Constants

```typescript
export const ROLES = {
  ANONYMOUS: 'anonymous',
  AUTHENTICATED: 'authenticated',
  SERVICE: 'service_role',
} as const;

export const SCOPE = {
  APP: 1,
  ORG: 2,
  GROUP: 3,
} as const;
```

## TypeScript Interfaces for Options

Define interfaces for helper function parameters:

```typescript
export interface CreateUserOptions {
  id: string;
  username?: string;
  display_name?: string;
  email?: string;
  is_admin?: boolean;
}

export interface CreateOrganizationOptions {
  name: string;
  owner_id: string;
}

export interface AddMemberOptions {
  user_id: string;
  org_id: string;
  role?: 'member' | 'admin' | 'owner';
}
```

Benefits:
- Self-documenting function signatures
- IDE autocomplete support
- Compile-time validation

## Helper Function Patterns

### Creating Test Users

```typescript
import { PgTestClient } from 'pgsql-test';

export async function createTestUser(
  pg: PgTestClient,
  options: CreateUserOptions
): Promise<void> {
  const {
    id,
    username = `user_${id.slice(0, 8)}`,
    display_name = 'Test User',
    email,
    is_admin = false,
  } = options;

  const columns = ['id', 'username', 'display_name', 'is_admin'];
  const values: unknown[] = [id, username, display_name, is_admin];
  const placeholders = ['$1', '$2', '$3', '$4'];

  if (email !== undefined) {
    columns.push('email');
    values.push(email);
    placeholders.push(`$${values.length}`);
  }

  await pg.query(
    `INSERT INTO users (${columns.join(', ')})
     VALUES (${placeholders.join(', ')})
     ON CONFLICT (id) DO NOTHING`,
    values
  );
}
```

### Creating Organizations

```typescript
export async function createOrganization(
  client: PgTestClient,
  options: CreateOrganizationOptions
): Promise<string> {
  const { name, owner_id } = options;

  const result = await client.one<{ id: string }>(
    `INSERT INTO organizations (name, owner_id)
     VALUES ($1, $2)
     RETURNING id`,
    [name, owner_id]
  );

  return result.id;
}
```

### Querying with Type Safety

```typescript
export interface UserRecord {
  id: string;
  username: string;
  display_name: string;
  is_admin: boolean;
  created_at: Date;
}

export async function getUserById(
  client: PgTestClient,
  userId: string
): Promise<UserRecord | null> {
  return client.oneOrNone<UserRecord>(
    `SELECT id, username, display_name, is_admin, created_at
     FROM users WHERE id = $1`,
    [userId]
  );
}

export async function getUsersByOrg(
  client: PgTestClient,
  orgId: string
): Promise<UserRecord[]> {
  return client.any<UserRecord>(
    `SELECT u.id, u.username, u.display_name, u.is_admin, u.created_at
     FROM users u
     JOIN memberships m ON m.user_id = u.id
     WHERE m.org_id = $1`,
    [orgId]
  );
}
```

## Unique Name Generation

For avoiding collisions in parallel tests:

```typescript
export function uniqueName(prefix: string): string {
  return `${prefix}-${Date.now()}`;
}

export function uniqueEmail(prefix: string = 'test'): string {
  return `${prefix}-${Date.now()}@example.com`;
}
```

Usage:

```typescript
const orgName = uniqueName('test-org');  // 'test-org-1706123456789'
const email = uniqueEmail('alice');       // 'alice-1706123456789@example.com'
```

## Context Helper Functions

### Setting Up Authenticated Context

```typescript
export function setAuthContext(
  db: PgTestClient,
  userId: string,
  additionalClaims?: Record<string, string>
): void {
  db.setContext({
    role: 'authenticated',
    'jwt.claims.user_id': userId,
    ...additionalClaims,
  });
}

export function setOrgContext(
  db: PgTestClient,
  userId: string,
  orgId: string
): void {
  db.setContext({
    role: 'authenticated',
    'jwt.claims.user_id': userId,
    'jwt.claims.org_id': orgId,
  });
}
```

Usage:

```typescript
it('user can access their data', async () => {
  setAuthContext(db, TEST_USER_IDS.USER_1);
  const data = await db.any('SELECT * FROM my_table');
  expect(data.length).toBeGreaterThan(0);
});
```

## Organizing Test Utils

### File Structure

```
__tests__/
  test-utils/
    index.ts          # Re-exports everything
    constants.ts      # TEST_USER_IDS, ROLES, etc.
    interfaces.ts     # TypeScript interfaces
    user-helpers.ts   # User-related helpers
    org-helpers.ts    # Organization helpers
    context-helpers.ts # Context/auth helpers
```

### index.ts

```typescript
export * from './constants';
export * from './interfaces';
export * from './user-helpers';
export * from './org-helpers';
export * from './context-helpers';
```

### Usage in Tests

```typescript
import {
  TEST_USER_IDS,
  createTestUser,
  createOrganization,
  setAuthContext,
} from '../test-utils';

describe('Organization tests', () => {
  beforeAll(async () => {
    await createTestUser(pg, { id: TEST_USER_IDS.USER_1 });
  });

  it('creates organization', async () => {
    setAuthContext(db, TEST_USER_IDS.USER_1);
    const orgId = await createOrganization(db, {
      name: 'Test Org',
      owner_id: TEST_USER_IDS.USER_1,
    });
    expect(orgId).toBeDefined();
  });
});
```

## Assertion Helpers

### Expecting Specific Counts

```typescript
export async function expectRowCount(
  client: PgTestClient,
  table: string,
  expectedCount: number,
  where?: string,
  values?: unknown[]
): Promise<void> {
  const whereClause = where ? ` WHERE ${where}` : '';
  const result = await client.one<{ count: string }>(
    `SELECT COUNT(*) FROM ${table}${whereClause}`,
    values
  );
  expect(parseInt(result.count)).toBe(expectedCount);
}
```

Usage:

```typescript
await expectRowCount(db, 'users', 2);
await expectRowCount(db, 'memberships', 1, 'org_id = $1', [orgId]);
```

### Expecting Access Denied

```typescript
export async function expectAccessDenied(
  client: PgTestClient,
  query: string,
  values?: unknown[]
): Promise<void> {
  const result = await client.any(query, values);
  expect(result.length).toBe(0);
}

export async function expectQueryError(
  client: PgTestClient,
  query: string,
  values?: unknown[],
  errorPattern?: RegExp
): Promise<void> {
  await expect(client.query(query, values)).rejects.toThrow(errorPattern);
}
```

## Best Practices

1. Keep helpers focused and single-purpose
2. Use TypeScript interfaces for all option objects
3. Provide sensible defaults for optional parameters
4. Use `ON CONFLICT DO NOTHING` for idempotent user creation
5. Return IDs from creation helpers for use in subsequent operations
6. Group related helpers in separate files
7. Re-export everything from a central index.ts
8. Use predefined constants instead of magic strings/UUIDs
9. Document complex helpers with JSDoc comments
10. Keep helpers in a dedicated test-utils directory
