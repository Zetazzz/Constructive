/**
 * ORM Realtime - WebSocket subscription manager
 *
 * This is the RUNTIME code that gets copied to generated output.
 * Provides the WebSocket connection manager and subscription types
 * for realtime subscriptions integrated into the ORM client.
 *
 * NOTE: This file is read at codegen time and written to output.
 * Any changes here will affect all generated ORM clients.
 */

// Minimal type shims for graphql-ws so that this module compiles
// without requiring graphql-ws to be installed.  The actual library
// is loaded lazily via require() inside the RealtimeManager
// constructor — consumers that never use subscriptions never need
// the package at all.

interface WsGraphQLError {
  readonly message: string;
  readonly [key: string]: unknown;
}

interface WsExecutionResult<TData = Record<string, unknown>> {
  data?: TData | null;
  errors?: readonly WsGraphQLError[];
  extensions?: Record<string, unknown>;
}

interface WsSink<T> {
  next(value: T): void;
  error(error: unknown): void;
  complete(): void;
}

interface WsClient {
  subscribe<TData = Record<string, unknown>>(
    payload: { query: string; variables?: Record<string, unknown> },
    sink: WsSink<WsExecutionResult<TData>>,
  ): () => void;
  dispose(): void;
}

interface WsClientOptions {
  url: string;
  lazy?: boolean;
  retryAttempts?: number;
  retryWait?: (retryCount: number) => Promise<void>;
  connectionParams?:
    | Record<string, unknown>
    | (() => Promise<Record<string, unknown>> | Record<string, unknown>);
  on?: {
    connecting?: () => void;
    connected?: () => void;
    closed?: (event: unknown) => void;
  };
}

// ============================================================================
// Types
// ============================================================================

/** The DML operation that triggered the subscription event */
export type SubscriptionOperation = 'INSERT' | 'UPDATE' | 'DELETE';

/** Connection state of the WebSocket */
export type ConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting';

/** Listener for connection state changes */
export type ConnectionStateListener = (state: ConnectionState) => void;

/** Function returned by subscribe() to cancel the subscription */
export type Unsubscribe = () => void;

/**
 * A realtime subscription event delivered to the client.
 *
 * @typeParam T - The row type of the subscribed table
 */
export interface SubscriptionEvent<T> {
  /** The DML operation that triggered this event */
  operation: SubscriptionOperation;
  /** The current row data (null for DELETE if row is no longer visible) */
  data: T | null;
  /** Previous field values (populated on UPDATE when available) */
  previousValues?: Partial<T>;
  /** Server-side timestamp of when the change occurred */
  timestamp: string;
}

/**
 * Options for creating a subscription.
 *
 * @typeParam T - The row type of the subscribed table
 * @typeParam TFilter - The filter type for the table
 */
export interface SubscribeOptions<
  T,
  TFilter = Record<string, unknown>,
> {
  /** Server-side filter to limit which events are delivered */
  filter?: TFilter;
  /** Called when a subscription event is received */
  onEvent: (event: SubscriptionEvent<T>) => void;
  /** Called when the subscription encounters an error */
  onError?: (error: Error) => void;
  /** Called when the subscription completes (server-initiated close) */
  onComplete?: () => void;
}

/**
 * Metadata about a subscription field, used internally to map
 * table names to GraphQL subscription field names and types.
 */
export interface SubscriptionFieldMeta {
  /** The GraphQL subscription field name (e.g., 'onContactChanged') */
  fieldName: string;
  /** The table name in the source schema (e.g., 'contact') */
  tableName: string;
  /** The data field name inside the subscription payload (e.g., 'contact') */
  dataFieldName: string;
}

/**
 * Configuration for the realtime (WebSocket) connection.
 * Pass this as the `realtime` option in OrmClientConfig.
 */
export interface RealtimeConfig {
  /** WebSocket endpoint URL (e.g., 'wss://api.example.com/graphql') */
  url: string;
  /**
   * Returns the current auth token. Called on connection init and
   * on reconnection so the client always sends a fresh token.
   */
  getToken?: () => string | Promise<string>;
  /**
   * Additional connection parameters sent during WebSocket handshake.
   * Merged with the authorization header from getToken().
   */
  connectionParams?: Record<string, unknown>;
  /**
   * Whether to connect lazily (on first subscribe) or eagerly.
   * @default true
   */
  lazy?: boolean;
  /**
   * Maximum number of reconnection attempts before giving up.
   * @default 5
   */
  retryAttempts?: number;
  /**
   * Delay between reconnection attempts in milliseconds,
   * or a function for custom backoff.
   * @default 1000
   */
  retryWait?: number | ((retryCount: number) => number | Promise<number>);
  /** Called when the WebSocket connection is established */
  onConnected?: () => void;
  /** Called when the WebSocket connection is closed */
  onDisconnected?: (reason?: unknown) => void;
}

