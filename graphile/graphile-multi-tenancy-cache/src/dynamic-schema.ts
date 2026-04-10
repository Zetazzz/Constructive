/**
 * Dynamic Schema Resolution
 *
 * The "Placeholder" Pattern: allows a shared PgRegistry to execute against
 * different physical schemas by leveraging crystal-level hooks:
 *
 * 1. `pgIdentifiers: "dynamic"` in PgBasicsPlugin wraps schema names in
 *    opaque placeholders during the gather/build phase.
 *
 * 2. `PgExecutorContext.sqlTextTransform` replaces those placeholders with
 *    real tenant schema names at execution time, per-request.
 *
 * This approach handles the multi-schema case correctly — even when
 * different schemas contain tables with the same name (e.g., both
 * `t_1_app.users` and `t_1_perf.users`), the fully qualified identifiers
 * are preserved and remapped independently.
 *
 * NOTE: The placeholder format and core transform logic live in the
 * Crystal-mimic shim at `./compat/crystal/multiTenancy`.  Once the
 * Crystal PR is published, that shim will be replaced with a direct
 * re-export from `graphile-build-pg`.
 */

import { Logger } from '@pgpmjs/logger';
import { escapeSqlIdentifier } from 'pg-sql2';

// ---------------------------------------------------------------------------
// Re-export Crystal-mimic shim — single source of truth for placeholder
// encoding and SQL text transformation.
// ---------------------------------------------------------------------------

export {
  buildSchemaRemapTransform,
  extractOriginalName,
  extractTemplateSchemaNames,
  isSchemaPlaceholder,
  wrapSchemaPlaceholder
} from './compat/crystal/multiTenancy';

const log = new Logger('multi-tenancy-cache:dynamic-schema');

// ---------------------------------------------------------------------------
// Constructive-specific helpers
// ---------------------------------------------------------------------------

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

  // Set the search_path to include all tenant schemas.
  // Use pg-sql2's escapeSqlIdentifier to properly handle schema names
  // that contain special characters (e.g., double quotes).
  if (tenantSchemas.length > 0) {
    settings['search_path'] = tenantSchemas
      .map((s) => escapeSqlIdentifier(s))
      .join(', ');
  }

  return settings;
}

/**
 * Rewrite schema names in an array of schema strings.
 * Maps template schema names to tenant schema names using a prefix replacement.
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
 * Both arrays must have the same length — a mismatch indicates a bug in
 * the caller (e.g., schemas were reordered or some were omitted).  A
 * warning is logged and extra template schemas are left unmapped.
 *
 * @param templateSchemas - The schema names used when building the template
 * @param tenantSchemas - The tenant's actual schema names (same order)
 * @returns Record mapping template schema name -> tenant schema name
 */
export function buildSchemaMap(
  templateSchemas: string[],
  tenantSchemas: string[],
): Record<string, string> {
  if (templateSchemas.length !== tenantSchemas.length) {
    log.warn(
      `Schema count mismatch: template has ${templateSchemas.length} schemas ` +
      `[${templateSchemas.join(', ')}] but tenant has ${tenantSchemas.length} ` +
      `[${tenantSchemas.join(', ')}]. Unmapped schemas will retain placeholder names.`,
    );
  }

  const map: Record<string, string> = {};
  for (let i = 0; i < templateSchemas.length; i++) {
    if (i < tenantSchemas.length) {
      map[templateSchemas[i]] = tenantSchemas[i];
    }
  }
  return map;
}
