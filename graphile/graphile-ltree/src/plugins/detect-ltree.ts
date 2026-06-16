import 'graphile-build';
import 'graphile-build-pg';

import type { PgCodec } from '@dataplan/pg';
import type { GraphileConfig } from 'graphile-config';

export interface LtreeExtensionInfo {
  ltreeCodec: PgCodec;
  lqueryCodec: PgCodec | null;
}

function isLtreeCodec(codec: any): boolean {
  return (
    codec?.name === 'ltree' ||
    codec?.extensions?.pg?.name === 'ltree'
  );
}

function isLqueryCodec(codec: any): boolean {
  return (
    codec?.name === 'lquery' ||
    codec?.extensions?.pg?.name === 'lquery'
  );
}

/**
 * LtreeExtensionDetectionPlugin
 *
 * Detects ltree presence in the database by searching for ltree/lquery
 * codecs in the pgRegistry. Stores detected info on the build object
 * for downstream plugins.
 *
 * Gracefully degrades if ltree is not installed.
 */
export const LtreeExtensionDetectionPlugin: GraphileConfig.Plugin = {
  name: 'LtreeExtensionDetectionPlugin',
  version: '1.0.0',
  description: 'Detects ltree extension in the database',

  schema: {
    hooks: {
      build(build) {
        const pgRegistry = build.input?.pgRegistry;
        if (!pgRegistry) {
          return build;
        }

        let ltreeCodec: PgCodec | null = null;
        let lqueryCodec: PgCodec | null = null;

        for (const codec of Object.values(pgRegistry.pgCodecs)) {
          if (isLtreeCodec(codec)) {
            ltreeCodec = codec;
          } else if (isLqueryCodec(codec)) {
            lqueryCodec = codec;
          }
        }

        if (!ltreeCodec) {
          return build;
        }

        const ltreeInfo: LtreeExtensionInfo = {
          ltreeCodec,
          lqueryCodec
        };

        return build.extend(
          build,
          { pgLtreeExtensionInfo: ltreeInfo },
          'LtreeExtensionDetectionPlugin adding ltree build state'
        );
      }
    }
  }
};
