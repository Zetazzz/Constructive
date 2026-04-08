/**
 * Dynamic Schema Resolution
 *
 * The "Placeholder" Pattern: allows a shared PgRegistry to execute against
 * different physical schemas by overriding the SQL identifier generation.
 *
 * Instead of returning a static `sql.identifier(schemaName, tableName)`,
 * the identifier helper returns a dynamic SQL fragment that resolves the
 * physical schema name at execution time from the GraphQL context.
 *
 * This is the key mechanism that makes template-based multi-tenancy work:
 * - Build phase: One PgRegistry is built using a "template" schema
 * - Execution phase: The SQL identifier is rewritten to point to the actual
 *   tenant's physical schema, read from `context.pgSettings['tenantSchema']`
 *   or similar.
 */

import { Logger } from '@pgpmjs/logger';
import type { SQL } from 'pg-sql2';
import sql from 'pg-sql2';

const log = new Logger('multi-tenancy-cache:dynamic-schema');

/**
 * Context key used to pass the tenant's physical schema name at runtime.
 * This should be set in the Grafast context callback from the request.
 */
export const TENANT_SCHEMA_CONTEXT_KEY = 'tenantSchema';

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
 * Create a dynamic SQL identifier that resolves the schema name at runtime.
 *
 * This replaces the static `sql.identifier(schema, table)` with a fragment
 * that uses `current_setting()` to read the tenant schema from the session.
 *
 * The PostgreSQL session variable is set via `SET LOCAL "tenantSchema" = 'xxx'`
 * in the pgSettings of the Grafast context.
 *
 * @param templateSchema - The template schema name used during build
 * @param tableName - The table/view/function name
 * @param schemaMappings - Optional explicit mappings for multi-schema tenants
 * @returns SQL fragment that resolves dynamically
 */
export function dynamicIdentifier(
  templateSchema: string,
  tableName: string,
  schemaMappings?: SchemaMapping[],
): SQL {
  // If explicit mappings are provided, use the mapped schema
  // Otherwise, use the single tenant schema from session settings
  if (schemaMappings && schemaMappings.length > 0) {
    const mapping = schemaMappings.find((m) => m.templateSchema === templateSchema);
    if (mapping) {
      // Use the mapped tenant schema
      return sql.fragment`${sql.identifier(mapping.tenantSchema)}.${sql.identifier(tableName)}`;
    }
  }

  // Default: use current_setting to resolve at runtime
  // This reads the 'tenantSchema' session variable set via pgSettings
  return sql.fragment`(current_setting(${sql.literal(`app.${TENANT_SCHEMA_CONTEXT_KEY}`)})::text || '.' || ${sql.literal(tableName)})::regclass`;
}

/**
 * Create a static identifier with a specific schema override.
 * Used when the tenant schema is known at handler-creation time.
 *
 * This is the simpler approach: instead of runtime resolution via
 * current_setting(), we just rewrite the identifiers when creating
 * the per-tenant handler.
 *
 * @param schemaName - The tenant's physical schema name
 * @param tableName - The table/view/function name
 * @returns SQL fragment with the tenant's schema
 */
export function staticSchemaIdentifier(
  schemaName: string,
  tableName: string,
): SQL {
  return sql.fragment`${sql.identifier(schemaName)}.${sql.identifier(tableName)}`;
}

/**
 * Build pgSettings that inject the tenant schema into the PostgreSQL session.
 * These settings are merged into the Grafast context's pgSettings.
 *
 * @param tenantSchemas - The tenant's schema names (maps from template schemas)
 * @returns pgSettings object with tenant schema session variables
 */
export function buildTenantPgSettings(
  tenantSchemas: string[],
): Record<string, string> {
  const settings: Record<string, string> = {};

  // Set the primary tenant schema
  if (tenantSchemas.length > 0) {
    settings[`app.${TENANT_SCHEMA_CONTEXT_KEY}`] = tenantSchemas[0];
  }

  // Set the search_path to include all tenant schemas
  settings['search_path'] = tenantSchemas.map((s) => `"${s}"`).join(', ');

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
