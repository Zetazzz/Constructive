# graphile-realtime-test

Subscription testing utilities for `graphile-realtime-subscriptions`.

Provides smart tag injection, `grafast.subscribe()` helpers, and `pg_notify` simulation for integration testing realtime GraphQL subscriptions against a real PostgreSQL database.

## Usage

```typescript
import { createRealtimeTestContext, waitForEvent } from 'graphile-realtime-test';
import { seed } from 'pgsql-test';

const ctx = await createRealtimeTestContext(
  {
    schemas: ['my_schema'],
    realtimeTables: ['items'],
    useRoot: true,
    authRole: 'postgres',
  },
  [seed.sqlfile(['./seed.sql'])]
);

// Start a subscription
const iterator = await ctx.subscribe(`
  subscription {
    onItemChanged {
      event
      rowId
      overflow
    }
  }
`);

// Fire a NOTIFY
await ctx.notifyChange('items', 'INSERT', ['some-uuid']);

// Assert the event
const event = await waitForEvent(iterator);
expect(event.data.onItemChanged.event).toBe('INSERT');

// Clean up
await iterator.return?.();
await ctx.teardown();
```

## API

### `createRealtimeTestContext(input, seedAdapters?)`

Creates a fully wired test context with schema, subscriptions, and NOTIFY helpers.

### `makeRealtimeSmartTagsPlugin(tagsByTable)`

Creates a Graphile plugin that injects smart tags on table codecs during schema build.

### `subscribe(opts)`

Calls `grafast.subscribe()` and returns the raw async iterator.

### `waitForEvent(iterator, timeoutMs?)`

Waits for the next event from a subscription iterator with a timeout.

### `collectEvents(iterator, count, timeoutMs?)`

Collects multiple events from a subscription iterator.

### `notify(client, schema, table, payload)`

Fires a raw `pg_notify` on a realtime channel.

### `notifyChange(client, schema, table, operation, rowIds)`

Fires a DML NOTIFY with the standard payload format.

### `notifyInvalidate(client, schema, table)`

Fires an INVALIDATE (overflow) NOTIFY.

### `buildPayload(operation, rowIds)`

Builds a standard DML payload string.

### `buildInvalidatePayload()`

Returns the `"INVALIDATE"` payload string.
