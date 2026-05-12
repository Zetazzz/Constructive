import '../augmentations';
import type { GraphileConfig } from 'graphile-config';
import type { ColumnSpec } from '../utils/sql-builder';
import { buildBulkInsertSQL } from '../utils/sql-builder';

const version = '0.1.0';

/**
 * BulkInsertPlugin
 *
 * Registers `bulkCreateX` mutation fields on the root mutation type for
 * each resource that has the `bulkInsert` behavior.
 *
 * Uses `sideEffectWithPgClient` for raw SQL execution, then feeds the
 * returned records into `pgSelectFromRecords` for full type resolution.
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
          EXPORTABLE,
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

          // Build the fully qualified table name
          const compiledFrom = sql.compile(resource.from).text;

          fields = build.extend(
            fields,
            {
              [fieldName]: context.fieldWithHooks(
                { fieldName },
                () => ({
                  description: `Bulk insert rows into ${typeName}.`,
                  type: payloadType,
                  args: {
                    input: {
                      type: new GraphQLNonNull(inputType),
                    },
                  },
                  plan: EXPORTABLE(
                    () =>
                      function plan(_$root: any, args: any) {
                        const $input = args.get('input');
                        const $result = build.dataplanPg.sideEffectWithPgClient(
                          resource.executor,
                          $input,
                          async (pgClient: any, input: any) => {
                            const values = input.values;
                            if (!values || !Array.isArray(values) || values.length === 0) {
                              return { affectedCount: 0, returning: [] };
                            }

                            if (values.length > bulkMaxRows) {
                              throw new Error(
                                `Bulk insert exceeds maximum of ${bulkMaxRows} rows (got ${values.length})`
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
                            let onConflict: Parameters<typeof buildBulkInsertSQL>[3];
                            if (input.onConflict) {
                              onConflict = {
                                constraintName: input.onConflict.constraint,
                                action: input.onConflict.action,
                              };
                            }

                            const batches = buildBulkInsertSQL(
                              compiledFrom,
                              columnSpecs,
                              rows,
                              onConflict
                            );

                            let totalAffected = 0;
                            const allRows: unknown[] = [];

                            for (const batch of batches) {
                              const result = await pgClient.query(
                                batch.text,
                                batch.values
                              );
                              totalAffected += result.rowCount ?? 0;
                              if (result.rows) {
                                allRows.push(...result.rows);
                              }
                            }

                            return {
                              affectedCount: totalAffected,
                              returning: allRows,
                            };
                          }
                        );
                        return $result;
                      },
                    []
                  ),
                })
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
