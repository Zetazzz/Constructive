/**
 * Configuration options for the Realtime Subscriptions Plugin.
 */
export interface RealtimeSubscriptionsPluginOptions {
  /**
   * Maximum number of events per table per second before switching to
   * overflow (INVALIDATE) mode. When exceeded, the subscription sends
   * a single { event: 'INVALIDATE', overflow: true } instead of
   * individual row events, signaling the client to refetch.
   *
   * Default: 50
   */
  overflowThreshold?: number;
}
