import '../augmentations';
import type { GraphileConfig } from 'graphile-config';
import type { ColumnSpec } from '../utils/sql-builder';
import { buildBulkInsertSQL } from '../utils/sql-builder';

const version = '0.1.0';

/**
 * BulkUpsertPlugin
 *
 * Registers `bulkUpsertX` mutation fields for each resource with the
 * `bulkUpsert` behavior. Uses INSERT ... ON CONFLICT DO UPDATE SET.
 */
export const BulkUpsertPlugin: GraphileConfig.Plugin = {
  name: 'BulkUpsertPlugin',
  version,
  description: 'Adds bulk upsert (bulkUpsertX) mutations',
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
            bulkUpsert: enableUpsert = true,
            bulkMaxRows = 1000,
          },
        } = build;

        if (!enableUpsert) return fields;

        const pgRegistry = build.input.pgRegistry;
        for (const [resourceName, resource] of Object.entries(
          pgRegistry.pgResources
        ) as [string, any][]) {
          if (resource.parameters) continue;
          if (!resource.codec.attributes) continue;
          if (resource.codec.polymorphism) continue;
          if (resource.codec.isAnonymous) continue;
          if (!resource.uniques?.length) continue;
          if (!build.behavior.pgResourceMatches(resource, 'bulkUpsert'))
            continue;

          const typeName = inflection.tableType(resource.codec);
          const fieldName = inflection.bulkUpsertField(resourceName);
          const inputTypeName = inflection.bulkUpsertInputType(typeName);
          const payloadTypeName = inflection.bulkUpsertPayloadType(typeName);

          const inputType = build.getTypeByName(inputTypeName);
          const payloadType = build.getTypeByName(payloadTypeName);
          if (!inputType || !payloadType) continue;

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

          // Collect unique constraint attributes for excluding from updateColumns
          const uniqueAttrs = new Set<string>();
          for (const unique of resource.uniques) {
            for (const attr of unique.attributes) {
              uniqueAttrs.add(attr);
            }
          }

          const compiledFrom = sql.compile(resource.from).text;

          fields = build.extend(
            fields,
            {
              [fieldName]: context.fieldWithHooks(
                { fieldName },
                () => ({
                  description: `Bulk upsert rows into ${typeName}. Requires an ON CONFLICT constraint.`,
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
                                `Bulk upsert exceeds maximum of ${bulkMaxRows} rows (got ${values.length})`
                              );
                            }

                            if (!input.onConflict?.constraint) {
                              throw new Error(
                                'bulkUpsert requires onConflict.constraint'
                              );
                            }

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

                            // Determine which columns to update
                            let updateColumns: string[] | undefined;
                            if (
                              input.onConflict.updateColumns &&
                              input.onConflict.updateColumns.length > 0
                            ) {
                              updateColumns = input.onConflict.updateColumns;
                            } else {
                              // Default: all non-key columns
                              updateColumns = columnSpecs
                                .map((c) => c.name)
                                .filter((n) => !uniqueAttrs.has(n));
                            }

                            const batches = buildBulkInsertSQL(
                              compiledFrom,
                              columnSpecs,
                              rows,
                              {
                                constraintName: input.onConflict.constraint,
                                action: 'UPDATE',
                                updateColumns,
                              }
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
            `Adding bulk upsert field for ${typeName}`
          );
        }

        return fields;
      },
    },
  },
};
