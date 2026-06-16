/**
 * Single-source type mapping between PostgreSQL, PostGraphile GraphQL, and FieldType.
 *
 * This is the canonical mapping table. All other mappers and tests derive from it:
 * - `mapPgTypeToFieldType` in export-utils.ts
 * - `mapGraphQLTypeToFieldType` in graphql-naming.ts
 * - `pgUdtToGraphQLType` / `pgUdtToGraphQLKind` in cross-flow-parity test
 * - parity table in dynamic-fields test
 *
 * When a new type needs to be supported, add it here and all consumers update automatically.
 */
import { FieldType } from './export-utils';

export interface TypeMapEntry {
  /** PostgreSQL udt_name values from information_schema (e.g. ['int4', 'int2']) */
  pgUdtNames: string[];
  /** PostGraphile v5 GraphQL type name (e.g. 'Int', 'BigInt', 'Datetime') */
  gqlTypeName: string;
  /** FieldType used by csv-to-pg Parser (e.g. 'int', 'timestamptz') */
  fieldType: FieldType;
  /** GraphQL kind that PostGraphile reports via introspection */
  gqlKind: 'SCALAR' | 'OBJECT' | 'ENUM';
  /** Whether this is a PostgreSQL array type (e.g. _uuid, _text, _jsonb) */
  isArray?: boolean;
}

/**
 * Canonical PG → GraphQL → FieldType mapping table.
 * Aligned with PostGraphile v5's PgCodecsPlugin type assignments:
 *   - int2, int4 → Int
 *   - int8 (bigint) → BigInt
 *   - numeric → BigFloat
 *   - float4, float8 → Float
 *   - interval → Interval (OBJECT kind, not SCALAR)
 *   - timestamptz, timestamp → Datetime
 */
export const PG_TYPE_MAP: TypeMapEntry[] = [
  { pgUdtNames: ['uuid'],                              gqlTypeName: 'UUID',     fieldType: 'uuid',       gqlKind: 'SCALAR' },
  { pgUdtNames: ['_uuid'],                             gqlTypeName: 'UUID',     fieldType: 'uuid[]',     gqlKind: 'SCALAR', isArray: true },
  { pgUdtNames: ['text', 'varchar', 'bpchar', 'name', 'citext'], gqlTypeName: 'String',  fieldType: 'text',       gqlKind: 'SCALAR' },
  { pgUdtNames: ['_text', '_varchar', '_citext'],           gqlTypeName: 'String',  fieldType: 'text[]',     gqlKind: 'SCALAR', isArray: true },
  { pgUdtNames: ['bool'],                              gqlTypeName: 'Boolean',  fieldType: 'boolean',    gqlKind: 'SCALAR' },
  { pgUdtNames: ['jsonb', 'json'],                     gqlTypeName: 'JSON',    fieldType: 'jsonb',      gqlKind: 'SCALAR' },
  { pgUdtNames: ['_jsonb'],                            gqlTypeName: 'JSON',    fieldType: 'jsonb[]',    gqlKind: 'SCALAR', isArray: true },
  { pgUdtNames: ['int2', 'int4'],                      gqlTypeName: 'Int',     fieldType: 'int',        gqlKind: 'SCALAR' },
  { pgUdtNames: ['int8'],                              gqlTypeName: 'BigInt',  fieldType: 'int',        gqlKind: 'SCALAR' },
  { pgUdtNames: ['numeric'],                           gqlTypeName: 'BigFloat', fieldType: 'int',        gqlKind: 'SCALAR' },
  { pgUdtNames: ['float4', 'float8'],                  gqlTypeName: 'Float',   fieldType: 'int',        gqlKind: 'SCALAR' },
  { pgUdtNames: ['interval'],                          gqlTypeName: 'Interval', fieldType: 'interval',   gqlKind: 'OBJECT' },
  { pgUdtNames: ['timestamptz', 'timestamp'],          gqlTypeName: 'Datetime', fieldType: 'timestamptz', gqlKind: 'SCALAR' },
];

// =============================================================================
// Lookup indices (built once at module load)
// =============================================================================

/** Reverse index: pgUdtName → TypeMapEntry */
const pgUdtIndex = new Map<string, TypeMapEntry>();
for (const entry of PG_TYPE_MAP) {
  for (const udt of entry.pgUdtNames) {
    pgUdtIndex.set(udt, entry);
  }
}

/** Reverse index: gqlTypeName → TypeMapEntry (first match wins) */
const gqlTypeIndex = new Map<string, TypeMapEntry>();
for (const entry of PG_TYPE_MAP) {
  if (!gqlTypeIndex.has(entry.gqlTypeName)) {
    gqlTypeIndex.set(entry.gqlTypeName, entry);
  }
}

/**
 * Look up a TypeMapEntry by PostgreSQL udt_name.
 * Returns undefined for unknown types (callers should fall back to 'text').
 */
export const lookupByPgUdt = (udtName: string): TypeMapEntry | undefined => pgUdtIndex.get(udtName);

/**
 * Look up a TypeMapEntry by GraphQL type name.
 * Returns undefined for unknown types (callers should fall back to 'text').
 */
export const lookupByGqlType = (gqlTypeName: string): TypeMapEntry | undefined => gqlTypeIndex.get(gqlTypeName);
