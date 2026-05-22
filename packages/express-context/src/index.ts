/**
 * @constructive-io/express-context
 *
 * Extractable Express middleware for Constructive tenant context.
 *
 * Provides:
 *   - Shared types (ApiStructure, RlsModule, AuthSettings, etc.)
 *   - pgSettings builder (role, JWT claims, request_id, database_id)
 *   - withPgClient (tenant-scoped RLS transaction helper)
 *   - requestId middleware (UUID correlation ID)
 *   - Context middleware (composes all of the above into req.constructive)
 *
 * @example
 * ```typescript
 * import {
 *   createContextMiddleware,
 *   requestIdMiddleware
 * } from '@constructive-io/express-context';
 *
 * app.use(requestIdMiddleware());
 * app.use(apiMiddleware);        // sets req.api (your domain resolver)
 * app.use(authMiddleware);       // sets req.token (your JWT verifier)
 * app.use(createContextMiddleware()); // builds req.constructive
 *
 * app.post('/v1/chat', (req, res) => {
 *   const { withPgClient, pgSettings, userId, databaseId } = req.constructive;
 *   // Full tenant-scoped database access
 * });
 * ```
 */

// Types
export type {
  ApiConfigResult,
  ApiError,
  ApiModule,
  ApiStructure,
  AuthSettings,
  ConstructiveAPIToken,
  ConstructiveContext,
  CorsModuleData,
  DatabaseSettings,
  GenericModuleData,
  PublicKeyChallengeData,
  PubkeyChallengeSettings,
  RlsModule,
  WebauthnSettings,
  WithPgClient,
} from './types';

// pgSettings builder
export type { PgSettingsInput } from './pg-settings';
export { buildPgSettings } from './pg-settings';

// withPgClient helper
export { withPgClient } from './pg-client';

// Request ID middleware
export { requestIdMiddleware } from './request-id';

// Context middleware
export type { ContextMiddlewareOptions } from './context';
export { buildContext, createContextMiddleware } from './context';

// Side-effect: Express type augmentation
import './types';
