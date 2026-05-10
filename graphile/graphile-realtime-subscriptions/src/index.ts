/**
 * Realtime Subscriptions Plugin for PostGraphile v5
 *
 * Adds per-table GraphQL subscription fields to tables tagged with @realtime.
 * Uses PostgreSQL LISTEN/NOTIFY for efficient event delivery with automatic
 * RLS enforcement on re-queries.
 *
 * @example
 * ```typescript
 * import { RealtimeSubscriptionsPreset } from 'graphile-realtime-subscriptions';
 *
 * const preset = {
 *   extends: [
 *     RealtimeSubscriptionsPreset(),
 *   ],
 * };
 * ```
 */

export { createRealtimeSubscriptionsPlugin, RealtimeSubscriptionsPlugin } from './plugin';
export { RealtimeSubscriptionsPreset } from './preset';
export type { RealtimeSubscriptionsPluginOptions } from './types';
