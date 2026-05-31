# Custom Boilerplate Authoring

Create and customize boilerplate templates for `pgpm init`.

## Template Repository Structure

```
my-boilerplates/
  .boilerplates.json       # Root config (points to default directory)
  pgpm/                    # Default template variant (PGPM)
    module/
      .boilerplate.json    # Module template config
      package.json         # Template files with placeholders
      pgpm.plan
    workspace/
      .boilerplate.json    # Workspace template config
  pnpm/                    # Alternative variant (pure PNPM)
    module/
      .boilerplate.json
    workspace/
      .boilerplate.json
```

## Root Configuration

`.boilerplates.json` at the repository root specifies the default template directory:

```json
{
  "dir": "pgpm"
}
```

## Template Configuration

Each template has a `.boilerplate.json` file defining its type, workspace requirements, and questions.

### Template Types

| Type | Description |
|------|-------------|
| `workspace` | Creates a new monorepo workspace |
| `module` | Creates a package within a workspace |
| `generic` | Standalone template (no workspace context) |

### Workspace Requirements

```json
{
  "type": "module",
  "requiresWorkspace": "pgpm"
}
```

| Value | Description |
|-------|-------------|
| `"pgpm"` | Requires PGPM workspace (pgpm.json) |
| `"pnpm"` | Requires PNPM workspace (pnpm-workspace.yaml) |
| `"lerna"` | Requires Lerna workspace (lerna.json) |
| `"npm"` | Requires npm workspace (package.json with workspaces) |
| `false` | No workspace required |

## Placeholder System

Templates use the `____placeholder____` pattern (4 underscores on each side) for variable substitution:

```json
{
  "name": "@____username____/____moduleName____",
  "version": "0.0.1",
  "description": "____moduleDesc____",
  "author": "____fullName____ <____email____>"
}
```

## Question Configuration

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Placeholder name (e.g., `____fullName____`) |
| `message` | string | Prompt shown to user |
| `required` | boolean | Whether the field is required |
| `type` | string | Input type: `text`, `list`, `checkbox` |
| `options` | string[] | Static options for list/checkbox |
| `default` | any | Static default value |
| `defaultFrom` | string | Resolver for dynamic default |
| `setFrom` | string | Auto-set value (skips prompt) |
| `optionsFrom` | string | Resolver for dynamic options |

### Resolvers

**defaultFrom:** `git.user.name`, `git.user.email`, `npm.whoami`, `workspace.dirname`

**setFrom:** `workspace.name`, `workspace.author.name`, `workspace.author.email`, `workspace.license`, `workspace.organization.name`

**optionsFrom:** `licenses` (SPDX license identifiers)

## Creating a Custom Repository

1. Create a new repository with the structure above
2. Add `.boilerplates.json` pointing to your default directory
3. Create template directories with `.boilerplate.json` configs
4. Add template files with `____placeholder____` patterns
5. Use with `pgpm init --repo owner/your-boilerplates`

## Best Practices

1. Use `setFrom` for values that inherit from workspace context
2. Use `defaultFrom` for sensible defaults that users can override
3. Keep placeholder names descriptive and consistent
4. Test templates with `--no-tty` to ensure all required fields are defined
