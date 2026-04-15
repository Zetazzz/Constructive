/**
 * Multi-tenancy utilities for dynamic schema resolution.
 *
 * ## Wrapper Approach (no Crystal changes required)
 *
 * Schema names in compiled SQL are real qualified identifiers (e.g.,
 * `"t_1_services_public"."apis"`).  The `buildSchemaRemapTransform`
 * function builds a single-pass regex that replaces template schema
 * names with the real tenant schema names.
 *
 * The transform is injected per-request by `PgMultiTenancyWrapperPlugin`,
 * which wraps `client.query()` to apply the replacement before SQL
 * reaches PostgreSQL.
 *
 * This is safe for Constructive's naming conventions because tenant
 * schema names (e.g., `t_<id>_services_public`) never collide with
 * table/column names (e.g., `apis`, `apps`, `domains`).  The regex
 * matches the exact pg-sql2 escaped identifier form.
 *
 * ## Legacy placeholder utilities
 *
 * The `wrapSchemaPlaceholder`, `isSchemaPlaceholder`, and
 * `extractOriginalName` functions are retained for backwards
 * compatibility and potential future use with Crystal's
 * `pgIdentifiers: "dynamic"` mode.
 *
 * @module compat/crystal/multiTenancy
 */

import { escapeSqlIdentifier } from 'pg-sql2';

// ---------------------------------------------------------------------------
// Placeholder encoding — private constants, public helper functions
// ---------------------------------------------------------------------------

/** @internal Prefix for dynamic schema placeholders. */
const PGMT_PREFIX = '__pgmt_';

/** @internal Suffix for dynamic schema placeholders. */
const PGMT_SUFFIX = '__';

/**
 * Wrap a schema name in the placeholder markers used by `pgIdentifiers:
 * "dynamic"`.  The result is a raw string suitable for passing to
 * `sql.identifier()`.
 */
export function wrapSchemaPlaceholder(schemaName: string): string {
  return `${PGMT_PREFIX}${schemaName}${PGMT_SUFFIX}`;
}

/**
 * Returns `true` if `name` looks like a dynamic schema placeholder.
 */
export function isSchemaPlaceholder(name: string): boolean {
  return name.startsWith(PGMT_PREFIX) && name.endsWith(PGMT_SUFFIX);
}

/**
 * Extract the original schema name from a placeholder string.
 * If the input is not a placeholder, it is returned unchanged.
 */
export function extractOriginalName(placeholder: string): string {
  if (isSchemaPlaceholder(placeholder)) {
    return placeholder.slice(PGMT_PREFIX.length, -PGMT_SUFFIX.length);
  }
  return placeholder;
}

/**
 * Extracts the original schema names from a list of placeholder schema
 * names.  Useful for understanding which schemas were used as the template.
 *
 * @param placeholderSchemas - Array of placeholder schema names.
 * @returns Array of original schema names.
 */
export function extractTemplateSchemaNames(
  placeholderSchemas: string[],
): string[] {
  return placeholderSchemas.map(extractOriginalName);
}

// ---------------------------------------------------------------------------
// SQL text transform
// ---------------------------------------------------------------------------

/** Escape special regex metacharacters in a literal string. */
function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Build a `sqlTextTransform` function that replaces template schema
 * names with real tenant schema names in compiled SQL.
 *
 * The function performs a **single-pass** regex replacement over the
 * SQL text, using `escapeSqlIdentifier` from pg-sql2 so that the
 * search pattern matches exactly what `sql.identifier()` produces
 * and the replacement is a properly escaped SQL identifier.
 *
 * ## Direct replacement (wrapper approach)
 *
 * This replaces real schema identifiers directly (e.g.,
 * `"t_1_services_public"` → `"t_2_services_public"`) without needing
 * Crystal's `pgIdentifiers: "dynamic"` placeholder mode.
 *
 * This is safe when template schema names do not collide with
 * table/column names — which holds for Constructive's `t_<id>_<purpose>`
 * naming convention.
 *
 * @param schemaMap - A mapping from template schema names to real
 *   tenant schema names. E.g. `{ t_1_public: 't_2_public' }`.
 * @returns A function suitable for use with `PgMultiTenancyWrapperPlugin`.
 */
export function buildSchemaRemapTransform(
  schemaMap: Record<string, string>,
): (text: string) => string {
  const entries = Object.entries(schemaMap);
  if (entries.length === 0) {
    return (text: string) => text;
  }

  // Pre-compute a lookup map: escaped template name → escaped real name.
  // Both sides use pg-sql2's escapeSqlIdentifier so the search string
  // matches exactly what sql.identifier() produces at compile time, and
  // the replacement is a properly escaped SQL identifier.
  const lookupMap = new Map<string, string>();
  const regexParts: string[] = [];

  for (const [templateSchema, realSchema] of entries) {
    const searchPattern = escapeSqlIdentifier(templateSchema);
    const replacement = escapeSqlIdentifier(realSchema);
    lookupMap.set(searchPattern, replacement);
    regexParts.push(escapeRegExp(searchPattern));
  }

  // Single compiled regex that matches any template schema name in one pass.
  const regex = new RegExp(regexParts.join('|'), 'g');

  return (text: string): string => {
    return text.replace(regex, (match) => lookupMap.get(match)!);
  };
}
