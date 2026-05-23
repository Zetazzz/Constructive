# Shared Seed Fixtures

Composable SQL seed layers for integration testing. Each layer builds on the previous one.

## Layers

| Layer | Files | What it provides |
|-------|-------|-----------------|
| **services** | `services/setup.sql` | Roles, extensions, stamps, metaschema tables, services tables, settings tables, modules tables, grants |
| **services data** | `services/test-data.sql` | Example database (`simple-pets`), 3 schemas, 5 APIs, 2 domains, API→schema linkage, animals metaschema entries |
| **app-schemas** | `app-schemas/simple-pets/schema.sql` | `simple-pets-*` schemas, animals table with constraints/indexes/triggers |
| **app data** | `app-schemas/simple-pets/test-data.sql` | 5 test animals (Buddy, Max, Whiskers, Mittens, Tweety) |

## Usage with pgsql-test

```typescript
import { getConnections } from 'pgsql-test';
import path from 'path';

const SEED = path.resolve(__dirname, '../../../__fixtures__/seed');

const { db, teardown } = await getConnections({
  seed: seed.sqlfile([
    `${SEED}/services/setup.sql`,
    `${SEED}/services/test-data.sql`,
    `${SEED}/app-schemas/simple-pets/schema.sql`,
    `${SEED}/app-schemas/simple-pets/test-data.sql`,
  ])
});
```

## Composition

Pick only the layers you need:

- **Metaschema + services only** (no app tables): `services/setup.sql` + `services/test-data.sql`
- **Full stack with app data**: all four files in order
- **Custom app schema**: `services/setup.sql` + `services/test-data.sql` + your own schema/data SQL

## Consumers

These test files use the shared fixtures (no local duplicates):

| Test file | Seed files used |
|-----------|----------------|
| `graphql/server-test/__tests__/server.integration.test.ts` | `services/*` + `app-schemas/simple-pets/*` (services scenarios) |
| `graphql/server-test/__tests__/express-context.integration.test.ts` | `services/*` + `app-schemas/simple-pets/*` |
| `graphql/server-test/__tests__/upload.integration.test.ts` | `services/setup.sql` (DDL only, storage data is local) |

## Well-Known IDs

| Entity | ID | Notes |
|--------|----|-------|
| Database | `80a2eaaf-f77e-4bfe-8506-df929ef1b8d9` | "simple-pets" |
| Schema (public) | `6dbae92a-5450-401b-1ed5-d69e7754940d` | `simple-pets-public` |
| Schema (private) | `6dba9876-043f-48ee-399d-ddc991ad978d` | `simple-pets-private` |
| Schema (pets_public) | `6dba6f21-0193-43f4-3bdb-61b4b956b6b6` | `simple-pets-pets-public` |
| API (app) | `6c9997a4-591b-4cb3-9313-4ef45d6f134e` | Public, `authenticated`/`anonymous` |
| API (private) | `e257c53d-6ba6-40de-b679-61b37188a316` | Private, `administrator`/`administrator` |
| Domain (app) | `41181146-890e-4991-9da7-3dddf87d9e78` | `app.test` / `constructive.io` |
| Domain (private) | `51181146-890e-4991-9da7-3dddf87d9e79` | `private.test` / `constructive.io` |
