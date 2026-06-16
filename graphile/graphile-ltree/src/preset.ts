import type { GraphileConfig } from 'graphile-config';

import { LtreeExtensionDetectionPlugin } from './plugins/detect-ltree';
import { createFolderOperatorFactory } from './plugins/folder-filter-operators';
import { LtreeCodecPlugin } from './plugins/ltree-codec';

/**
 * GraphileLtreePreset
 *
 * Full ltree support with file-path syntax.
 *
 * - LTree scalar auto-converts between slash-delimited file paths (API) and
 *   dot-delimited ltree (DB). External API always uses "/projects/alpha/docs".
 * - Filter operators: within, ancestorOf, glob (all accept slash-delimited paths)
 *
 * @example
 * ```graphql
 * allFiles(where: { path: { within: "/projects/alpha" } }) {
 *   nodes { path filename }
 * }
 * ```
 */
export const GraphileLtreePreset: GraphileConfig.Preset = {
  plugins: [
    LtreeExtensionDetectionPlugin,
    LtreeCodecPlugin
  ],
  schema: {
    connectionFilterOperatorFactories: [
      createFolderOperatorFactory()
    ]
  } as GraphileConfig.Preset['schema'] & Record<string, unknown>
};

/**
 * @deprecated Use GraphileLtreePreset instead. The folder field plugin is no
 * longer needed — the LTree scalar now handles slash↔ltree conversion directly.
 */
export const GraphileFolderPreset: GraphileConfig.Preset = GraphileLtreePreset;

export default GraphileLtreePreset;
