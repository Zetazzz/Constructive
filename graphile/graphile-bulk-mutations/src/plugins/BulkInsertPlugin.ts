import '../augmentations';
import type { GraphileConfig } from 'graphile-config';
import { sideEffectWithPgClient } from '@dataplan/pg';
import type { ColumnSpec } from '../utils/sql-builder';
import { buildBulkInsertSQL } from '../utils/sql-builder';

const version = '0.1.0';

/**
 * BulkInsertPlugin
 *
 * Registers `bulkCreateX` mutation fields on the root mutation type for
 * each resource that has the `bulkInsert` behavior.
 *
 * Uses `sideEffectWithPgClient` for raw SQL execution. The mutation
 * SQL uses `RETURNING <pk_columns>` (not `RETURNING *`) to respect
 * column-level SELECT grants. A follow-up SELECT retrieves the full
 * rows using only the returned PKs, ensuring the query runs through
 * the normal grant-aware pipeline.
 *
 * Pattern from: https://github.com/pyramation/graphile-column-privileges-mutations
 */
export const BulkInsertPlugin: GraphileConfig.Plugin = {
  name: 'BulkInsertPlugin',
  version,
  description: 'Adds bulk insert (bulkCreateX) mutations',
  after: ['BulkTypesPlugin'],

  schema: {
    hooks: {
      GraphQLObjectType_fields(fields, build, context) {
        const {
          scope: { isRootMutation },
        } = context;
        if (!isRootMutation) return fields;

        const {
          inflection,
          sql,
          graphql: { GraphQLNonNull },
          options: {
            bulkInsert: enableInsert = true,
            bulkMaxRows = 1000,
          },
        } = build;

        if (!enableInsert) return fields;

        const pgRegistry = build.input.pgRegistry;
        for (const [resourceName, resource] of Object.entries(
          pgRegistry.pgResources
        ) as [string, any][]) {
          if (resource.parameters) continue;
          if (!resource.codec.attributes) continue;
          if (resource.codec.polymorphism) continue;
          if (resource.codec.isAnonymous) continue;
          if (!resource.uniques?.length) continue;
          if (!build.behavior.pgResourceMatches(resource, 'bulkInsert'))
            continue;

          const typeName = inflection.tableType(resource.codec);
          const fieldName = inflection.bulkInsertField(resourceName);
          const inputTypeName = inflection.bulkInsertInputType(typeName);
          const payloadTypeName = inflection.bulkInsertPayloadType(typeName);

          const inputType = build.getTypeByName(inputTypeName);
          const payloadType = build.getTypeByName(payloadTypeName);
          if (!inputType || !payloadType) continue;

          // Pre-compute column specs for SQL generation
          const columnSpecs: ColumnSpec[] = [];
          const fieldToAttr: Record<string, string> = {};
          for (const [attrName, attr] of Object.entries(
            resource.codec.attributes
          ) as [string, any][]) {
            if (attr.extensions?.isInsertable === false) continue;
            const gqlFieldName = inflection.attribute({
              attributeName: attrName,
              codec: resource.codec,
            });
            fieldToAttr[gqlFieldName] = attrName;
            columnSpecs.push({
              name: attrName,
              sqlType: sql.compile(attr.codec.sqlType).text,
            });
          }

          // Extract primary key columns for RETURNING clause
          const primaryUnique = resource.uniques.find((u: any) => u.isPrimary) ?? resource.uniques[0];
          const pkColumns: string[] = primaryUnique.attributes;

          const compiledFrom = sql.compile(resource.from).text;

          // Capture executor for plan closure
          const executor = resource.executor;
          const maxRows = bulkMaxRows as number;

          fields = build.extend(
            fields,
            {
              [fieldName]: context.fieldWithHooks(
                { fieldName },
                {
                  description: `Bulk insert rows into ${typeName}.`,
                  type: payloadType,
                  args: {
                    input: {
                      type: new GraphQLNonNull(inputType),
                    },
                  },
                  plan(_$root: any, args: any) {
                    const $input = args.getRaw('input');
                    const $result = sideEffectWithPgClient(
                      executor,
                      $input,
                      async (pgClient: any, input: any) => {
                        const values = input.values;
                        if (!values || !Array.isArray(values) || values.length === 0) {
                          return { affectedCount: 0, returning: [] };
                        }

                        if (values.length > maxRows) {
                          throw new Error(
                            `Bulk insert exceeds maximum of ${maxRows} rows (got ${values.length})`
                          );
                        }

                        // Map GraphQL field names to SQL column names
                        const rows = values.map((row: any) => {
                          const mapped: Record<string, unknown> = {};
                          for (const [key, val] of Object.entries(row)) {
                            const attrName = fieldToAttr[key];
                            if (attrName) {
                              mapped[attrName] = val;
                            }
                          }
                          return mapped;
                        });

                        // Build ON CONFLICT clause
                        // The constraint enum value is a comma-separated column list
                        let onConflict: Parameters<typeof buildBulkInsertSQL>[4];
                        if (input.onConflict) {
                          const conflictColumns = input.onConflict.constraint
                            ? (input.onConflict.constraint as string).split(',')
                            : undefined;
                          onConflict = {
                            conflictColumns,
                            action: input.onConflict.action,
                          };
                        }

                        const batches = buildBulkInsertSQL(
                          compiledFrom,
                          columnSpecs,
                          rows,
                          pkColumns,
                          onConflict
                        );

                        let totalAffected = 0;
                        const allPkRows: Record<string, unknown>[] = [];

                        for (const batch of batches) {
                          const result = await pgClient.query(
                            batch.text,
                            batch.values
                          );
                          totalAffected += result.rowCount ?? 0;
                          if (result.rows) {
                            allPkRows.push(...result.rows);
                          }
                        }

                        // Follow-up SELECT using PKs to respect column-level grants
                        let returning: unknown[] = [];
                        if (allPkRows.length > 0) {
                          const pkConditions = allPkRows.map((pkRow, rowIdx) => {
                            return pkColumns.map((col, colIdx) => {
                              const paramIdx = rowIdx * pkColumns.length + colIdx + 1;
                              return `"${col}" = $${paramIdx}`;
                            }).join(' AND ');
                          });
                          const whereClause = pkConditions.map((c) => `(${c})`).join(' OR ');
                          const selectParams = allPkRows.flatMap((pkRow) =>
                            pkColumns.map((col) => pkRow[col])
                          );
                          const selectResult = await pgClient.query(
                            `SELECT * FROM ${compiledFrom} WHERE ${whereClause}`,
                            selectParams
                          );
                          returning = selectResult.rows || [];
                        }

                        return {
                          affectedCount: totalAffected,
                          returning,
                        };
                      }
                    );
                    return $result;
                  },
                }
              ),
            },
            `Adding bulk insert field for ${typeName}`
          );
        }

        return fields;
      },
    },
  },
};
