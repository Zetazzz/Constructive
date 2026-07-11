# @pgpmjs/env

<p align="center" width="100%">
  <img height="250" src="https://raw.githubusercontent.com/constructive-io/constructive/refs/heads/main/assets/outline-logo.svg" />
</p>

<p align="center" width="100%">
  <a href="https://github.com/constructive-io/constructive/actions/workflows/run-tests.yaml">
    <img height="20" src="https://github.com/constructive-io/constructive/actions/workflows/run-tests.yaml/badge.svg" />
  </a>
   <a href="https://github.com/constructive-io/constructive/blob/main/LICENSE"><img height="20" src="https://img.shields.io/badge/license-MIT-blue.svg"/></a>
   <a href="https://www.npmjs.com/package/@pgpmjs/env"><img height="20" src="https://img.shields.io/github/package-json/v/constructive-io/constructive?filename=pgpm%2Fenv%2Fpackage.json"/></a>
</p>

Environment management for PGPM projects. It resolves PostgreSQL, migration, deployment, error-output, and PGPM workspace configuration from defaults, config files, environment variables, and overrides.

## Features

- Config file discovery using `walkUp` utility
- Environment variable parsing
- Unified merge hierarchy: defaults → config → env vars → overrides
- TypeScript support with full type safety

## Usage

```typescript
import { getPgpmEnvOptions } from '@pgpmjs/env';

const options = getPgpmEnvOptions(overrides, cwd);
```

`getEnvOptions` is an exact short-name alias of `getPgpmEnvOptions`. The alias preserves the function name, not the old catch-all result shape: non-PGPM fields are owned by the Constructive aggregate.

| Configuration now outside PGPM | Owner |
|---|---|
| `server`, `ServerOptions` | `@constructive-io/graphql-env` / `@constructive-io/graphql-types` |
| `cdn`, `StorageProvider`, `CDNOptions` | `@constructive-io/graphql-env` / `@constructive-io/graphql-types` |
| `jobs`, jobs types and `jobsDefaults` | `@constructive-io/graphql-env` / `@constructive-io/graphql-types` |
| `smtp`, `SmtpOptions`, Mailgun and function settings | `@constructive-io/graphql-env` / `@constructive-io/graphql-types` |

Constructive applications and runtimes should use `getConstructiveEnvOptions` from `@constructive-io/graphql-env`; it returns the complete configuration while internally composing PGPM configuration through `getPgpmEnvOptions`.
