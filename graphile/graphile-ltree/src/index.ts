/**
 * graphile-ltree — PostGraphile v5 ltree Plugin
 *
 * Auto-detects ltree columns, exposes slash-path folder fields,
 * and provides containment/glob filter operators for hierarchical data.
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

// Preset (recommended entry point)
export { GraphileLtreePreset } from './preset';

// Individual plugins
export type { LtreeExtensionInfo } from './plugins/detect-ltree';
export { LtreeExtensionDetectionPlugin } from './plugins/detect-ltree';
export { LtreeFolderFieldPlugin } from './plugins/folder-field';
export { LTREE_SCALAR_NAME,LtreeCodecPlugin } from './plugins/ltree-codec';

// Connection filter operator factory
export { createLtreeOperatorFactory } from './plugins/connection-filter-operators';
