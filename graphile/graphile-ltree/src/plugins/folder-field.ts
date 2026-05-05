import 'graphile-build';
import 'graphile-build-pg';

import type { PgCodecWithAttributes } from '@dataplan/pg';
import type { GraphileConfig } from 'graphile-config';
import { GraphQLString } from 'graphql';

import type { LtreeExtensionInfo } from './detect-ltree';

/**
 * LtreeFolderFieldPlugin
 *
 * For every ltree column on every table, adds a virtual `{column}Folder`
 * field that returns the slash-delimited path.
 *
 * Example:
 *   column `path` (ltree) -> field `pathFolder` (String)
 *   'projects.alpha.docs' -> '/projects/alpha/docs'
 */
export const LtreeFolderFieldPlugin: GraphileConfig.Plugin = {
  name: 'LtreeFolderFieldPlugin',
  version: '1.0.0',
  description: 'Adds virtual folder fields for ltree columns',
  after: ['LtreeExtensionDetectionPlugin', 'LtreeCodecPlugin', 'PgAttributesPlugin'],

  schema: {
    hooks: {
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

          const fieldName = build.inflection.camelCase(`${attrName}_folder`);

          newFields = build.extend(
            newFields,
            {
              [fieldName]: fieldWithHooks(
                { fieldName } as any,
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
            `LtreeFolderFieldPlugin adding folder field '${fieldName}' for '${attrName}' on '${codec.name}'`
          );
        }

        return newFields;
      }
    }
  }
};
