# Constructive Local Environment Setup

Set up a fully working local Constructive environment with PostgreSQL, the constructive-local database package, and the GraphQL server. Enables testing the generated CLI, running e2e tests, and developing against a real GraphQL API.

## When to Apply

Use this reference when:
- Setting up a local development environment for Constructive
- Testing the generated CLI (`constructive-cli`)
- Running the e2e test script (`test-cli-e2e.sh`)
- Needing a running GraphQL server for development
- Deploying `constructive-local` to a local PostgreSQL instance

## Prerequisites

- Docker installed and running
- Node.js 22+
- pnpm installed
- Access to `constructive-io/constructive-db` and `constructive-io/constructive` repos

## Step-by-Step Setup

### 1. Install pgpm globally

```bash
npm install -g pgpm
```

### 2. Start PostgreSQL via pgpm Docker

```bash
pgpm docker start
```

Uses `docker.io/constructiveio/postgres-plus:18` container (includes PostGIS, pgvector, and other required extensions). PostgreSQL 17+ is required because `constructive-local` uses `security_invoker` on views.

### 3. Set environment variables

```bash
eval "$(pgpm env)"
```

Sets `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, and `PGDATABASE` for the local PostgreSQL instance.

**Important**: Run this as a separate command (not chained with `&&`) so the env vars are available for subsequent commands.

### 4. Deploy constructive-local

```bash
cd /path/to/constructive-db/packages/constructive-local
pgpm deploy
```

Deploys the full Constructive database schema (tables, functions, triggers, RLS policies). Takes about 30-60 seconds.

### 5. Install dependencies and start server

```bash
cd /path/to/constructive
pnpm install
pnpm dev
```

The server starts at `http://localhost:5555` with subdomain-based routing:

| Target | Endpoint |
|--------|----------|
| Public | `http://api.localhost:5555/graphql` |
| Auth | `http://auth.localhost:5555/graphql` |
| Objects | `http://objects.localhost:5555/graphql` |
| Admin | `http://admin.localhost:5555/graphql` |

### 6. Test the CLI

```bash
cd /path/to/constructive-db/sdk/constructive-cli
pnpm install
npx tsx cli/index.ts --help
```

#### Quick smoke test

```bash
CLI="npx tsx cli/index.ts"
$CLI context create local --endpoint http://api.localhost:5555/graphql
$CLI context use local
$CLI public:sign-up --input '{"email":"test@example.com","password":"testpass123"}'
$CLI credentials set-token "<token-from-signup>"
$CLI public:database list
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `BASE_HOST` | `localhost` | Server hostname |
| `BASE_PORT` | `5555` | Server port |
| `CLI_EMAIL` | auto-generated | Test user email |
| `CLI_PASSWORD` | `testpass123` | Test user password |

## Troubleshooting

| Issue | Fix |
|-------|-----|
| "security_invoker" error | Need PostgreSQL 17+. Use `pgpm docker start --image docker.io/constructiveio/postgres-plus:18` |
| "OrmClientConfig requires endpoint" | Set CLI context: `context create local --endpoint ...` |
| "permission denied for schema" | Token not set or expired. Re-authenticate and `credentials set-token` |
| Server not responding | Verify with `curl -s http://api.localhost:5555/graphql -H 'Content-Type: application/json' -d '{"query":"{ __typename }"}'` |
