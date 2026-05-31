# Constructive Next.js App Boilerplate

A frontend-only Next.js application that connects to a Constructive backend. Provides production-ready authentication flows, organization management, invite handling, member management, and account settings — all powered by a generated GraphQL SDK.

## Setup

### 1. Scaffold from Template

```bash
pgpm init -w \
  --repo constructive-io/sandbox-templates \
  --template nextjs/constructive-app \
  --name <workspace-name> \
  --fullName "<Author Full Name>" \
  --email "<author@example.com>" \
  --repoName <workspace-name> \
  --username <github-username> \
  --license MIT \
  --moduleName <module-name>
```

### 2. Install and Configure

```bash
cd <workspace-name>/packages/<module-name>
pnpm install
```

Create `.env.local`:

```bash
NEXT_PUBLIC_SCHEMA_BUILDER_GRAPHQL_ENDPOINT=http://api.localhost:3000/graphql
```

### 3. Generate SDK and Start

```bash
pnpm codegen   # Generate GraphQL SDK against running backend
pnpm dev       # Opens at http://localhost:3001
```

## Backend Requirements

Requires a running Constructive backend (typically via Constructive Hub):

| Service | Port | Purpose |
|---------|------|---------|
| PostgreSQL | 5432 | Database with Constructive schema |
| GraphQL Server (Public) | 3000 | API endpoint for app operations |
| GraphQL Server (Private) | 3002 | Admin operations |
| Job Service | 8080 | Background job processing |
| Email Function | 8082 | Email sending via SMTP |
| Mailpit SMTP | 1025 | Email server (development) |
| Mailpit UI | 8025 | View sent emails |

## Project Structure

```
src/
├── app/                        # Next.js App Router pages
│   ├── login/ register/        # Auth flows
│   ├── account/ settings/      # User management
│   └── orgs/[orgId]/           # Org-scoped pages (activity, invites, members, settings)
├── components/
│   ├── ui/                     # shadcn/ui components (43 components)
│   ├── auth/                   # Auth forms
│   ├── organizations/          # Org CRUD
│   ├── invites/ members/       # Org management
│   └── app-shell/              # Sidebar, navigation, layout
├── graphql/
│   └── schema-builder-sdk/     # Generated SDK (via codegen)
└── lib/
    ├── auth/                   # Auth utilities and context
    ├── gql/                    # GraphQL hooks and query factories
    └── permissions/            # Permission checking
```

## Customization

### Branding

Edit `src/config/branding.ts` — app name, tagline, logo paths, legal links.

### Adding UI Components

```bash
npx shadcn@latest add @constructive/<component>
```

Registry URL configured in `components.json`. Components use Base UI primitives, Tailwind CSS 4, and cva for variants.

## Features

- **Authentication** — Login, register, logout, password reset, email verification
- **Organizations** — Create and manage organizations
- **Invites** — Send and accept organization invites
- **Members** — Manage organization members and roles
- **Account Management** — Profile, email verification, account deletion
- **App Shell** — Sidebar navigation, theme switching, responsive layout
- **Permissions** — Role-based access control for org features
