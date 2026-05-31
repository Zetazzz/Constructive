# Local Email Services

Start Mailpit, Admin GraphQL Server, send-email-link, and job-service for local email testing using Docker Compose.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Local Development                        │
│                                                              │
│   Next.js (3011) ──► Public GraphQL (3000)                  │
│                                                              │
│   ┌─────────────────────────────────────────────────────┐   │
│   │              Email Services (Docker)                 │   │
│   │                                                      │   │
│   │   Admin GraphQL (3002)                              │   │
│   │         │                                           │   │
│   │         ▼                                           │   │
│   │   send-email-link (8082)                            │   │
│   │         │                                           │   │
│   │         ▼                                           │   │
│   │   Mailpit (1025/8025) ◄── job-service (8080)        │   │
│   │                                                      │   │
│   └─────────────────────────────────────────────────────┘   │
│                                                              │
│   PostgreSQL (5432) ◄── job-service polls app_jobs          │
└─────────────────────────────────────────────────────────────┘
```

## Prerequisites

1. Docker Desktop running
2. PostgreSQL running with constructive database
3. Database provisioned with `app_jobs` schema
4. `constructive` repo on branch `feat/add-local-email-service-docker-compose` (or main after merged)
5. `constructive:dev` Docker image built

> ⚠️ **分支要求：** `docker-compose.local-email.yml` 在 `feat/add-local-email-service-docker-compose` 分支，合并到 main 之前需先切换：
> ```bash
> cd /path/to/constructive
> git checkout feat/add-local-email-service-docker-compose
> ```

## Quick Start

### Step 1: Build the Docker Image (first time only)

```bash
cd /path/to/constructive

# Switch to required branch (until merged to main)
git checkout feat/add-local-email-service-docker-compose

# Create network
docker network create constructive-net 2>/dev/null || true

# Build image (takes ~3-5 minutes)
docker build -t constructive:dev .
```

### Step 2: Start Email Services

```bash
cd /path/to/constructive

docker-compose -f docker-compose.local-email.yml up -d
```

### Step 3: Verify

```bash
# Check status
docker-compose -f docker-compose.local-email.yml ps

# Health check
echo "=== Health Check ==="
curl -s http://localhost:8025 >/dev/null && echo "✅ Mailpit (8025)"
curl -s http://localhost:3002/graphql -H "X-Meta-Schema: true" -H "Content-Type: application/json" \
  -d '{"query":"{ __typename }"}' | grep -q __typename && echo "✅ Admin GraphQL (3002)"
lsof -i:8082 >/dev/null && echo "✅ send-email-link (8082)"
lsof -i:8080 >/dev/null && echo "✅ job-service (8080)"
```

**Mailpit UI:** http://localhost:8025

## Managing Services

```bash
cd /path/to/constructive

# Start
docker-compose -f docker-compose.local-email.yml up -d

# Stop
docker-compose -f docker-compose.local-email.yml down

# View logs (all services)
docker-compose -f docker-compose.local-email.yml logs -f

# View logs (specific service)
docker logs -f mailpit
docker logs -f constructive-admin-server
docker logs -f send-email-link
docker logs -f knative-job-service

# Restart
docker-compose -f docker-compose.local-email.yml restart
```

## Port Reference

| Service | Port | URL |
|---------|------|-----|
| Mailpit SMTP | 1025 | - |
| Mailpit Web UI | 8025 | http://localhost:8025 |
| Admin GraphQL | 3002 | http://localhost:3002/graphql |
| send-email-link | 8082 | http://localhost:8082 |
| job-service | 8080 | http://localhost:8080 |

## Test Email Flow

1. Open Mailpit: http://localhost:8025
2. Trigger an invite/signup from your app (http://localhost:3011)
3. Check Mailpit for the email

## Troubleshooting

### Port already in use

```bash
# Find and kill process on port
lsof -ti:8082 | xargs kill -9
```

### Container name conflict

```bash
# Remove old containers
docker rm -f mailpit constructive-admin-server send-email-link knative-job-service

# Restart
docker-compose -f docker-compose.local-email.yml up -d
```

### Cannot connect to PostgreSQL

Check that `PGHOST` in docker-compose uses `host.docker.internal` (not `localhost`):

```yaml
PGHOST: host.docker.internal
```

### View service logs for debugging

```bash
docker logs constructive-admin-server 2>&1 | tail -30
docker logs send-email-link 2>&1 | tail -30
docker logs knative-job-service 2>&1 | tail -30
```
