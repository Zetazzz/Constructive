/**
 * Dynamic Schema Resolution
 *
 * The "Placeholder" Pattern: allows a shared PgRegistry to execute against
 * different physical schemas by leveraging crystal-level hooks:
 *
 * 1. `pgIdentifiers: "dynamic"` in PgBasicsPlugin wraps schema names in
 *    `__pgmt_<schemaName>__` placeholders during the gather/build phase.
 *
 * 2. `PgExecutorContext.sqlTextTransform` replaces those placeholders with
 *    real tenant schema names at execution time, per-request.
 *
 * This approach handles the multi-schema case correctly — even when
 * different schemas contain tables with the same name (e.g., both
 * `t_1_app.users` and `t_1_perf.users`), the fully qualified identifiers
 * are preserved and remapped independently.
 */

import { Logger } from '@pgpmjs/logger';

const log = new Logger('multi-tenancy-cache:dynamic-schema');

/**
 * The prefix used by PgBasicsPlugin's "dynamic" mode to wrap schema names.
 * Must match the crystal-level PGMT_PREFIX constant.
 */
export const PGMT_PREFIX = '__pgmt_';

/**
 * The suffix used by PgBasicsPlugin's "dynamic" mode to wrap schema names.
 * Must match the crystal-level PGMT_SUFFIX constant.
 */
export const PGMT_SUFFIX = '__';

/**
 * Context key used to pass the tenant's schema mapping at runtime.
 * This should be set in the Grafast context callback from the request.
 */
export const TENANT_SCHEMA_CONTEXT_KEY = 'tenantSchemaMap';

/**
 * Schema mapping: maps template schema names to tenant schema names.
 * Used when a tenant has multiple schemas that need to be remapped.
 */
export interface SchemaMapping {
  /** Template schema name (e.g., 'tenant_template_public') */
  templateSchema: string;
  /** Tenant's actual schema name (e.g., 'tenant_abc_public') */
  tenantSchema: string;
}

/**
 * Build a `sqlTextTransform` function that replaces dynamic schema
 * placeholders in compiled SQL with real tenant schema names.
 *
 * When `pgIdentifiers: "dynamic"` is used, the compiled SQL contains
 * identifiers like `"__pgmt_app_public__"."users"`. This transform
 * replaces `"__pgmt_app_public__"` with `"tenant_42_public"`.
 *
 * @param schemaMap - A mapping from template schema names to real
 *   tenant schema names. E.g. `{ app_public: 'tenant_42_public' }`.
 * @returns A function suitable for `PgExecutorContext.sqlTextTransform`.
 */
export function buildSchemaRemapTransform(
  schemaMap: Record<string, string>,
): (text: string) => string {
  const entries = Object.entries(schemaMap);
  if (entries.length === 0) {
    return (text: string) => text;
  }

  // Pre-compute the search/replace pairs for efficiency.
  // In compiled SQL, the placeholder appears as a quoted identifier:
  //   "__pgmt_original_schema__"
  // We replace it with the quoted real schema name:
  //   "real_schema"
  const replacements: Array<[search: string, replace: string]> = entries.map(
    ([templateSchema, realSchema]) => [
      `"${PGMT_PREFIX}${templateSchema}${PGMT_SUFFIX}"`,
      `"${realSchema}"`,
    ],
  );

  return (text: string): string => {
    let result = text;
    for (let i = 0, l = replacements.length; i < l; i++) {
      const [search, replace] = replacements[i];
      // Use split+join for global replacement (avoids regex escaping issues)
      result = result.split(search).join(replace);
    }
    return result;
  };
}

/**
 * Build pgSettings that inject the tenant schema into the PostgreSQL session.
 * These settings are merged into the Grafast context's pgSettings.
 *
 * Also sets `search_path` to include all tenant schemas for functions
 * or queries that may use unqualified names internally.
 *
 * @param tenantSchemas - The tenant's schema names
 * @returns pgSettings object with tenant schema session variables
 */
export function buildTenantPgSettings(
  tenantSchemas: string[],
): Record<string, string> {
  const settings: Record<string, string> = {};

  // Set the search_path to include all tenant schemas
  if (tenantSchemas.length > 0) {
    settings['search_path'] = tenantSchemas.map((s) => `"${s}"`).join(', ');
  }

  return settings;
}

/**
 * Rewrite schema names in an array of schema strings.
 * Maps template schema names to tenant schema names using a prefix replacement.
 *
 * Example:
 *   templateSchemas: ['template_public', 'template_private']
 *   templatePrefix: 'template'
 *   tenantPrefix: 'tenant_abc'
 *   Result: ['tenant_abc_public', 'tenant_abc_private']
 *
 * @param templateSchemas - The template's schema names
 * @param templatePrefix - The prefix in template schema names
 * @param tenantPrefix - The tenant's prefix to substitute
 * @returns Remapped schema names for the tenant
 */
export function remapSchemas(
  templateSchemas: string[],
  templatePrefix: string,
  tenantPrefix: string,
): string[] {
  return templateSchemas.map((schema) => {
    if (schema.startsWith(templatePrefix)) {
      return tenantPrefix + schema.substring(templatePrefix.length);
    }
    return schema;
  });
}

/**
 * Build a schema-name mapping from template schemas to tenant schemas.
 *
 * @param templateSchemas - The schema names used when building the template
 * @param tenantSchemas - The tenant's actual schema names (same order)
 * @returns Record mapping template schema name -> tenant schema name
 */
export function buildSchemaMap(
  templateSchemas: string[],
  tenantSchemas: string[],
): Record<string, string> {
  const map: Record<string, string> = {};
  for (let i = 0; i < templateSchemas.length; i++) {
    if (i < tenantSchemas.length) {
      map[templateSchemas[i]] = tenantSchemas[i];
    }
  }
  return map;
}
