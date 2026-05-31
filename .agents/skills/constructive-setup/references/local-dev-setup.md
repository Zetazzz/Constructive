# Local Dev Setup

Quick-start for running the Constructive GraphQL server locally with Docker Postgres and pgpm.

## Prerequisites

- Docker (for Postgres)
- Node.js v22+
- pgpm: `npm install -g pgpm`

## Start

```bash
eval "$(pgpm env)"
pgpm docker start
```

## Deploy Platform DB

```bash
cd path/to/constructive-db
dropdb --if-exists constructive
pgpm deploy --database constructive --createdb --yes --package constructive-services
pgpm deploy --database constructive --yes --package constructive-local
```

## Start GraphQL Server

```bash
cd path/to/constructive/graphql/server
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

- `constructive-sdk` skill — provision a database after setup
