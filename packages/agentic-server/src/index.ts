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

export { createAgenticRouter } from './router';
export { getEnvOptions } from './env';
export type { EnvOptions, ProviderConfig } from './env';
export { getAgentDiscovery, getDatabaseConfig, clearAgentCache, clearConfigCache } from './discovery';
export type {
  AgentDiscovery,
  AgentTableInfo,
  BillingConfig,
  DatabaseConfig,
  InferenceLogConfig,
} from './discovery';
export { checkQuota, recordUsage, logInference } from './billing';
export type { InferenceLogEntry } from './billing';
export { TtlCache } from './cache';
