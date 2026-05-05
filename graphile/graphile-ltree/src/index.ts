/**
 * graphile-ltree — PostGraphile v5 ltree Plugin
 *
 * Two presets:
 *
 * - `GraphileLtreePreset` — base ltree operators (isAncestorOf, isDescendantOf, matchesGlob)
 * - `GraphileFolderPreset` — folder-oriented layer (within, ancestorOf, glob) + pathFolder fields
 *
 * @example
 * ```typescript
 * // For folder-style interface (recommended):
 * import { GraphileFolderPreset } from 'graphile-ltree';
 *
 * // For raw ltree operators only:
 * import { GraphileLtreePreset } from 'graphile-ltree';
 * ```
 */

// Presets
export { GraphileFolderPreset, GraphileLtreePreset } from './preset';

// Individual plugins
export type { LtreeExtensionInfo } from './plugins/detect-ltree';
export { LtreeExtensionDetectionPlugin } from './plugins/detect-ltree';
export { LtreeFolderFieldPlugin } from './plugins/folder-field';
export { LTREE_SCALAR_NAME, LtreeCodecPlugin } from './plugins/ltree-codec';

// Connection filter operator factories
export { createLtreeOperatorFactory } from './plugins/connection-filter-operators';
export { createFolderOperatorFactory } from './plugins/folder-filter-operators';
