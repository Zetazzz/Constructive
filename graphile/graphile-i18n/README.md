# graphile-i18n

<p align="center" width="100%">
  <img height="250" src="https://raw.githubusercontent.com/constructive-io/constructive/refs/heads/main/assets/outline-logo.svg" />
</p>

<p align="center" width="100%">
  <a href="https://github.com/constructive-io/constructive/actions/workflows/run-tests.yaml">
    <img height="20" src="https://github.com/constructive-io/constructive/actions/workflows/run-tests.yaml/badge.svg" />
  </a>
   <a href="https://github.com/constructive-io/constructive/blob/main/LICENSE"><img height="20" src="https://img.shields.io/badge/license-MIT-blue.svg"/></a>
   <a href="https://www.npmjs.com/package/graphile-i18n"><img height="20" src="https://img.shields.io/github/package-json/v/constructive-io/constructive?filename=graphile%2Fgraphile-i18n%2Fpackage.json"/></a>
</p>

PostGraphile v5 i18n plugin — language-aware fields sourced from `@i18n` translation tables with Accept-Language negotiation and configurable fallback chains.

## Overview

`graphile-i18n` auto-discovers tables tagged with the `@i18n` smart comment, finds the companion translation table, and injects a `localeStrings` field on the base type. The field resolves the best-matching translation row based on the GraphQL context's language codes, falling back to the base table's own values when no translation exists.

## Usage

```typescript
import { I18nPreset } from 'graphile-i18n';

const preset = {
  extends: [
    I18nPreset(),
  ],
};
```

### Custom configuration

```typescript
import { I18nPreset } from 'graphile-i18n';

const preset = {
  extends: [
    I18nPreset({
      defaultLanguages: ['en', 'es'],
      langCodeColumn: 'lang_code',
      allowedTypes: ['text', 'citext'],
    }),
  ],
};
```

### Accept-Language middleware

For production use with Express/PostGraphile, add the Accept-Language context builder:

```typescript
import { I18nPreset, makeI18nContext } from 'graphile-i18n';

const preset = {
  extends: [I18nPreset()],
  grafast: {
    context: makeI18nContext({
      supportedLanguages: ['en', 'es', 'fr'],
    }),
  },
};
```

## Database Setup

Tag the base table with a `@i18n` smart comment pointing to its translation table:

```sql
COMMENT ON TABLE app_public.posts IS E'@i18n posts_translations';
```

The translation table must have:
- A FK column referencing the base table's PK (convention: `{table}_id`)
- A `lang_code` text column (configurable)
- A `UNIQUE(fk_column, lang_code)` constraint
- One or more `text`/`citext` columns matching translatable base columns

```sql
CREATE TABLE app_public.posts_translations (
  id serial PRIMARY KEY,
  post_id int NOT NULL REFERENCES app_public.posts(id) ON DELETE CASCADE,
  lang_code text NOT NULL,
  title text NOT NULL,
  body text,
  UNIQUE (post_id, lang_code)
);
```

## GraphQL API

Once configured, every tagged table gets a `localeStrings` field:

```graphql
query {
  allPosts {
    nodes {
      title          # original base value
      localeStrings {
        langCode     # matched language code (null if no translation)
        title        # translated or base fallback
        body         # translated or base fallback
      }
    }
  }
}
```

### Language selection

Pass `langCodes` in the GraphQL context (automatically handled by `makeI18nContext` or set manually in tests):

```graphql
# With context: { langCodes: ['es'] }
query {
  postByRowId(rowId: 1) {
    localeStrings {
      langCode  # "es"
      title     # "Hola Mundo"
    }
  }
}
```

When the requested language has no translation, the plugin falls back through the `langCodes` array. If no match is found, base table values are returned with `langCode: null`.

## Features

- **Smart tag discovery**: Auto-detects `@i18n` tagged tables and their translation companions
- **Grafast-native resolution**: Uses `lambda` + `object` steps for proper v5 execution
- **Accept-Language negotiation**: Built-in middleware parses headers and injects context
- **Fallback chain**: Tries each language in order, falls back to base table values
- **Convention-based FK**: Discovers FK by `{table}_id` convention or type matching
- **Type-safe**: Full TypeScript types for options, registry, and field mappings

## Options

| Option | Default | Description |
|--------|---------|-------------|
| `langCodeColumn` | `'lang_code'` | Column name on translation table storing the language code |
| `langCodeGqlField` | `'langCode'` | GraphQL field name for the language code in the locale object |
| `allowedTypes` | `['text', 'citext']` | PostgreSQL column types eligible for translation |
| `defaultLanguages` | `['en']` | Fallback languages when no context is provided |

## Constructive Integration

When used with the Constructive framework, the `DataI18n` node type automates translation table creation:

```json
{
  "nodes": [
    {
      "$type": "DataI18n",
      "data": { "fields": ["name", "description"] }
    }
  ]
}
```

The `i18n_module` provides app-level configuration via `app_settings_i18n` with supported languages, default language, and fallback chain — all manageable via GraphQL mutations.
