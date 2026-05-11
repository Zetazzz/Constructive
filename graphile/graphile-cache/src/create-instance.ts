import { createServer } from 'node:http';
import { Logger } from '@pgpmjs/logger';
import express from 'express';
import { postgraphile } from 'postgraphile';
import { grafserv } from 'grafserv/express/v4';
import type { Pool } from 'pg';
import type { WithPgClient, PgClient } from 'graphile-realtime-subscriptions';
import type { GraphileCacheEntry } from './graphile-cache';

const log = new Logger('graphile-cache:create');

interface GraphileInstanceOptions {
  preset: any;
  cacheKey: string;
  /**
   * When true, a RealtimeManager is created and started alongside the
   * PostGraphile instance.  Requires `pool` to be provided.
   */
  enableRealtime?: boolean;
  /**
   * The pg Pool used by this PostGraphile instance.
   * Required when `enableRealtime` is true so we can create a
   * `withPgClient` for cursor-tracking queries.
   */
  pool?: Pool;
}

/**
 * Create a simple withPgClient wrapper from a pg Pool.
 *
 * This satisfies the `WithPgClient` type expected by RealtimeManager
 * without pulling in @dataplan/pg adaptor code.
 */
function createWithPgClient(pool: Pool): WithPgClient {
  return async <T>(callback: (client: PgClient) => Promise<T>): Promise<T> => {
    const pgClient = await pool.connect();
    try {
      return await callback({
        query: <R = Record<string, unknown>>(sql: string, params?: unknown[]) =>
          pgClient.query(sql, params) as Promise<{ rows: R[] }>,
      });
    } finally {
      pgClient.release();
    }
  };
}

/**
 * Create a PostGraphile v5 instance backed by grafserv/express.
 *
 * This is the shared factory used by both graphql/server and graphql/explorer
 * to spin up a fully-initialised PostGraphile handler that fits into the
 * graphile-cache LRU cache.
 *
 * Callers are responsible for building the `GraphileConfig.Preset` (including
 * pgServices, grafserv options, grafast context, etc.) before passing it here.
 *
 * When `enableRealtime` is true and a `pool` is provided, a RealtimeManager
 * is created that bridges cursor-tracked events from `drain_changes()` into
 * the PostGraphile instance's PgSubscriber EventEmitter.
 */
export const createGraphileInstance = async (
  opts: GraphileInstanceOptions
): Promise<GraphileCacheEntry> => {
  const { preset, cacheKey, enableRealtime = false, pool } = opts;

  const pgl = postgraphile(preset);
  const serv = pgl.createServ(grafserv);

  const handler = express();
  const httpServer = createServer(handler);
  await serv.addTo(handler, httpServer);
  await serv.ready();

  const entry: GraphileCacheEntry = {
    pgl,
    serv,
    handler,
    httpServer,
    cacheKey,
    createdAt: Date.now(),
  };

  if (enableRealtime && pool) {
    try {
      const { RealtimeManager } = await import('graphile-realtime-subscriptions');

      // Extract PgSubscriber from the resolved preset's pgServices
      const resolvedPreset = pgl.getResolvedPreset();
      const pgSubscriber = (resolvedPreset as any).pgServices?.[0]?.pgSubscriber ?? null;

      if (!pgSubscriber) {
        log.warn(`PostGraphile[${cacheKey}] has no pgSubscriber — RealtimeManager will not be started`);
      } else {
        const withPgClient = createWithPgClient(pool);
        const manager = new RealtimeManager({
          pgSubscriber,
          withPgClient,
          nodeId: `graphile-cache:${cacheKey}`,
          schema: 'realtime_public',
        });

        await manager.start();
        entry.realtimeManager = manager;
        log.info(`RealtimeManager started for PostGraphile[${cacheKey}]`);
      }
    } catch (err) {
      log.error(`Failed to start RealtimeManager for PostGraphile[${cacheKey}]:`, err);
    }
  }

  return entry;
};
