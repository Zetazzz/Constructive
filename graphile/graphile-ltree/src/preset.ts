import type { GraphileConfig } from 'graphile-config';

import { createLtreeOperatorFactory } from './plugins/connection-filter-operators';
import { LtreeExtensionDetectionPlugin } from './plugins/detect-ltree';
import { LtreeFolderFieldPlugin } from './plugins/folder-field';
import { createFolderOperatorFactory } from './plugins/folder-filter-operators';
import { LtreeCodecPlugin } from './plugins/ltree-codec';

/**
 * GraphileLtreePreset
 *
 * Base preset: ltree codec, detection, and raw ltree operators.
 *
 * Operators on LTree fields: isAncestorOf, isDescendantOf, matchesGlob
 * (accept dot-delimited or slash-delimited paths)
 */
export const GraphileLtreePreset: GraphileConfig.Preset = {
  plugins: [
    LtreeExtensionDetectionPlugin,
    LtreeCodecPlugin
  ],
  schema: {
    connectionFilterOperatorFactories: [
      createLtreeOperatorFactory()
    ]
  } as GraphileConfig.Preset['schema'] & Record<string, unknown>
};

/**
 * GraphileFolderPreset
 *
 * Folder-oriented layer on top of the base ltree preset.
 *
 * Adds:
 * - Virtual `{column}Folder` fields with slash-delimited paths
 * - Folder operators: within, ancestorOf, glob (always slash-delimited)
 *
 * @example
 * ```graphql
 * allFiles(where: { path: { within: "/projects/alpha" } }) {
 *   nodes { pathFolder filename }
 * }
 * ```
 */
export const GraphileFolderPreset: GraphileConfig.Preset = {
  extends: [GraphileLtreePreset],
  plugins: [
    LtreeFolderFieldPlugin
  ],
  schema: {
    connectionFilterOperatorFactories: [
      createFolderOperatorFactory()
    ]
  } as GraphileConfig.Preset['schema'] & Record<string, unknown>
};

export default GraphileFolderPreset;
