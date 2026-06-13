/**
 * agentic-server — Standalone Express LLM service
 *
 * Express-only equivalent of graphile-llm: agent threads, chat streaming,
 * billing metering, and inference logging. Uses @constructive-io/express-context
 * for tenant-scoped database access.
 *
 * @example
 * ```typescript
 * import express from 'express';
 * import { createContextMiddleware } from '@constructive-io/express-context';
 * import { createAgenticRouter } from 'agentic-server';
 *
 * const app = express();
 * app.use(createContextMiddleware());
 * app.use(createAgenticRouter());
 * app.listen(3001);
 * ```
 */

export { TtlCache } from './cache';
export type {
  AgentDiscovery,
  AgentTableInfo,
  BillingConfig,
  DatabaseConfig,
  InferenceLogConfig
} from './discovery';
export { clearAgentCache, clearConfigCache,getAgentDiscovery, getDatabaseConfig } from './discovery';
export type { EnvOptions, ProviderConfig } from './env';
export { getEnvOptions } from './env';
export { createAgenticRouter } from './router';

// Re-export billing client from express-context for convenience
export type { BillingClient, InferenceLogEntry } from '@constructive-io/express-context';
