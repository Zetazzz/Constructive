import '../augmentations';
import type { GraphileConfig } from 'graphile-config';

const version = '0.1.0';

/**
 * BulkDeletePlugin
 *
 * Registers `bulkDeleteX` mutation fields for each resource with the
 * `bulkDelete` behavior. Uses DELETE ... WHERE with conditions from
 * graphile-connection-filter (or PostGraphile's built-in condition type).
 */
export const BulkDeletePlugin: GraphileConfig.Plugin = {
  name: 'BulkDeletePlugin',
  version,
  description: 'Adds bulk delete (bulkDeleteX) mutations',
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
            bulkDelete: enableDelete = true,
            bulkRequireWhere = true,
          },
        } = build;

        if (!enableDelete) return fields;

        const pgRegistry = build.input.pgRegistry;
        for (const [resourceName, resource] of Object.entries(
          pgRegistry.pgResources
        ) as [string, any][]) {
          if (resource.parameters) continue;
          if (!resource.codec.attributes) continue;
          if (resource.codec.polymorphism) continue;
          if (resource.codec.isAnonymous) continue;
          if (!resource.uniques?.length) continue;
          if (!build.behavior.pgResourceMatches(resource, 'bulkDelete'))
            continue;

          const typeName = inflection.tableType(resource.codec);
          const fieldName = inflection.bulkDeleteField(resourceName);
          const inputTypeName = inflection.bulkDeleteInputType(typeName);
          const payloadTypeName = inflection.bulkDeletePayloadType(typeName);

          const inputType = build.getTypeByName(inputTypeName);
          const payloadType = build.getTypeByName(payloadTypeName);
          if (!inputType || !payloadType) continue;

          const fieldToAttr: Record<string, string> = {};
          const attrToSqlType: Record<string, string> = {};
          for (const [attrName, attr] of Object.entries(
            resource.codec.attributes
          ) as [string, any][]) {
            const gqlFieldName = inflection.attribute({
              attributeName: attrName,
              codec: resource.codec,
            });
            fieldToAttr[gqlFieldName] = attrName;
            attrToSqlType[attrName] = sql.compile(attr.codec.sqlType).text;
          }

          const compiledFrom = sql.compile(resource.from).text;

          fields = build.extend(
            fields,
            {
              [fieldName]: context.fieldWithHooks(
                { fieldName },
                () => ({
                  description: `Bulk delete ${typeName} rows matching the given condition.`,
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
                            if (bulkRequireWhere && (!input.where || Object.keys(input.where).length === 0)) {
                              throw new Error(
                                'Bulk delete requires a non-empty where condition. Set bulkRequireWhere: false to allow unrestricted deletes.'
                              );
                            }

                            // Build WHERE clause from condition
                            const values: unknown[] = [];
                            const whereClauses: string[] = [];

                            if (input.where) {
                              for (const [key, spec] of Object.entries(input.where) as [string, any][]) {
                                const attrName = fieldToAttr[key];
                                if (!attrName) continue;
                                const sqlType = attrToSqlType[attrName];

                                if (spec && typeof spec === 'object') {
                                  for (const [op, val] of Object.entries(spec) as [string, any][]) {
                                    values.push(val);
                                    const paramRef = `$${values.length}::${sqlType}`;
                                    switch (op) {
                                      case 'equalTo':
                                        whereClauses.push(`"${attrName}" = ${paramRef}`);
                                        break;
                                      case 'notEqualTo':
                                        whereClauses.push(`"${attrName}" != ${paramRef}`);
                                        break;
                                      case 'greaterThan':
                                        whereClauses.push(`"${attrName}" > ${paramRef}`);
                                        break;
                                      case 'greaterThanOrEqualTo':
                                        whereClauses.push(`"${attrName}" >= ${paramRef}`);
                                        break;
                                      case 'lessThan':
                                        whereClauses.push(`"${attrName}" < ${paramRef}`);
                                        break;
                                      case 'lessThanOrEqualTo':
                                        whereClauses.push(`"${attrName}" <= ${paramRef}`);
                                        break;
                                      case 'in':
                                        if (Array.isArray(val)) {
                                          const placeholders = val.map((v: any) => {
                                            values.push(v);
                                            return `$${values.length}::${sqlType}`;
                                          });
                                          values.pop();
                                          whereClauses.push(`"${attrName}" IN (${placeholders.join(', ')})`);
                                        }
                                        break;
                                      case 'isNull':
                                        values.pop();
                                        if (val) {
                                          whereClauses.push(`"${attrName}" IS NULL`);
                                        } else {
                                          whereClauses.push(`"${attrName}" IS NOT NULL`);
                                        }
                                        break;
                                      default:
                                        values.pop();
                                        break;
                                    }
                                  }
                                }
                              }
                            }

                            if (whereClauses.length === 0 && bulkRequireWhere) {
                              throw new Error(
                                'Bulk delete: no valid where conditions resolved. At least one condition is required.'
                              );
                            }

                            const whereStr = whereClauses.length > 0
                              ? whereClauses.join(' AND ')
                              : 'TRUE';

                            const text = `DELETE FROM ${compiledFrom}\nWHERE ${whereStr}\nRETURNING *`;
                            const result = await pgClient.query(text, values);

                            return {
                              affectedCount: result.rowCount ?? 0,
                              returning: result.rows || [],
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
            `Adding bulk delete field for ${typeName}`
          );
        }

        return fields;
      },
    },
  },
};
