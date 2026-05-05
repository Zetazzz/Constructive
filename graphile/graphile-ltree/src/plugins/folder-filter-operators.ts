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

function slashToLtree(value: SQL, useHelpers: boolean): SQL {
  if (useHelpers) {
    return sql.fragment`ltree_helpers.to_path(${value})`;
  }
  return sql.fragment`replace(ltrim(${value}, '/'), '/', '.')::ltree`;
}

function slashGlobToLquery(value: SQL, useHelpers: boolean): SQL {
  if (useHelpers) {
    return sql.fragment`ltree_helpers.to_query(${value})`;
  }
  return sql.fragment`replace(replace(replace(replace(ltrim(${value}, '/'), '**', '__DSTAR__'), '*', '*{1}'), '__DSTAR__', '*'), '/', '.')::lquery`;
}

/**
 * Creates folder-oriented connection filter operators for the LTree scalar.
 *
 * These are user-friendly aliases for the raw ltree operators, designed for
 * slash-delimited file/folder paths:
 *
 * - `within`     — files within a folder: path <@ to_path('/projects/alpha')
 * - `ancestorOf` — ancestor folders: path @> to_path('/projects/alpha/docs')
 * - `glob`       — glob pattern: path ~ to_query('/projects/* /docs')
 *
 * All inputs use slash-delimited paths. Conversion to ltree happens server-side.
 *
 * @example
 * ```graphql
 * allFiles(where: { path: { within: "/projects/alpha" } }) { ... }
 * allFiles(where: { path: { glob: "/projects/* /docs" } }) { ... }
 * ```
 */
export function createFolderOperatorFactory(): ConnectionFilterOperatorFactory {
  return (build) => {
    const ltreeInfo = (build as any).pgLtreeExtensionInfo;
    if (!ltreeInfo) return [];

    const useHelpers = hasLtreeHelpers(build);
    const registrations: ConnectionFilterOperatorRegistration[] = [];

    registrations.push({
      typeNames: LTREE_SCALAR_NAME,
      operatorName: 'within',
      spec: {
        description:
          'Files within the specified folder (inclusive). ' +
          'Accepts slash-delimited paths like "/projects/alpha".',
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
          return sql.fragment`${sqlIdentifier} <@ ${slashToLtree(pathVal, useHelpers)}`;
        }
      } satisfies ConnectionFilterOperatorSpec
    });

    registrations.push({
      typeNames: LTREE_SCALAR_NAME,
      operatorName: 'ancestorOf',
      spec: {
        description:
          'Ancestor folders of the specified path. ' +
          'Accepts slash-delimited paths like "/projects/alpha/docs".',
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
          return sql.fragment`${sqlIdentifier} @> ${slashToLtree(pathVal, useHelpers)}`;
        }
      } satisfies ConnectionFilterOperatorSpec
    });

    registrations.push({
      typeNames: LTREE_SCALAR_NAME,
      operatorName: 'glob',
      spec: {
        description:
          'Matches a slash-delimited glob pattern. ' +
          'Use * for single-level wildcard, ** for recursive descent. ' +
          'Example: "/projects/*/docs".',
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
          return sql.fragment`${sqlIdentifier} ~ ${slashGlobToLquery(globVal, useHelpers)}`;
        }
      } satisfies ConnectionFilterOperatorSpec
    });

    return registrations;
  };
}
