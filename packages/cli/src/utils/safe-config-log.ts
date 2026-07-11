import type { ConstructiveOptions } from '@constructive-io/graphql-types';

/** Select only configuration fields that are safe to emit in debug logs. */
export const getSafeConfigForLog = (options: ConstructiveOptions) => ({
  pg: options.pg && {
    host: options.pg.host,
    port: options.pg.port,
    user: options.pg.user,
    database: options.pg.database,
  },
  server: options.server,
  graphile: options.graphile && { schema: options.graphile.schema },
  features: options.features,
  api: options.api,
  deployment: options.deployment,
  migrations: options.migrations,
  runtime: options.runtime && {
    nodeEnv: options.runtime.nodeEnv,
    port: options.runtime.port,
  },
  observability: options.observability && {
    enabled: options.observability.enabled,
    debugSamplerEnabled: options.observability.debugSamplerEnabled,
  },
});
