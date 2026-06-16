/**
 * PostGraphile v5 Realtime Subscriptions Preset
 *
 * Provides a convenient preset for including realtime subscription support
 * in PostGraphile. Wraps the RealtimeSubscriptionsPlugin with options.
 */

import type { GraphileConfig } from 'graphile-config';
import type { RealtimeSubscriptionsPluginOptions } from './types';
import { createRealtimeSubscriptionsPlugin } from './plugin';

export function RealtimeSubscriptionsPreset(
  options: RealtimeSubscriptionsPluginOptions = {},
): GraphileConfig.Preset {
  return {
    plugins: [createRealtimeSubscriptionsPlugin(options)],
  } as GraphileConfig.Preset;
}

export default RealtimeSubscriptionsPreset;
