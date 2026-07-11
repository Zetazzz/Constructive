# Environment Configuration with @pgpmjs/env

Environment configuration for the PGPM and PostgreSQL toolchain. It provides PGPM config-file discovery, PGPM-owned environment parsing, and hierarchical option merging. It is not the universal runtime configuration package for Constructive.

## When to Apply

Use this skill when:

- Configuring PostgreSQL connections programmatically
- Setting up PGPM environment options
- Managing database configuration across environments
- Writing PGPM tooling that needs config-file and environment merging

## Installation

```bash
pnpm add @pgpmjs/env
```

## Core Concepts

### Configuration Hierarchy

Options are merged in this order (later overrides earlier):

1. **PGPM defaults** — Built-in sensible defaults
2. **Config file** — `pgpm.json` discovered via walkUp
3. **Environment variables** — `PGHOST`, `PGPORT`, etc.
4. **Runtime overrides** — Passed programmatically

## Basic Usage

### getPgpmEnvOptions()

Get merged PGPM options:

```typescript
import { getPgpmEnvOptions } from '@pgpmjs/env';

const options = getPgpmEnvOptions();
// Returns merged options from defaults + config + env vars

// With runtime overrides
const databaseOptions = getPgpmEnvOptions({
  pg: { database: 'mydb' }
});

// With custom working directory
const projectOptions = getPgpmEnvOptions({}, '/path/to/project');
```

`getPgpmEnvOptions()` is the canonical name. `getEnvOptions` remains the exact same function reference as a short-name alias; it does not preserve the removed non-PGPM result fields. Do not introduce new PGPM code with the generic alias.

The resolver projects defaults, config-file content, environment values, and runtime overrides to PGPM-owned keys. GraphQL server, storage, jobs, and SMTP sections do not appear in its result.

### getConnEnvOptions()

Get database connection options specifically:

```typescript
import { getConnEnvOptions } from '@pgpmjs/env';

const connOptions = getConnEnvOptions();
// Returns db-specific options with roles and connections resolved
```

### getDeploymentEnvOptions()

Get deployment-specific options:

```typescript
import { getDeploymentEnvOptions } from '@pgpmjs/env';

const deployOptions = getDeploymentEnvOptions();
// Returns deployment options (useTx, fast, usePlan, etc.)
```

## Environment Variables

### PostgreSQL Connection

| Variable | Description | Default |
|----------|-------------|---------|
| `PGHOST` | Database host | `localhost` |
| `PGPORT` | Database port | `5432` |
| `PGDATABASE` | Database name | — |
| `PGUSER` | Database user | `postgres` |
| `PGPASSWORD` | Database password | — |

### Database Configuration

| Variable | Description |
|----------|-------------|
| `PGROOTDATABASE` | Root database for admin operations |
| `PGTEMPLATE` | Template database for createdb |
| `DB_PREFIX` | Prefix for database names |
| `DB_EXTENSIONS` | Comma-separated list of extensions |
| `DB_CWD` | Working directory for database operations |

### Connection Credentials

| Variable | Description |
|----------|-------------|
| `DB_CONNECTIONS_APP_USER` | App-level user |
| `DB_CONNECTIONS_APP_PASSWORD` | App-level password |
| `DB_CONNECTIONS_ADMIN_USER` | Admin-level user |
| `DB_CONNECTIONS_ADMIN_PASSWORD` | Admin-level password |

### Deployment Options

| Variable | Description |
|----------|-------------|
| `DEPLOYMENT_USE_TX` | Use transactions for deployment |
| `DEPLOYMENT_FAST` | Fast deployment mode |
| `DEPLOYMENT_USE_PLAN` | Use deployment plan |
| `DEPLOYMENT_CACHE` | Enable deployment caching |
| `DEPLOYMENT_TO_CHANGE` | Deploy to specific change |
| `DEPLOYMENT_HASH_METHOD` | Deployment hash method: `content` or `ast` |

### Migration Options

| Variable | Description |
|----------|-------------|
| `MIGRATIONS_CODEGEN_USE_TX` | Use a transaction for migration code generation |

### Error Output

| Variable | Description |
|----------|-------------|
| `PGPM_ERROR_QUERY_HISTORY_LIMIT` | Query history limit in errors |
| `PGPM_ERROR_MAX_LENGTH` | Max error message length |
| `PGPM_ERROR_VERBOSE` | Verbose error output |

## Choose the Resolver Level

`@pgpmjs/env` owns only PGPM/PostgreSQL configuration. Constructive runtime configuration is intentionally centralized one level above it:

| Need | Entry point |
|------|-------------|
| Full Constructive application or runtime | `getConstructiveEnvOptions()` from `@constructive-io/graphql-env` |
| Constructive test harness inputs | `getTestEnvOptions()` from `@constructive-io/graphql-env` |
| Process-specific `PORT` defaults | The corresponding port helper from `@constructive-io/graphql-env` |

The Constructive resolver returns PGPM, GraphQL, storage, jobs, SMTP/Mailgun, function, Graphile, codegen, and LLM options. This broader dependency is an explicit project choice; do not create separate env packages for those groups. The dependency direction remains one-way: `graphql-env` may call `pgpmjs/env`, but PGPM packages must never import upward.

## Config File Discovery

