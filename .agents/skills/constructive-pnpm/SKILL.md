---
name: constructive-pnpm
description: "PNPM workspace management — monorepo configuration, dist-folder publishing with makage/lerna, dependency management, deep nested imports, and anti-patterns to avoid. Use when configuring pnpm workspaces, publishing packages to npm, managing monorepo dependencies, or setting up new TypeScript packages."
metadata:
  author: constructive-io
  version: "1.0.0"
---

# Constructive PNPM

PNPM workspace management, package publishing, and monorepo best practices for Constructive projects.

## When to Apply

Use this skill when:
- Configuring pnpm workspaces and monorepo settings
- Publishing TypeScript packages to npm with makage and lerna
- Managing workspace dependencies and cross-package references
- Setting up the dist-folder publishing pattern
- Understanding deep nested imports vs `exports` map (anti-pattern)

## Key Concepts

### Dist-Folder Publishing (TypeScript/JS Only)

Constructive publishes **TypeScript/JS packages** from the `dist/` folder, which becomes the package root on npm. This means:
- `main: "index.js"` points to `dist/index.js` after publish
- Consumers never see `dist/` in their import paths
- No `exports` field needed — standard Node.js resolution works
- Uses `makage build` to compile TypeScript and copy assets to `dist/`
- `publishConfig.directory: "dist"` in package.json

**This does NOT apply to pgpm SQL modules.** PGPM modules publish from the package root (no `dist/` folder, no makage). They use `pgpm package` to bundle SQL files instead. See the `pgpm` skill ([publishing.md](../pgpm/references/publishing.md)) for the SQL module publishing workflow.

### Deep Nested Imports (NOT `exports` Map)

**NEVER use the `exports` map pattern.** Instead, use deep nested imports via file paths:

```typescript
// Correct: deep nested import (works because dist/ becomes package root)
import { OrmClient } from '@my-org/sdk/api';
import { generateOrm } from '@constructive-io/graphql-codegen/core/codegen/orm';

// WRONG: exports map anti-pattern
// "exports": { "./api": { "import": "./dist/api/index.js" } }
```

See [pnpm-publishing.md](./references/pnpm-publishing.md) for the full explanation.

## Reference Guide

| Reference | Topic | Consult When |
|-----------|-------|--------------|
| [pnpm-workspace.md](./references/pnpm-workspace.md) | pnpm workspace overview | Setting up monorepo, workspace configuration |
| [pnpm-monorepo-management.md](./references/pnpm-monorepo-management.md) | Monorepo management | Cross-package dependencies, filtering, CI/CD patterns |
| [pnpm-publishing.md](./references/pnpm-publishing.md) | Publishing packages | Lerna versioning, makage builds, dist-folder pattern |

## Cross-References

- `inquirerer-cli` — CLI building with inquirerer, README formatting
- `pgpm` — PGPM workspaces for SQL modules (different from pnpm workspaces)
- `constructive-platform` — Platform core, environment configuration
