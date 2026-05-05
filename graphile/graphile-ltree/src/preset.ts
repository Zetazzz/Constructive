import type { GraphileConfig } from 'graphile-config';

import { createLtreeOperatorFactory } from './plugins/connection-filter-operators';
import { LtreeExtensionDetectionPlugin } from './plugins/detect-ltree';
import { LtreeFolderFieldPlugin } from './plugins/folder-field';
import { LtreeCodecPlugin } from './plugins/ltree-codec';

/**
 * GraphileLtreePreset
 *
 * A preset that includes all ltree plugins for PostGraphile v5.
 *
 * Includes:
 * - Ltree extension auto-detection (scans pgRegistry for ltree codecs)
 * - Ltree codec plugin (registers Ltree scalar, maps ltree/lquery types)
 * - Folder field plugin (virtual {column}Folder fields with slash paths)
 * - Connection filter operators (isAncestorOf, isDescendantOf, matchesGlob)
 *
 * @example
 * ```typescript
 * import { GraphileLtreePreset } from 'graphile-ltree';
 *
 * const preset = {
 *   extends: [GraphileLtreePreset]
 * };
 * ```
 */
export const GraphileLtreePreset: GraphileConfig.Preset = {
  plugins: [
    LtreeExtensionDetectionPlugin,
    LtreeCodecPlugin,
    LtreeFolderFieldPlugin
  ],
  schema: {
    connectionFilterOperatorFactories: [
      createLtreeOperatorFactory()
    ]
  } as GraphileConfig.Preset['schema'] & Record<string, unknown>
};

export default GraphileLtreePreset;
