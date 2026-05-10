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

/**
 * A minimal PostgreSQL client interface used by CursorTracker.
 * Compatible with node-postgres (pg) Client or PoolClient.
 */
export interface PgClient {
  query<R = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: R[] }>;
}

/**
 * Callback that provides a PgClient for executing queries.
 * The client is released after the callback returns.
 */
export type WithPgClient = <T>(
  callback: (client: PgClient) => Promise<T>,
) => Promise<T>;

/**
 * A single entry from drain_changes(), representing a change_log row
 * matched against subscriber tables.
 */
export interface ChangeLogEntry {
  id: string;
  occurred_at: string;
  source_schema: string;
  source_table: string;
  operation: string;
  payload_after: Record<string, unknown> | null;
  payload_before: Record<string, unknown> | null;
  payload_diff: Record<string, unknown> | null;
  subscriber_ids: string[];
}

/**
 * Configuration for the CursorTracker background poller.
 */
export interface CursorTrackerOptions {
  /**
   * Unique identifier for this listener node.
   * Should be stable across restarts if you want cursor continuity.
   * If not provided, a random ID is generated (ephemeral mode).
   */
  nodeId?: string;

  /**
   * The realtime_public schema name where drain_changes(),
   * touch_listener(), and cleanup_ephemeral() live.
   *
   * Default: 'realtime_public'
   */
  schema?: string;

  /**
   * How often to poll drain_changes() for new events (milliseconds).
   *
   * Default: 5000 (5 seconds)
   */
  pollIntervalMs?: number;

  /**
   * How often to send a heartbeat via touch_listener() (milliseconds).
   *
   * Default: 30000 (30 seconds)
   */
  heartbeatIntervalMs?: number;

  /**
   * Maximum number of change_log rows to fetch per drain_changes() call.
   *
   * Default: 500
   */
  batchLimit?: number;

  /**
   * Function to acquire a PgClient for executing queries.
   * The cursor tracker calls this for every poll and heartbeat cycle.
   */
  withPgClient: WithPgClient;

  /**
   * Called when drain_changes() returns new change_log entries.
   * The entries include subscriber_ids for fan-out routing.
   */
  onChanges?: (entries: ChangeLogEntry[]) => void;

  /**
   * Called when an error occurs during polling, heartbeat, or cleanup.
   * If not provided, errors are logged to the console.
   */
  onError?: (error: Error) => void;
}

/**
 * Configuration for the RealtimeManager, which bridges CursorTracker
 * events into PostGraphile's PgSubscriber for at-least-once delivery.
 */
export interface RealtimeManagerOptions {
  /**
   * The PgSubscriber instance from PostGraphile's context.
   * RealtimeManager emits cursor-tracked events on its internal EventEmitter
   * so they flow through existing subscription plans.
   */
  pgSubscriber: unknown;

  /**
   * Function to acquire a PgClient for executing cursor tracking queries.
   */
  withPgClient: WithPgClient;

  /**
   * Unique identifier for this listener node.
   * Should be stable across restarts if you want cursor continuity.
   * If not provided, a random ID is generated (ephemeral mode).
   */
  nodeId?: string;

  /**
   * The realtime_public schema name where drain_changes(),
   * touch_listener(), and cleanup_ephemeral() live.
   *
   * Default: 'realtime_public'
   */
  schema?: string;

  /**
   * How often to poll drain_changes() for new events (milliseconds).
   *
   * Default: 5000 (5 seconds)
   */
  pollIntervalMs?: number;

  /**
   * How often to send a heartbeat via touch_listener() (milliseconds).
   *
   * Default: 30000 (30 seconds)
   */
  heartbeatIntervalMs?: number;

  /**
   * Maximum number of change_log rows to fetch per drain_changes() call.
   *
   * Default: 500
   */
  batchLimit?: number;

  /**
   * Called when an error occurs during polling, heartbeat, or cleanup.
   * If not provided, errors are logged via @pgpmjs/logger.
   */
  onError?: (error: Error) => void;
}
