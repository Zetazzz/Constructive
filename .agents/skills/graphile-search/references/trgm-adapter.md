# Trgm Adapter

Fuzzy text matching using the `pg_trgm` extension. Provides typo tolerance, "did you mean?" suggestions, and trigram similarity scoring.

## How It Works

The trgm adapter:
1. **Detects** text/varchar columns on tables (any `text` or `varchar` column is a candidate)
2. **Registers** `TrgmSearchInput` type (`{ value: String!, threshold: Float }`)
3. **Adds** `similarTo` and `wordSimilarTo` operators on `StringTrgmFilter`
4. **Generates** similarity score as a computed field and orderBy enum

## Supplementary Adapter Pattern

Trgm is a **supplementary adapter** — it only activates on tables where at least one "intentional search" adapter (tsvector or BM25) has detected columns. This prevents trgm similarity fields from appearing on every table with text columns.

pgvector alone does NOT trigger trgm activation because it sets `isIntentionalSearch: false`.

### Override with @trgmSearch

Force trgm on tables without intentional search:

```sql
-- Table-level
COMMENT ON TABLE app_public.contacts IS E'@trgmSearch';

-- Column-level
COMMENT ON COLUMN app_public.contacts.name IS E'@trgmSearch';
```

## Adapter Configuration

```typescript
import { createTrgmAdapter } from 'graphile-search';

createTrgmAdapter({
  filterPrefix: 'trgm',              // default: 'trgm'
  defaultThreshold: 0.3,             // default: 0.3
  requireIntentionalSearch: true,     // default: true (makes it supplementary)
})
```

Setting `requireIntentionalSearch: false` makes trgm activate on ALL tables with text columns (not recommended for large schemas).

## Generated GraphQL

Given a table with intentional search (e.g. tsvector) and a `title text` column:

### Filter (Connection Filter)

```graphql
query {
  allArticles(where: {
    title: { similarTo: { value: "postgre", threshold: 0.2 } }
  }) {
    nodes { title }
  }
}
```

```graphql
query {
  allArticles(where: {
    title: { wordSimilarTo: { value: "postgres", threshold: 0.3 } }
  }) {
    nodes { title }
  }
}
```

### Adapter-Level Filter

```graphql
query {
  allArticles(where: {
    trgmTitle: { value: "postgre", threshold: 0.2 }
  }) {
    nodes {
      title
      titleTrgmSimilarity
    }
  }
}
```

### Score Field

```graphql
type Article {
  titleTrgmSimilarity: Float  # pg_trgm similarity() score, 0..1
}
```

### OrderBy

```graphql
enum ArticlesOrderBy {
  TITLE_TRGM_SIMILARITY_ASC
  TITLE_TRGM_SIMILARITY_DESC
}
```

## StringTrgmFilter vs StringFilter

On tables that qualify for trgm, string columns use `StringTrgmFilter` instead of the standard `StringFilter`. This type inherits all standard string operators and adds:

| Operator | SQL | Description |
|----------|-----|-------------|
| `similarTo` | `similarity(col, value) > threshold` | Overall trigram similarity |
| `wordSimilarTo` | `word_similarity(value, col) > threshold` | Best substring similarity |

Both accept `TrgmSearchInput { value: String!, threshold: Float }`. Default threshold is 0.3.

## Score Semantics

| Property | Value |
|----------|-------|
| Metric | `similarity` |
| Lower is better | No (higher = more similar) |
| Range | [0, 1] |

## Adapter Flags

| Flag | Value |
|------|-------|
| `isSupplementary` | `true` (when `requireIntentionalSearch` is true) |
| `isIntentionalSearch` | N/A (supplementary adapters don't set this) |
| `supportsTextSearch` | `true` (included in unifiedSearch composite filter) |

## Prerequisites

- `pg_trgm` extension enabled (pre-enabled in Constructive stack)
- At least one "intentional search" column on the same table (tsvector or BM25), OR `@trgmSearch` smart tag
- For best performance: a GIN trigram index (`gin_trgm_ops`) on text columns you query
