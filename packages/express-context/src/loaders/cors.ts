/**
 * CORS Origins Loader
 *
 * Resolves allowed CORS origins for a database+API combination.
 * Checks per-API settings first, falls back to database-level default,
 * then to the legacy api_modules approach.
 */

import type { LoaderContext, ModuleLoader } from './types';
import { createModuleLoader } from './create-loader';

// ─── SQL ────────────────────────────────────────────────────────────────────

const CORS_SETTINGS_SQL = `
  SELECT allowed_origins
  FROM services_public.cors_settings
  WHERE database_id = $1 AND api_id = $2
  LIMIT 1
`;

const CORS_SETTINGS_DB_DEFAULT_SQL = `
  SELECT allowed_origins
  FROM services_public.cors_settings
  WHERE database_id = $1 AND api_id IS NULL
  LIMIT 1
`;

const CORS_MODULE_SQL = `
  SELECT data
  FROM services_public.api_modules
  WHERE api_id = $1 AND name = 'cors'
  LIMIT 1
`;

// ─── Row Types ──────────────────────────────────────────────────────────────

interface CorsSettingsRow {
  allowed_origins: string[];
}

interface CorsModuleRow {
  data: { urls: string[] } | null;
}

// ─── Loader ─────────────────────────────────────────────────────────────────

export const corsLoader: ModuleLoader<string[]> = createModuleLoader<string[]>({
  name: 'corsOrigins',
  ttlMs: 5 * 60_000,
  async resolve(ctx: LoaderContext) {
    const { servicesPool, databaseId, apiId } = ctx;

    // Try per-API cors_settings first
    try {
      if (apiId) {
        const perApi = await servicesPool.query<CorsSettingsRow>(CORS_SETTINGS_SQL, [databaseId, apiId]);
        if (perApi.rows[0]) return perApi.rows[0].allowed_origins;
      }
      const dbDefault = await servicesPool.query<CorsSettingsRow>(CORS_SETTINGS_DB_DEFAULT_SQL, [databaseId]);
      if (dbDefault.rows[0]) return dbDefault.rows[0].allowed_origins;
    } catch {
      // Table may not exist yet
    }

    // Fall back to legacy api_modules
    if (apiId) {
      const result = await servicesPool.query<CorsModuleRow>(CORS_MODULE_SQL, [apiId]);
      return result.rows[0]?.data?.urls;
    }

    return undefined;
  },
});
