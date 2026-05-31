# Local Dev Setup

Quick-start for running the Constructive GraphQL server locally with Docker Postgres and pgpm.

## Prerequisites

- Docker (for Postgres)
- Node.js v22+
- pgpm: `npm install -g pgpm`

## Start PostgreSQL

```bash
pgpm docker start --image docker.io/constructiveio/postgres-plus:18 --recreate
eval "$(pgpm env)"
pgpm admin-users bootstrap --yes
pgpm admin-users add --test --yes
```

> **Important:** `eval "$(pgpm env)"` must be run as a separate command (not chained with `&&`) so the env vars are available for subsequent commands.

## Deploy Platform Database

> Database deployment uses `pgpm deploy` from the `constructive-db` repo. See the `constructive-db-local-env` skill in `constructive-io/constructive-db` for step-by-step instructions.

## Start GraphQL Server

```bash
cd graphql/server
PGDATABASE=constructive pnpm dev
```

Health check: `curl -s -o /dev/null -w "%{http_code}" http://api.localhost:3000/graphql` → 405

## Endpoint Reference

| Endpoint | Purpose |
|---|---|
| `http://auth.localhost:3000/graphql` | Main auth |
| `http://api.localhost:3000/graphql` | Main public API |
| `http://auth-<db>.localhost:3000/graphql` | Per-DB auth |
| `http://app-public-<db>.localhost:3000/graphql` | Per-DB app API |
| `http://admin-<db>.localhost:3000/graphql` | Per-DB admin |

## Related

- `constructive-db-local-env` skill (in constructive-db repo) — platform database deployment
- `constructive-sdk` skill — provision a user database after setup
