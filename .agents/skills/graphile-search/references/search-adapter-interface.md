# SearchAdapter Interface

The `SearchAdapter` interface is the contract each search algorithm implements to plug into the unified search plugin.

## Interface Definition

```typescript
interface SearchAdapter {
  /** Unique identifier (e.g. 'tsv', 'bm25', 'trgm', 'vector') */
  name: string;

  /** Score semantics for normalization */
  scoreSemantics: ScoreSemantics;

  /**
   * When true, only activates on tables that already have at least one
   * column detected by an adapter whose isIntentionalSearch is true.
   * Prevents trgm from adding fields to every table with text columns.
   * @default false
   */
  isSupplementary?: boolean;

  /**
   * When true, this adapter's presence triggers supplementary adapters.
   * tsvector and BM25 set this to true. pgvector sets this to false
   * (embeddings are not text search).
   * @default true
   */
  isIntentionalSearch?: boolean;

  /** Filter prefix for connection filter field names (e.g. 'bm25' -> bm25Body) */
  filterPrefix: string;

  /**
   * Whether this adapter supports plain text queries.
   * If true, columns are included in the unifiedSearch composite filter.
   * pgvector sets this to false (requires vector input, not text).
   * @default false
   */
  supportsTextSearch?: boolean;

  /** Detect searchable columns on a given codec/table */
  detectColumns(codec: PgCodecWithAttributes, build: any): SearchableColumn[];

  /** Register any custom GraphQL types during the init hook */
  registerTypes(build: any): void;

  /** Apply a filter and return the SQL expression + score select index */
  applyFilter(args: FilterApplyArgs): FilterApplyResult | null;

  /** Build a text search input value from a plain text query (for unifiedSearch) */
  buildTextSearchInput?(text: string): unknown;
}
```

## ScoreSemantics

```typescript
interface ScoreSemantics {
  /** Metric name for field naming (e.g. 'rank', 'score', 'similarity', 'distance') */
  metric: string;

  /** If true, lower values are better (BM25, pgvector distance) */
  lowerIsBetter: boolean;

  /**
   * Known range bounds for normalization, or null if unbounded.
   * - trgm: [0, 1]
   * - tsvector: [0, 1]
   * - BM25: null (unbounded negative)
   * - pgvector: null (0 to infinity)
   */
  range: [number, number] | null;
}
```

## SearchableColumn

```typescript
interface SearchableColumn {
  /** The raw PostgreSQL column name (e.g. 'body', 'tsv', 'embedding') */
  attributeName: string;

  /** Optional extra data the adapter needs during SQL generation */
  adapterData?: unknown;
}
```

## Creating a Custom Adapter

```typescript
import type { SearchAdapter } from 'graphile-search';

function createMyAdapter(): SearchAdapter {
  return {
    name: 'myalgo',
    scoreSemantics: {
      metric: 'relevance',
      lowerIsBetter: false,
      range: [0, 1],
    },
    filterPrefix: 'myalgo',
    supportsTextSearch: true,

    detectColumns(codec, build) {
      // Return columns that have your search infrastructure
      return [];
    },

    registerTypes(build) {
      // Register any custom GraphQL input types
    },

    applyFilter(args) {
      // Generate SQL WHERE clause and score expression
      return null;
    },

    buildTextSearchInput(text) {
      return { query: text };
    },
  };
}
```

Then register it:

```typescript
import { createUnifiedSearchPlugin } from 'graphile-search';

const plugin = createUnifiedSearchPlugin({
  adapters: [createMyAdapter()],
});
```
