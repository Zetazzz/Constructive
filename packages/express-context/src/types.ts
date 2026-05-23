/**
 * Shared types for Constructive Express middleware.
 *
 * These types describe the resolved API structure, RLS module, auth settings,
 * database feature flags, and other config that middleware attaches to the
 * Express request. Extracted from graphql/server so any Express-based service
 * (PostGraphile, LLM sidecar, etc.) can share the same context.
 */

import type { Pool, PoolClient } from 'pg';

// ─── API Structure ──────────────────────────────────────────────────────────

export interface CorsModuleData {
  urls: string[];
}

export interface PublicKeyChallengeData {
  schema: string;
  crypto_network: string;
  sign_up_with_key: string;
  sign_in_request_challenge: string;
  sign_in_record_failure: string;
  sign_in_with_challenge: string;
}

export interface GenericModuleData {
  [key: string]: unknown;
}

export interface DatabaseSettings {
  enableAggregates: boolean;
  enablePostgis: boolean;
  enableSearch: boolean;
  enableDirectUploads: boolean;
  enablePresignedUploads: boolean;
  enableManyToMany: boolean;
  enableConnectionFilter: boolean;
  enableLtree: boolean;
  enableLlm: boolean;
  enableRealtime: boolean;
  enableBulk: boolean;
}

export interface PubkeyChallengeSettings {
  schema: string;
  cryptoNetwork: string;
  signUpWithKey: string;
  signInRequestChallenge: string;
  signInRecordFailure: string;
  signInWithChallenge: string;
}

export interface WebauthnSettings {
  schema: string;
  credentialsSchema: string;
  sessionsSchema: string;
  sessionSecretsSchema: string;
  rpId: string;
  rpName: string;
  originAllowlist: string[];
  attestationType: string;
  requireUserVerification: boolean;
  residentKey: string;
  challengeExpirySeconds: number;
}

export type ApiModule =
  | { name: 'cors'; data: CorsModuleData }
  | { name: 'pubkey_challenge'; data: PublicKeyChallengeData }
  | { name: string; data?: GenericModuleData };

export interface RlsModule {
  authenticate: string;
  authenticateStrict: string;
  privateSchema: {
    schemaName: string;
  };
  publicSchema: {
    schemaName: string;
  };
  currentRole: string;
  currentRoleId: string;
  currentIpAddress: string;
  currentUserAgent: string;
}

export interface AuthSettings {
  cookieSecure?: boolean;
  cookieSamesite?: string;
  cookieDomain?: string | null;
  cookieHttponly?: boolean;
  cookieMaxAge?: string | null;
  cookiePath?: string;
  rememberMeDuration?: string | null;
  enableCaptcha?: boolean;
  captchaSiteKey?: string | null;
}

export interface ApiStructure {
  apiId?: string;
  dbname: string;
  anonRole: string;
  roleName: string;
  schema: string[];
  apiModules: ApiModule[];
  rlsModule?: RlsModule;
  domains?: string[];
  databaseId?: string;
  isPublic?: boolean;
  authSettings?: AuthSettings;
  corsOrigins?: string[];
  databaseSettings?: DatabaseSettings;
  pubkeyChallengeSettings?: PubkeyChallengeSettings;
  webauthnSettings?: WebauthnSettings;
}

export type ApiError = { errorHtml: string };
export type ApiConfigResult = ApiStructure | ApiError | null;

// ─── Auth Token ─────────────────────────────────────────────────────────────

export type ConstructiveAPIToken = {
  id?: string;
  user_id?: string;
  session_id?: string;
  access_level?: string;
  kind?: string;
  [key: string]: unknown;
};

// ─── Constructive Context ───────────────────────────────────────────────────

/**
 * Callback for executing queries within a tenant-scoped transaction
 * with proper pgSettings (role, claims, request_id).
 */
export type WithPgClient = <T>(
  fn: (client: PoolClient) => Promise<T>,
) => Promise<T>;

/**
 * The full tenant context attached to `req.constructive` by the middleware.
 * Any Express-based service can use this to interact with the tenant database.
 */
export interface ConstructiveContext {
  /** Resolved API structure (database, schemas, RLS, feature flags) */
  api: ApiStructure;
  /** Authenticated token (null for anonymous requests) */
  token: ConstructiveAPIToken | null;
  /** pgSettings for SET LOCAL in tenant transactions */
  pgSettings: Record<string, string>;
  /** Database UUID from the API resolver */
  databaseId: string | null;
  /** Authenticated user ID from the JWT token */
  userId: string | null;
  /** Per-request correlation ID for distributed tracing */
  requestId: string;
  /** Tenant database connection pool */
  pool: Pool;
  /** Execute a function within a tenant-scoped RLS transaction */
  withPgClient: WithPgClient;
}

// ─── Express Augmentation ───────────────────────────────────────────────────

declare global {
  namespace Express {
    interface Request {
      api?: ApiStructure;
      clientIp?: string;
      requestId?: string;
      token?: ConstructiveAPIToken;
      constructive?: ConstructiveContext;
    }
  }
}
