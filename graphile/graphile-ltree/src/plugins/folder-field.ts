import 'graphile-build';
import 'graphile-build-pg';

import type { PgCodecWithAttributes } from '@dataplan/pg';
import type { GraphileConfig } from 'graphile-config';
import { GraphQLString } from 'graphql';

import type { LtreeExtensionInfo } from './detect-ltree';

/**
 * LtreeFolderFieldPlugin
 *
 * For every ltree column on every table:
 *
 * 1. Renames the raw ltree field from `{column}` to `{column}Tree`
 *    via the `@name` smart tag (e.g. `path` -> `pathTree`)
 *
 * 2. Adds a virtual field with the original name (`path`) that returns
 *    the slash-delimited folder path.
 *    (e.g. 'projects.alpha.docs' -> '/projects/alpha/docs')
 *
 * This gives users the clean field name for display while preserving
 * the raw ltree field (with all filter operators) under `{column}Tree`.
 */
export const LtreeFolderFieldPlugin: GraphileConfig.Plugin = {
  name: 'LtreeFolderFieldPlugin',
  version: '1.0.0',
  description: 'Renames ltree columns to {col}Tree and adds virtual {col} folder fields',
  after: ['LtreeExtensionDetectionPlugin', 'LtreeCodecPlugin', 'PgAttributesPlugin'],

  schema: {
    hooks: {
      /**
       * Before fields are built, rename ltree attributes via the @name tag.
       * This ensures PostGraphile's plan system correctly maps the renamed
       * field to the underlying database column.
       */
      init(_, build) {
        const ltreeInfo: LtreeExtensionInfo | undefined = (build as any).pgLtreeExtensionInfo;
        if (!ltreeInfo) return _;

        const pgRegistry = build.input?.pgRegistry;
        if (!pgRegistry) return _;

        for (const resource of Object.values(pgRegistry.pgResources)) {
          const r = resource as any;
          const codec = r?.codec;
          if (!codec?.attributes) continue;

          for (const [attrName, attr] of Object.entries(codec.attributes as Record<string, any>)) {
            const attrCodec = attr?.codec;
            if (!attrCodec) continue;

            const isLtree =
              attrCodec.name === 'ltree' ||
              attrCodec.extensions?.pg?.name === 'ltree';
            if (!isLtree) continue;

            // Set @name tag to rename: path → path_tree
            // PostGraphile's _attributeName inflector reads this tag
            attr.extensions = attr.extensions || {};
            attr.extensions.tags = attr.extensions.tags || {};
            attr.extensions.tags.name = `${attrName}_tree`;
          }
        }

        return _;
      },

      GraphQLObjectType_fields(fields, build, context) {
        const ltreeInfo: LtreeExtensionInfo | undefined = (build as any).pgLtreeExtensionInfo;
        if (!ltreeInfo) return fields;

        const {
          scope: { isPgClassType, pgCodec: rawPgCodec },
          fieldWithHooks
        } = context;

        if (!isPgClassType || !rawPgCodec?.attributes) return fields;

        const codec = rawPgCodec as PgCodecWithAttributes;
        const { lambda } = build.grafast;

        let newFields = fields;

        for (const [attrName, attr] of Object.entries(codec.attributes as Record<string, any>)) {
          const attrCodec = attr?.codec;
          if (!attrCodec) continue;

          const isLtree =
            attrCodec.name === 'ltree' ||
            attrCodec.extensions?.pg?.name === 'ltree';
          if (!isLtree) continue;

          // The original column name becomes the folder field name
          const folderFieldName = build.inflection.camelCase(attrName);

          newFields = build.extend(
            newFields,
            {
              [folderFieldName]: fieldWithHooks(
                { fieldName: folderFieldName } as any,
                () => ({
                  description: `Slash-delimited path derived from the \`${attrName}\` ltree column. Example: \`/projects/alpha/docs\``,
                  type: GraphQLString,
                  plan($row: any) {
                    const $ltreeVal = $row.get(attrName);
                    return lambda($ltreeVal, (val: any) => {
                      if (val == null) return null;
                      const str = String(val);
                      if (str === '') return '/';
                      return '/' + str.replace(/\./g, '/');
                    });
                  }
                })
              )
            },
            `LtreeFolderFieldPlugin adding folder field '${folderFieldName}' for '${attrName}' on '${codec.name}'`
          );
        }

        return newFields;
      }
    }
  }
};
