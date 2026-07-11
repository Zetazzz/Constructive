# @constructive-io/graphql-types

<p align="center" width="100%">
  <img height="250" src="https://raw.githubusercontent.com/constructive-io/constructive/refs/heads/main/assets/outline-logo.svg" />
</p>

<p align="center" width="100%">
  <a href="https://github.com/constructive-io/constructive/actions/workflows/run-tests.yaml">
    <img height="20" src="https://github.com/constructive-io/constructive/actions/workflows/run-tests.yaml/badge.svg" />
  </a>
   <a href="https://github.com/constructive-io/constructive/blob/main/LICENSE"><img height="20" src="https://img.shields.io/badge/license-MIT-blue.svg"/></a>
   <a href="https://www.npmjs.com/package/@constructive-io/graphql-types"><img height="20" src="https://img.shields.io/github/package-json/v/constructive-io/constructive?filename=graphql%2Ftypes%2Fpackage.json"/></a>
</p>

GraphQL/Graphile types for the Constructive framework.

This package contains the complete typed Constructive configuration surface: PGPM composition, GraphQL/Graphile, HTTP server, storage, jobs, SMTP/Mailgun, functions, runtime switches, observability, codegen, and LLM settings.

## Installation

```bash
npm install @constructive-io/graphql-types
```

## Usage

```typescript
import { 
  ConstructiveOptions, 
  GraphileOptions, 
  ApiOptions, 
  GraphileFeatureOptions,
  constructiveDefaults 
} from '@constructive-io/graphql-types';

// ConstructiveOptions extends PgpmOptions with GraphQL configuration
const config: ConstructiveOptions = {
  graphile: {
    schema: ['public', 'app_public'],
    appendPlugins: [],
  },
  api: {
    enableServicesApi: true,
    exposedSchemas: ['public'],
  },
  features: {
    simpleInflection: true,
    postgis: true,
  },
  server: {
    host: 'localhost',
    port: 3000,
  },
};
```

## Types

### ConstructiveOptions

Full configuration options for Constructive framework, extending `PgpmOptions` with GraphQL/Graphile configuration.

### GraphileOptions

PostGraphile/Graphile configuration including schema, plugins, and build options.

### ApiOptions

Configuration for the Constructive API including meta API settings, exposed schemas, and role configuration.

### GraphileFeatureOptions

Feature flags for GraphQL/Graphile including inflection settings and PostGIS support.

The aggregate extends core `PgpmOptions`, but PGPM itself does not own GraphQL server, storage, jobs, email, functions, or provider configuration. Those types and defaults live here so `@constructive-io/graphql-env` can remain the single Constructive resolver without introducing additional env packages.
