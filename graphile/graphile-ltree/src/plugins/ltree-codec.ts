/**
 * LtreeCodecPlugin
 *
 * Ensures PostGraphile v5 properly handles ltree, lquery, and ltxtquery types.
 *
 * PostGraphile v5 (rc.8+) natively maps ltree to a GraphQL scalar named "LTree".
 * This plugin:
 * 1. Falls back to registering codecs if PostGraphile's native handling misses them
 * 2. Re-enables ltree columns for select/filterBy (overrides rc.8 HIDE_BY_DEFAULT)
 *
 * The native scalar name is "LTree" (capital T). All operators and downstream
 * plugins should reference LTREE_SCALAR_NAME for consistency.
 */

import type { GraphileConfig } from 'graphile-config';
import { GraphQLString } from 'graphql';
import sql from 'pg-sql2';

export const LTREE_SCALAR_NAME = 'LTree';

export const LtreeCodecPlugin: GraphileConfig.Plugin = {
  name: 'LtreeCodecPlugin',
  version: '1.0.0',
  description: 'Ensures ltree/lquery codecs are properly registered and enabled',

  gather: {
    hooks: {
      async pgCodecs_findPgCodec(info, event) {
        if (event.pgCodec) return;

        const { pgType: type, serviceName } = event;

        const isLtree = type.typname === 'ltree';
        const isLquery = type.typname === 'lquery';
        const isLtxtquery = type.typname === 'ltxtquery';

        if (!isLtree && !isLquery && !isLtxtquery) return;

        const ns = await info.helpers.pgIntrospection.getNamespace(
          serviceName,
          type.typnamespace
        );
        const schemaName = ns?.nspname || 'pg_catalog';

        event.pgCodec = {
          name: type.typname,
          sqlType: sql.identifier(schemaName, type.typname),
          fromPg: (value: string) => value,
          toPg: (value: string) => value,
          attributes: undefined,
          executor: null,
          extensions: {
            oid: type._id,
            pg: {
              serviceName,
              schemaName,
              name: type.typname
            }
          }
        };
      }
    }
  },

  schema: {
    hooks: {
      init: {
        before: ['PgCodecs', 'PgConnectionArgFilterPlugin'],
        callback(_, build) {
          const { setGraphQLTypeForPgCodec, hasGraphQLTypeForPgCodec } = build;

          for (const codec of Object.values(build.input.pgRegistry.pgCodecs)) {
            if (codec.name === 'ltree') {
              if (!hasGraphQLTypeForPgCodec(codec, 'input')) {
                build.registerScalarType(
                  LTREE_SCALAR_NAME,
                  {},
                  () => ({
                    description:
                      'A PostgreSQL ltree hierarchical label path, represented as a dot-delimited string (e.g. "projects.alpha.docs").',
                    serialize(value: unknown) {
                      return String(value);
                    },
                    parseValue(value: unknown) {
                      if (typeof value === 'string') return value;
                      throw new Error(`${LTREE_SCALAR_NAME} must be a string`);
                    },
                    parseLiteral(lit: any) {
                      if (lit.kind === 'NullValue') return null;
                      if (lit.kind !== 'StringValue') {
                        throw new Error(`${LTREE_SCALAR_NAME} must be a string`);
                      }
                      return lit.value;
                    }
                  }),
                  `LtreeCodecPlugin registering ${LTREE_SCALAR_NAME} scalar`
                );
                setGraphQLTypeForPgCodec(codec, 'input', LTREE_SCALAR_NAME);
                setGraphQLTypeForPgCodec(codec, 'output', LTREE_SCALAR_NAME);
              }
            } else if (codec.name === 'lquery' || codec.name === 'ltxtquery') {
              if (!hasGraphQLTypeForPgCodec(codec, 'input')) {
                setGraphQLTypeForPgCodec(codec, 'input', GraphQLString.name);
              }
              if (!hasGraphQLTypeForPgCodec(codec, 'output')) {
                setGraphQLTypeForPgCodec(codec, 'output', GraphQLString.name);
              }
            }
          }

          return _;
        }
      }
    },

    entityBehavior: {
      pgCodecAttribute: {
        inferred: {
          after: ['default'],
          provides: ['ltreeCodecPlugin'],
          callback(behavior: any, [codec, attributeName]: [any, string]) {
            const attr = codec.attributes?.[attributeName];
            const attrCodec = attr?.codec;
            const isLtree =
              attrCodec?.name === 'ltree' ||
              attrCodec?.extensions?.pg?.name === 'ltree';
            if (!isLtree) return behavior;

            return [
              behavior,
              'attribute:select',
              'attribute:base',
              'condition:attribute:filterBy'
            ] as any;
          }
        }
      }
    }
  }
};
