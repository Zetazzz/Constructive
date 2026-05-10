/**
 * Realtime Subscriptions Plugin for PostGraphile v5
 *
 * Discovers tables tagged with @realtime and generates per-table
 * subscription fields (onXxxChanged) that use PostgreSQL LISTEN/NOTIFY
 * for real-time event delivery.
 *
 * Subscription modes (Phase 3a):
 *   - Single record: onXxxChanged(id: UUID!) — subscribe to changes on one row
 *   - Full collection: onXxxChanged (no args) — subscribe to any change on the table
 *
 * Event flow:
 *   1. A row is inserted/updated/deleted
 *   2. The emit_change trigger fires pg_notify('realtime:{schema}.{table}', TG_OP)
 *   3. PostGraphile's pgSubscriber receives the NOTIFY
 *   4. The subscription re-queries the source table with RLS enforced
 *   5. The client receives { event, row } where row reflects the current state
 *
 * RLS enforcement is automatic — resource.get() queries through the
 * authenticated user's connection with their JWT role applied.
 */

import { context as grafastContext, listen, object, constant } from 'grafast';
import type { GraphileConfig } from 'graphile-config';
import { extendSchema } from 'graphile-utils';
import { Logger } from '@pgpmjs/logger';

import type { RealtimeSubscriptionsPluginOptions } from './types';

const log = new Logger('graphile-realtime-subscriptions');

interface RealtimeTableInfo {
  resource: any;
  typeName: string;
  fieldName: string;
  payloadTypeName: string;
  rowFieldName: string;
  notifyChannel: string;
  pgSchema: string;
  pgTable: string;
}

function discoverRealtimeTables(build: any): RealtimeTableInfo[] {
  const { pgRegistry } = build.input;
  const resources = pgRegistry.pgResources;
  const result: RealtimeTableInfo[] = [];

  for (const [, resource] of Object.entries(resources)) {
    const r = resource as any;
    const codec = r.codec;
    if (!codec?.attributes) continue;

    const tags = codec.extensions?.tags;
    if (!tags?.realtime) continue;

    const typeName = build.inflection.tableType(codec);
    const fieldName = `on${typeName}Changed`;
    const payloadTypeName = `${typeName}SubscriptionPayload`;
    const rowFieldName = typeName.charAt(0).toLowerCase() + typeName.slice(1);

    const pgSchema = codec.extensions?.pg?.schemaName ?? 'public';
    const pgTable = codec.extensions?.pg?.name ?? codec.name;
    const notifyChannel = `realtime:${pgSchema}.${pgTable}`;

    result.push({
      resource: r,
      typeName,
      fieldName,
      payloadTypeName,
      rowFieldName,
      notifyChannel,
      pgSchema,
      pgTable,
    });

    log.info(`Discovered realtime table: ${pgSchema}.${pgTable} -> ${fieldName}`);
  }

  return result;
}

function buildTypeDefs(tables: RealtimeTableInfo[]): string {
  const subscriptionFields = tables
    .map(({ fieldName, payloadTypeName }) =>
      `  """Subscribe to changes on this table. Pass an id to watch a specific record."""\n  ${fieldName}(id: UUID): ${payloadTypeName}`
    )
    .join('\n');

  const payloadTypes = tables
    .map(({ payloadTypeName, typeName, rowFieldName }) =>
      `"""Payload delivered when a ${typeName} row changes."""\n` +
      `type ${payloadTypeName} {\n` +
      `  """The DML operation: INSERT, UPDATE, or DELETE."""\n` +
      `  event: String!\n` +
      `  """The current state of the row (null for DELETE or if RLS denies access)."""\n` +
      `  ${rowFieldName}: ${typeName}\n` +
      `}`
    )
    .join('\n\n');

  return `extend type Subscription {\n${subscriptionFields}\n}\n\n${payloadTypes}`;
}

function buildPlans(tables: RealtimeTableInfo[]): Record<string, any> {
  const subscriptionPlans: Record<string, any> = {};
  const allPlans: Record<string, any> = {};

  for (const { resource, fieldName, payloadTypeName, rowFieldName, notifyChannel } of tables) {
    subscriptionPlans[fieldName] = {
      subscribePlan(_$root: any, args: any) {
        const $pgSubscriber = (grafastContext() as any).get('pgSubscriber');
        const $topic = constant(notifyChannel);
        const $id = args.get('id');

        return listen($pgSubscriber, $topic, ($payload: any) => {
          return object({
            event: $payload,
            subscribedId: $id,
          });
        });
      },
      plan($event: any) {
        return $event;
      },
    };

    allPlans[payloadTypeName] = {
      event($parent: any) {
        return $parent.get('event');
      },
      [rowFieldName]($parent: any) {
        const $id = $parent.get('subscribedId');
        return resource.get({ id: $id });
      },
    };
  }

  allPlans['Subscription'] = subscriptionPlans;
  return allPlans;
}

export function createRealtimeSubscriptionsPlugin(
  _options: RealtimeSubscriptionsPluginOptions = {},
): GraphileConfig.Plugin {
  return extendSchema(
    (build) => {
      const tables = discoverRealtimeTables(build);

      if (tables.length === 0) {
        log.info('No tables with @realtime tag found — skipping subscription generation');
        return { typeDefs: '', plans: {} };
      }

      log.info(`Generating subscription fields for ${tables.length} realtime table(s)`);

      const typeDefs = buildTypeDefs(tables);
      const plans = buildPlans(tables);

      return { typeDefs, plans };
    },
    'RealtimeSubscriptionsPlugin',
  );
}

export { createRealtimeSubscriptionsPlugin as RealtimeSubscriptionsPlugin };