// ============================================================================
// RealtimeManager
// ============================================================================

/**
 * Manages a single graphql-ws WebSocket connection and multiplexes
 * subscriptions over it. Created lazily by OrmClient when `realtime`
 * config is provided.
 */
export class RealtimeManager {
  private wsClient: WsClient;
  private connectionState: ConnectionState = 'disconnected';
  private stateListeners: Set<ConnectionStateListener> = new Set();
  private activeSubscriptions = 0;

  constructor(config: RealtimeConfig) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { createClient: createWsClient } = require('graphql-ws') as {
      createClient: (options: WsClientOptions) => WsClient;
    };

    const retryWait = async (retryCount: number): Promise<void> => {
      if (typeof config.retryWait === 'function') {
        const result = config.retryWait(retryCount);
        const ms = typeof result === 'number' ? result : await result;
        await new Promise<void>((resolve) => setTimeout(resolve, ms));
      } else {
        const base =
          typeof config.retryWait === 'number' ? config.retryWait : 1000;
        await new Promise<void>((resolve) =>
          setTimeout(resolve, base * Math.pow(2, retryCount)),
        );
      }
    };

    this.wsClient = createWsClient({
      url: config.url,
      lazy: config.lazy ?? true,
      retryAttempts: config.retryAttempts ?? 5,
      retryWait,
      connectionParams: async () => {
        const params: Record<string, unknown> = {
          ...config.connectionParams,
        };
        if (config.getToken) {
          const token = await config.getToken();
          params['authorization'] = `Bearer ${token}`;
        }
        return params;
      },
      on: {
        connecting: () => {
          const newState =
            this.connectionState === 'disconnected'
              ? 'connecting'
              : 'reconnecting';
          this.setConnectionState(newState);
        },
        connected: () => {
          this.setConnectionState('connected');
          config.onConnected?.();
        },
        closed: (event) => {
          this.setConnectionState('disconnected');
          config.onDisconnected?.(event);
        },
      },
    });
  }

  /**
   * Subscribe to a GraphQL subscription operation.
   * Models call this with typed metadata and documents.
   */
  subscribe<T>(
    meta: SubscriptionFieldMeta,
    document: string,
    variables: Record<string, unknown>,
    options: {
      onEvent: (event: SubscriptionEvent<T>) => void;
      onError?: (error: Error) => void;
      onComplete?: () => void;
    },
  ): Unsubscribe {
    this.activeSubscriptions++;
    let disposed = false;

    const cleanup = this.wsClient.subscribe<Record<string, unknown>>(
      { query: document, variables },
      {
        next: (result) => {
          if (disposed) return;
          if (result.errors) {
            options.onError?.(
              new Error(
                result.errors.map((e) => e.message).join('; '),
              ),
            );
            return;
          }

          const payload = result.data?.[meta.fieldName] as
            | { event?: string; [key: string]: unknown }
            | undefined;

          if (!payload) return;

          const event: SubscriptionEvent<T> = {
            operation:
              (payload.event as SubscriptionOperation) ?? 'UPDATE',
            data: (payload[meta.dataFieldName] as T) ?? null,
            previousValues: payload.previousValues as
              | Partial<T>
              | undefined,
            timestamp:
              (payload.timestamp as string) ?? new Date().toISOString(),
          };
          options.onEvent(event);
        },
        error: (err) => {
          if (disposed) return;
          options.onError?.(
            err instanceof Error ? err : new Error(String(err)),
          );
        },
        complete: () => {
          if (disposed) return;
          options.onComplete?.();
        },
      },
    );

    return () => {
      if (disposed) return;
      disposed = true;
      this.activeSubscriptions--;
      cleanup();
    };
  }

  /** Register a listener for connection state changes */
  onConnectionStateChange(listener: ConnectionStateListener): Unsubscribe {
    this.stateListeners.add(listener);
    return () => {
      this.stateListeners.delete(listener);
    };
  }

  /** Get current connection state */
  getConnectionState(): ConnectionState {
    return this.connectionState;
  }

  /** Number of active subscriptions */
  getActiveSubscriptionCount(): number {
    return this.activeSubscriptions;
  }

  /** Dispose the manager and close the WebSocket connection */
  dispose(): void {
    this.wsClient.dispose();
    this.stateListeners.clear();
    this.activeSubscriptions = 0;
    this.setConnectionState('disconnected');
  }

  private setConnectionState(state: ConnectionState): void {
    if (this.connectionState === state) return;
    this.connectionState = state;
    for (const listener of this.stateListeners) {
      listener(state);
    }
  }
}
