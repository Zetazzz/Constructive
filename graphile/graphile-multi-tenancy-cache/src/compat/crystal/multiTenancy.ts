// TODO: Once @dataplan/pg (crystal) PR #5 is merged and published,
// delete this file and import directly from
// `graphile-build-pg/multiTenancy` (or `@dataplan/pg/multiTenancy`).
//
// This shim mirrors the structure and contract of
// `graphile-build-pg/src/multiTenancy.ts` in the crystal repo so that
// Constructive can depend on a single, well-defined interface today and
// swap to the official package with a one-line import change later.

/**
 * Multi-tenancy utilities for dynamic schema resolution.
 *
 * When `pgIdentifiers` is set to `"dynamic"`, schema names in SQL
 * identifiers are wrapped in opaque placeholders during the gather/build
 * phase.  At execution time a per-request `sqlTextTransform` function
 * (set on `PgExecutorContext`) replaces these placeholders with the
 * real tenant schema names.
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
 * Build a `sqlTextTransform` function that replaces dynamic schema
 * placeholders with real tenant schema names.
 *
 * The function performs a **single-pass** regex replacement over the
 * compiled SQL text, using `escapeSqlIdentifier` from pg-sql2 so that
 * schema names containing special characters (double quotes, etc.) are
 * handled safely.
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

  // Pre-compute a lookup map: escaped placeholder → escaped real name.
  // Both sides use pg-sql2's escapeSqlIdentifier so the search string
  // matches exactly what sql.identifier() produces at compile time, and
  // the replacement is a properly escaped SQL identifier.
  const lookupMap = new Map<string, string>();
  const regexParts: string[] = [];

  for (const [templateSchema, realSchema] of entries) {
    const placeholder = escapeSqlIdentifier(
      wrapSchemaPlaceholder(templateSchema),
    );
    const replacement = escapeSqlIdentifier(realSchema);
    lookupMap.set(placeholder, replacement);
    regexParts.push(escapeRegExp(placeholder));
  }

  // Single compiled regex that matches any placeholder in one pass.
  const regex = new RegExp(regexParts.join('|'), 'g');

  return (text: string): string => {
    return text.replace(regex, (match) => lookupMap.get(match)!);
  };
}