The discovery APIs below remain exported from `@pgpmjs/env`. `@constructive-io/graphql-env` reuses `loadConfigSync()` and projects only its own sections. Infrastructure reuse does not make those sections PGPM-owned.

### loadConfigSync()

Load `pgpm.json` by walking up directory tree:

```typescript
import { loadConfigSync } from '@pgpmjs/env';

const config = loadConfigSync('/path/to/project');
// Finds nearest pgpm.json walking up from given path
```

### loadConfigSyncFromDir()

Load config from specific directory:

```typescript
import { loadConfigSyncFromDir } from '@pgpmjs/env';

const config = loadConfigSyncFromDir('/path/to/project');
```

### resolvePgpmPath()

Find the pgpm.json file path:

```typescript
import { resolvePgpmPath } from '@pgpmjs/env';

const pgpmPath = resolvePgpmPath('/path/to/project');
// Returns full path to pgpm.json or undefined
```

## Workspace Resolution

### resolvePnpmWorkspace()

Find pnpm-workspace.yaml:

```typescript
import { resolvePnpmWorkspace } from '@pgpmjs/env';

const workspacePath = resolvePnpmWorkspace('/path/to/project');
```

### resolveLernaWorkspace()

Find lerna.json:

```typescript
import { resolveLernaWorkspace } from '@pgpmjs/env';

const lernaPath = resolveLernaWorkspace('/path/to/project');
```

### resolveWorkspaceByType()

Find workspace config by type:

```typescript
import { resolveWorkspaceByType, WorkspaceType } from '@pgpmjs/env';

const path = resolveWorkspaceByType('/path/to/project', 'pnpm');
// WorkspaceType: 'pnpm' | 'lerna' | 'npm'
```

## Utility Functions

### walkUp()

Walk up directory tree to find a file:

```typescript
import { walkUp } from '@pgpmjs/env';

const found = walkUp('/start/path', 'pgpm.json');
// Returns path to file or undefined
```

### getEnvVars()

Parse PGPM-owned environment variables into `PgpmOptions` without applying defaults or config files:

```typescript
import { getEnvVars } from '@pgpmjs/env';

const envOptions = getEnvVars();
// Or with custom env object
const suppliedEnvOptions = getEnvVars(process.env);
```

The primitive parsing helpers below remain exported for PGPM and lower-level consumers. Runtime helpers such as `getNodeEnv()` belong to `@constructive-io/graphql-env` and are not exported from the PGPM package.

### parseEnvBoolean()

Parse boolean environment variable:

```typescript
import { parseEnvBoolean } from '@pgpmjs/env';

parseEnvBoolean('true');  // true
parseEnvBoolean('1');     // true
parseEnvBoolean('yes');   // true
parseEnvBoolean('false'); // false
parseEnvBoolean(undefined); // undefined
```

### parseEnvNumber()

Parse numeric environment variable:

```typescript
import { parseEnvNumber } from '@pgpmjs/env';

parseEnvNumber('5432');    // 5432
parseEnvNumber('invalid'); // undefined
parseEnvNumber(undefined); // undefined
```

## pgpm.json Configuration

Example `pgpm.json` with environment options:

```json
{
  "name": "my-module",
  "version": "1.0.0",
  "db": {
    "rootDb": "postgres",
    "template": "template1",
    "prefix": "myapp_",
    "extensions": ["uuid-ossp", "pgcrypto"],
    "roles": {
      "admin": "admin_role",
      "app": "app_role",
      "anonymous": "anon_role",
      "authenticated": "auth_role"
    },
    "connections": {
      "app": {
        "user": "app_user",
        "password": "app_password"
      },
      "admin": {
        "user": "admin_user",
        "password": "admin_password"
      }
    }
  },
  "deployment": {
    "useTx": true,
    "fast": false,
    "usePlan": true
  }
}
```

## Integration with pgsql-test

```typescript
import { getConnEnvOptions } from '@pgpmjs/env';
import { getConnections } from 'pgsql-test';

const connOptions = getConnEnvOptions();
const { db, teardown } = await getConnections(connOptions);
```

## Integration with pgpm CLI

The pgpm CLI uses @pgpmjs/env internally. Quick setup:

```bash
# Export standard PostgreSQL env vars
eval "$(pgpm env)"

# Now all pgpm commands use these vars
pgpm deploy --createdb
```

## Best Practices

1. **Use `getPgpmEnvOptions()`**: Let the PGPM resolver handle merging and runtime projection.
2. **Choose the resolver level**: Use PGPM env only for PGPM/PostgreSQL. Use GraphQL env for every non-PGPM Constructive runtime group, including storage, jobs, SMTP/providers, and functions.
3. **Resolve once**: Read configuration at a process composition root and inject typed options into reusable code.
4. **Config file for non-secret defaults**: Put project defaults in `pgpm.json`.
5. **Environment variables for secrets**: Never commit passwords to `pgpm.json`.
6. **Override at runtime**: Pass overrides for test-specific configuration.
7. **Consistent `cwd`**: Pass an explicit working directory when running from different directories.

## References

- Related skill: `references/cli.md` for CLI commands
- Related skill: `references/workspace.md` for workspace configuration
- Related skill: `github-workflows-pgpm` for CI/CD environment setup
- Decision: [Environment Ownership Decision](../../../../docs/plan/environment-ownership-follow-up.md) for the accepted two-level ownership model and complete variable inventory
