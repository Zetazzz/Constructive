# graphile-pg-aggregates

<p align="center" width="100%">
  <img height="250" src="https://raw.githubusercontent.com/constructive-io/constructive/refs/heads/main/assets/outline-logo.svg" />
</p>

<p align="center" width="100%">
  <a href="https://github.com/constructive-io/constructive/actions/workflows/run-tests.yaml">
    <img height="20" src="https://github.com/constructive-io/constructive/actions/workflows/run-tests.yaml/badge.svg" />
  </a>
   <a href="https://github.com/constructive-io/constructive/blob/main/LICENSE"><img height="20" src="https://img.shields.io/badge/license-MIT-blue.svg"/></a>
   <a href="https://www.npmjs.com/package/graphile-pg-aggregates"><img height="20" src="https://img.shields.io/github/package-json/v/constructive-io/constructive?filename=graphile%2Fgraphile-pg-aggregates%2Fpackage.json"/></a>
</p>

PostGraphile v5 aggregate plugin for the Constructive monorepo.

Adds aggregate support to PostGraphile connections:

- **Aggregates:** `sum`, `avg`, `min`, `max`, `stddevSample`, `stddevPopulation`, `varianceSample`, `variancePopulation`, `distinctCount`
- **Grouped aggregates:** `groupedAggregates(groupBy: [...], having: {...})` on connections
- **Order by aggregates:** Order parent connections by aggregates on related tables
- **Filter by aggregates:** Filter parent connections by aggregate values on related tables (via connection-filter integration)
- **Custom aggregates:** Register your own aggregate functions via the `pgAggregateSpecs` build extension
- **Smart tags:** `@behavior -aggregates` to disable per-table

> **Origin:** Forked from [`@graphile/pg-aggregates`](https://github.com/graphile/pg-aggregates) (v5 branch) by Benjie Gillam. Adapted for the Constructive connection-filter fork and build system.

## Usage

```typescript
import { PgAggregatesPreset } from 'graphile-pg-aggregates';

const preset: GraphileConfig.Preset = {
  extends: [
    PgAggregatesPreset,
  ],
};
```

Or via the `ConstructivePreset` which includes it automatically:

```typescript
import { ConstructivePreset } from 'graphile-settings';
```

## Example Query

```graphql
{
  allOrders {
    aggregates {
      sum { total }
      avg { total }
      distinctCount { status }
    }
    groupedAggregates(groupBy: [STATUS]) {
      keys
      sum { total }
    }
  }
}
```

## Per-Table Opt-Out

Disable aggregates on a specific table via smart tags:

```sql
COMMENT ON TABLE my_table IS E'@behavior -aggregates';
```
