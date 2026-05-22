import type { PgpmOptions } from '@pgpmjs/types';
import type { ApiOptions as ApiConfig } from '@constructive-io/graphql-types';

// Re-export all shared types from the express-context package.
// This preserves backwards compatibility for existing imports.
export type {
  ApiConfigResult,
  ApiError,
  ApiModule,
  ApiStructure,
  AuthSettings,
  CorsModuleData,
  DatabaseSettings,
  GenericModuleData,
  PublicKeyChallengeData,
  PubkeyChallengeSettings,
  RlsModule,
  WebauthnSettings,
} from '@constructive-io/express-context';

// ApiOptions is local — it couples to @constructive-io/graphql-types
export type ApiOptions = PgpmOptions & { api?: ApiConfig };
