# TSVector Adapter

Full-text search using PostgreSQL's built-in `tsvector` type. Provides keyword search with stemming, weighted ranking, and phrase matching.

## How It Works

The tsvector adapter:
1. **Detects** columns with `tsvector` type on each table
2. **Registers** a `FullText` scalar (via `TsvectorCodecPlugin`) so tsvector columns appear in GraphQL
3. **Adds** a `matches` filter operator on the `FullText` type (via `createMatchesOperatorFactory`)
4. **Generates** `ts_rank()` score as a computed field and orderBy enum

## Adapter Configuration

```typescript
import { createTsvectorAdapter } from 'graphile-search';

createTsvectorAdapter({
  filterPrefix: 'fullText',  // default: 'fullText'
  tsConfig: 'english',       // default: 'english'
})
```

## Generated GraphQL

Given a table with a `search_tsv tsvector` column:

### Filter

```graphql
query {
  allArticles(where: { fullTextSearchTsv: { matches: "postgres tutorial" } }) {
    nodes { ... }
  }
}
```

The `matches` operator uses `websearch_to_tsquery()` internally — supports natural language queries with AND/OR/NOT.

### Score Field

```graphql
type Article {
  searchTsvRank: Float  # ts_rank() score, 0..1, higher = better
}
```

### OrderBy

```graphql
enum ArticlesOrderBy {
  SEARCH_TSV_RANK_ASC
  SEARCH_TSV_RANK_DESC
}
```

## Score Semantics

| Property | Value |
|----------|-------|
| Metric | `rank` |
| Lower is better | No (higher = more relevant) |
| Range | [0, 1] |

## Adapter Flags

| Flag | Value |
|------|-------|
| `isSupplementary` | `false` (primary adapter) |
| `isIntentionalSearch` | `true` (triggers supplementary adapters like trgm) |
| `supportsTextSearch` | `true` (included in unifiedSearch composite filter) |

## Prerequisites

- A `tsvector` column on the table (typically populated via metaschema `full_text_search` triggers)
- A GIN index on the tsvector column (for performance)
- `TsvectorCodecPlugin` loaded (included automatically by `UnifiedSearchPreset`)
