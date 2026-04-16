/**
 * Schema mapping utilities.
 *
 * Builds the schema name mapping between template and tenant,
 * generates pgSettings for tenant-specific search_path, and
 * provides helpers for remapping schema name arrays.
 */

export interface SchemaMapping {
  templateSchemas: string[];
  tenantSchemas: string[];
  map: Record<string, string>;
}

/**
 * Build a schema name map from template schemas to tenant schemas.
 *
 * Both arrays must have the same length and are mapped positionally:
 * templateSchemas[i] → tenantSchemas[i].
 *
 * @param templateSchemas - Schema names from the template instance
 * @param tenantSchemas - Schema names for the target tenant
 * @returns Record mapping template schema name → tenant schema name
 */
export function buildSchemaMap(
  templateSchemas: string[],
  tenantSchemas: string[],
): Record<string, string> {
  if (templateSchemas.length !== tenantSchemas.length) {
    throw new Error(
      `Schema count mismatch: template has ${templateSchemas.length}, tenant has ${tenantSchemas.length}`,
    );
  }

  const map: Record<string, string> = {};
  for (let i = 0; i < templateSchemas.length; i++) {
    if (templateSchemas[i] !== tenantSchemas[i]) {
      map[templateSchemas[i]] = tenantSchemas[i];
    }
  }
  return map;
}

/**
 * Build pgSettings for a tenant, including search_path.
 *
 * @param tenantSchemas - The tenant's schema names
 * @returns pgSettings record suitable for PostGraphile context
 */
export function buildTenantPgSettings(
  tenantSchemas: string[],
): Record<string, string> {
  return {
    search_path: tenantSchemas.join(','),
  };
}

/**
 * Remap schema names from a template prefix to a tenant prefix.
 *
 * Given template schemas like ['t_1_services_public', 't_1_services_private']
 * and prefixes 't_1_' → 't_2_', returns ['t_2_services_public', 't_2_services_private'].
 *
 * @param templateSchemas - Schema names from the template
 * @param templatePrefix - Prefix to replace (e.g., 't_1_')
 * @param tenantPrefix - Replacement prefix (e.g., 't_2_')
 * @returns Remapped schema names
 */
export function remapSchemas(
  templateSchemas: string[],
  templatePrefix: string,
  tenantPrefix: string,
): string[] {
  return templateSchemas.map((s) => {
    if (s.startsWith(templatePrefix)) {
      return tenantPrefix + s.slice(templatePrefix.length);
    }
    return s;
  });
}
