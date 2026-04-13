/**
 * Schema Fingerprinting
 *
 * Generates a structural hash (SHA-256) from a database introspection result.
 * The hash is based strictly on structure: table names, column names, data types,
 * and constraints — but IGNORES the namespace (schema name) so that
 * `tenant_a.users` and `tenant_b.users` produce the exact same fingerprint.
 */

import crypto from 'node:crypto';
import { Logger } from '@pgpmjs/logger';

const log = new Logger('multi-tenancy-cache:fingerprint');

/**
 * Minimal introspection types — we only need the structural fields.
 * These mirror the shapes returned by pg-introspection's `parseIntrospectionResults`.
 */
export interface IntrospectionClass {
  _id: string;
  relname: string;
  relnamespace: string;
  relkind: string;
}

export interface IntrospectionAttribute {
  attrelid: string;
  attname: string;
  atttypid: string;
  attnum: number;
  attnotnull: boolean;
}

export interface IntrospectionConstraint {
  _id: string;
  conname: string;
  connamespace: string;
  conrelid: string;
  contype: string;
  conkey: number[] | null;
  confrelid: string;
  confkey: number[] | null;
}

export interface IntrospectionType {
  _id: string;
  typname: string;
  typnamespace: string;
  typtype: string;
}

export interface IntrospectionNamespace {
  _id: string;
  nspname: string;
}

export interface IntrospectionProc {
  _id: string;
  proname: string;
  pronamespace: string;
  proargtypes: string[];
  prorettype: string;
}

export interface MinimalIntrospection {
  namespaces: IntrospectionNamespace[];
  classes: IntrospectionClass[];
  attributes: IntrospectionAttribute[];
  constraints: IntrospectionConstraint[];
  types: IntrospectionType[];
  procs?: IntrospectionProc[];
}

/**
 * Build a lookup map from namespace OID -> namespace name.
 */
function buildNamespaceLookup(namespaces: IntrospectionNamespace[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const ns of namespaces) {
    map.set(ns._id, ns.nspname);
  }
  return map;
}

/**
 * Normalize a constraint: strip schema-specific OIDs, keep structural info.
 */
function normalizeConstraint(
  c: IntrospectionConstraint,
  classNameMap: Map<string, string>,
): string {
  // Use the referenced table name (not OID) for FK normalization
  const refTableName = c.confrelid ? (classNameMap.get(c.confrelid) || 'unknown') : '';
  const keyStr = c.conkey ? [...c.conkey].sort((a, b) => a - b).join(',') : '';
  const fkeyStr = c.confkey ? [...c.confkey].sort((a, b) => a - b).join(',') : '';
  // Strip constraint name prefix if it starts with schema name
  const normalizedName = c.conname;
  return `${normalizedName}:${c.contype}:${keyStr}:${refTableName}:${fkeyStr}`;
}

/**
 * Generate a structural fingerprint from introspection data.
 *
 * The fingerprint is a SHA-256 hash that:
 * - INCLUDES: table names, column names, data types, constraints, function signatures
 * - EXCLUDES: schema/namespace names (so tenant_a.users == tenant_b.users)
 * - EXCLUDES: OIDs and other instance-specific identifiers
 *
 * @param introspection - The parsed introspection result
 * @param schemaNames - Optional list of schema names to filter (if empty, uses all)
 * @returns SHA-256 hex string fingerprint
 */
export function getSchemaFingerprint(
  introspection: MinimalIntrospection,
  schemaNames?: string[],
): string {
  const nsLookup = buildNamespaceLookup(introspection.namespaces);

  // Determine which namespace OIDs to include
  let targetNsOids: Set<string>;
  if (schemaNames && schemaNames.length > 0) {
    targetNsOids = new Set<string>();
    for (const ns of introspection.namespaces) {
      if (schemaNames.includes(ns.nspname)) {
        targetNsOids.add(ns._id);
      }
    }
  } else {
    // Use all non-system namespaces
    targetNsOids = new Set(
      introspection.namespaces
        .filter((ns) => !ns.nspname.startsWith('pg_') && ns.nspname !== 'information_schema')
        .map((ns) => ns._id),
    );
  }

  // Filter classes to target namespaces
  const classes = introspection.classes
    .filter((c) => targetNsOids.has(c.relnamespace))
    .sort((a, b) => a.relname.localeCompare(b.relname));

  // Build class OID -> name map for constraint normalization
  const classNameMap = new Map<string, string>();
  for (const c of classes) {
    classNameMap.set(c._id, c.relname);
  }

  // Build type OID -> name map for attribute and proc lookups.
  // Pre-computing this avoids O(A×T) linear scans inside loops.
  const typeLookup = new Map<string, string>();
  for (const t of introspection.types) {
    typeLookup.set(t._id, t.typname);
  }

  // Build class OID set for filtering
  const classOids = new Set(classes.map((c) => c._id));

  // Build structural representation
  const parts: string[] = [];

  for (const cls of classes) {
    // Table: name + kind (skip namespace)
    parts.push(`TABLE:${cls.relname}:${cls.relkind}`);

    // Attributes for this class, sorted by position
    const attrs = introspection.attributes
      .filter((a) => a.attrelid === cls._id && a.attnum > 0)
      .sort((a, b) => a.attnum - b.attnum);

    for (const attr of attrs) {
      // Resolve type name via pre-built lookup map (O(1) instead of O(T) scan)
      const typeName = typeLookup.get(attr.atttypid) || attr.atttypid;
      parts.push(`ATTR:${cls.relname}.${attr.attname}:${typeName}:${attr.attnotnull}`);
    }

    // Constraints for this class, sorted by name
    const constraints = introspection.constraints
      .filter((c) => c.conrelid === cls._id)
      .sort((a, b) => a.conname.localeCompare(b.conname));

    for (const con of constraints) {
      parts.push(`CONSTRAINT:${cls.relname}.${normalizeConstraint(con, classNameMap)}`);
    }
  }

  // Include functions/procedures in target namespaces
  if (introspection.procs) {
    const procs = introspection.procs
      .filter((p) => targetNsOids.has(p.pronamespace))
      .sort((a, b) => a.proname.localeCompare(b.proname));

    for (const proc of procs) {
      const argTypes = (proc.proargtypes || [])
        .map((tid) => typeLookup.get(tid) || tid)
        .join(',');
      const retType = typeLookup.get(proc.prorettype) || proc.prorettype;
      parts.push(`PROC:${proc.proname}(${argTypes}):${retType}`);
    }
  }

  const structuralString = parts.join('\n');
  const hash = crypto.createHash('sha256').update(structuralString).digest('hex');

  log.debug(`Fingerprint generated: ${hash.substring(0, 16)}... (${parts.length} structural elements)`);

  return hash;
}

/**
 * Compare two fingerprints to check if schemas are structurally identical.
 */
export function fingerprintsMatch(a: string, b: string): boolean {
  return a === b;
}
