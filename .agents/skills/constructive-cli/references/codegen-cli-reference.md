# CLI Codegen Reference

Complete reference for `@constructive-io/graphql-codegen` CLI commands.

## @constructive-io/graphql-codegen generate

Generate type-safe React Query hooks and/or ORM client from GraphQL schema.

```bash
npx @constructive-io/graphql-codegen generate [options]
```

### Source Options (choose one)

| Option | Alias | Description | Default |
|--------|-------|-------------|---------|
| `--endpoint <url>` | `-e` | GraphQL endpoint URL | - |
| `--schema-file <path>` | `-s` | Path to GraphQL schema file (.graphql) | - |
| `--schemas <list>` | - | PostgreSQL schemas (comma-separated) | - |
| `--api-names <list>` | - | API names for auto schema discovery | - |
| `--config <path>` | `-c` | Path to config file | `graphql-codegen.config.ts` |

### Generator Options

| Option | Description | Default |
|--------|-------------|---------|
| `--react-query` | Generate React Query hooks | `false` |
| `--orm` | Generate ORM client | `false` |

### Output Options

| Option | Alias | Description | Default |
|--------|-------|-------------|---------|
| `--output <dir>` | `-o` | Output directory | `./generated/graphql` |
| `--target <name>` | `-t` | Target name (for multi-target configs) | - |

### Schema Export Options

| Option | Description | Default |
|--------|-------------|---------|
| `--schema-enabled` | Export GraphQL SDL schema file | `false` |
| `--schema-output <dir>` | Output directory for exported schema | Same as `--output` |
| `--schema-filename <name>` | Filename for exported schema | `schema.graphql` |

### Other Options

| Option | Alias | Description | Default |
|--------|-------|-------------|---------|
| `--authorization <token>` | `-a` | Authorization header value | - |
| `--verbose` | `-v` | Show detailed output | `false` |
| `--dry-run` | - | Preview without writing files | `false` |

## Examples

### From GraphQL Endpoint

```bash
npx @constructive-io/graphql-codegen generate --react-query --endpoint https://api.example.com/graphql
npx @constructive-io/graphql-codegen generate --orm --endpoint https://api.example.com/graphql
npx @constructive-io/graphql-codegen generate --react-query --orm --endpoint https://api.example.com/graphql
```

### From Schema File

```bash
npx @constructive-io/graphql-codegen generate --react-query --schema-file ./schema.graphql
```

### From Database

```bash
npx @constructive-io/graphql-codegen generate --react-query --schemas public,app_public
npx @constructive-io/graphql-codegen generate --orm --api-names my_api
```

### Using Config File

```bash
npx @constructive-io/graphql-codegen generate
npx @constructive-io/graphql-codegen generate --config ./config/codegen.config.ts
npx @constructive-io/graphql-codegen generate --target production  # Multi-target
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `PGHOST` | PostgreSQL host (for database introspection) |
| `PGPORT` | PostgreSQL port |
| `PGDATABASE` | PostgreSQL database name |
| `PGUSER` | PostgreSQL user |
| `PGPASSWORD` | PostgreSQL password |

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | General error |
| `2` | Configuration error |
| `3` | Network/schema error |

## Troubleshooting

| Issue | Solution |
|-------|----------|
| No code generated | Add `--react-query` or `--orm` flag |
| "Cannot use both endpoint and schemas" | Choose one schema source |
| No CLI generated | Add `cli: true` to generate options |
| Auth errors | Run `{toolName} auth set-token <token>` |
| Wrong endpoint | Run `{toolName} context use <name>` |
