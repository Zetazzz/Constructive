import 'graphile-build';
import 'graphile-build-pg';
import 'graphile-connection-filter';

import type {
  ConnectionFilterOperatorFactory,
  ConnectionFilterOperatorRegistration,
  ConnectionFilterOperatorSpec
} from 'graphile-connection-filter';
import type { SQL } from 'pg-sql2';
import sql from 'pg-sql2';

import { LTREE_SCALAR_NAME } from './ltree-codec';

function hasLtreeHelpers(build: any): boolean {
  const pgRegistry = build.input?.pgRegistry;
  if (!pgRegistry) return false;
  for (const resource of Object.values(pgRegistry.pgResources)) {
    const r = resource as any;
    if (r?.extensions?.pg?.schemaName === 'ltree_helpers') return true;
  }
  return false;
}

function toPathExpr(value: SQL, useHelpers: boolean): SQL {
  if (useHelpers) {
    return sql.fragment`ltree_helpers.to_path(${value})`;
  }
  return sql.fragment`replace(ltrim(${value}, '/'), '/', '.')::ltree`;
}

function toQueryExpr(value: SQL, useHelpers: boolean): SQL {
  if (useHelpers) {
    return sql.fragment`ltree_helpers.to_query(${value})`;
  }
  // Glob → lquery conversion:
  //   ** → * (0+ labels in lquery)
  //   *  → *{1} (exactly 1 label)
  // We use a placeholder to avoid ** being affected by the * → *{1} step.
  return sql.fragment`replace(replace(replace(replace(ltrim(${value}, '/'), '**', '__DSTAR__'), '*', '*{1}'), '__DSTAR__', '*'), '/', '.')::lquery`;
}

/**
 * Creates the ltree connection filter operator factory.
 *
 * Registers operators on the LTree scalar type (only ltree columns):
 *
 * - `isAncestorOf`   -- column <@ to_path(value): finds descendants
 * - `isDescendantOf` -- column @> to_path(value): finds ancestors
 * - `matchesGlob`    -- column ~ to_query(value): glob/lquery pattern matching
 *
 * All operators accept dot-delimited paths or slash-delimited paths.
 * When ltree_helpers is installed, conversion happens server-side via
 * to_path() / to_query(). Otherwise, inline SQL casts are used.
 */
export function createLtreeOperatorFactory(): ConnectionFilterOperatorFactory {
  return (build) => {
    const ltreeInfo = (build as any).pgLtreeExtensionInfo;
    if (!ltreeInfo) return [];

    const useHelpers = hasLtreeHelpers(build);
    const registrations: ConnectionFilterOperatorRegistration[] = [];

    registrations.push({
      typeNames: LTREE_SCALAR_NAME,
      operatorName: 'isAncestorOf',
      spec: {
        description:
          'Is a descendant of (or equal to) the specified path. ' +
          'Returns rows whose ltree path is contained by the given path.',
        resolveType: (fieldType) => fieldType,
        resolveSqlValue: () => sql.null,
        resolve(
          sqlIdentifier: SQL,
          _sqlValue: SQL,
          input: unknown,
          _$where: any,
          _details: { fieldName: string | null; operatorName: string }
        ) {
          const pathVal = sql.value(String(input));
          return sql.fragment`${sqlIdentifier} <@ ${toPathExpr(pathVal, useHelpers)}`;
        }
      } satisfies ConnectionFilterOperatorSpec
    });

    registrations.push({
      typeNames: LTREE_SCALAR_NAME,
      operatorName: 'isDescendantOf',
      spec: {
        description:
          'Is an ancestor of (or equal to) the specified path. ' +
          'Returns rows whose ltree path contains the given path.',
        resolveType: (fieldType) => fieldType,
        resolveSqlValue: () => sql.null,
        resolve(
          sqlIdentifier: SQL,
          _sqlValue: SQL,
          input: unknown,
          _$where: any,
          _details: { fieldName: string | null; operatorName: string }
        ) {
          const pathVal = sql.value(String(input));
          return sql.fragment`${sqlIdentifier} @> ${toPathExpr(pathVal, useHelpers)}`;
        }
      } satisfies ConnectionFilterOperatorSpec
    });

    registrations.push({
      typeNames: LTREE_SCALAR_NAME,
      operatorName: 'matchesGlob',
      spec: {
        description:
          'Matches the specified glob pattern (lquery). ' +
          'Use * for single-level wildcard, ** for recursive descent.',
        resolveType: (fieldType) => fieldType,
        resolveSqlValue: () => sql.null,
        resolve(
          sqlIdentifier: SQL,
          _sqlValue: SQL,
          input: unknown,
          _$where: any,
          _details: { fieldName: string | null; operatorName: string }
        ) {
          const globVal = sql.value(String(input));
          return sql.fragment`${sqlIdentifier} ~ ${toQueryExpr(globVal, useHelpers)}`;
        }
      } satisfies ConnectionFilterOperatorSpec
    });

    return registrations;
  };
}
