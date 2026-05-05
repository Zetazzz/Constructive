# appLimitEvent

<!-- @constructive-io/graphql-codegen - DO NOT EDIT -->

Append-only log of limit events for historical reporting and audit

## Usage

```typescript
useAppLimitEventsQuery({ selection: { fields: { name: true, actorId: true, entityId: true, eventType: true, delta: true, numBefore: true, numAfter: true, maxAtEvent: true, reason: true } } })
useCreateAppLimitEventMutation({ selection: { fields: { id: true } } })
```

## Examples

### List all appLimitEvents

```typescript
const { data, isLoading } = useAppLimitEventsQuery({
  selection: { fields: { name: true, actorId: true, entityId: true, eventType: true, delta: true, numBefore: true, numAfter: true, maxAtEvent: true, reason: true } },
});
```

### Create a appLimitEvent

```typescript
const { mutate } = useCreateAppLimitEventMutation({
  selection: { fields: { id: true } },
});
mutate({ name: '<String>', actorId: '<UUID>', entityId: '<UUID>', eventType: '<String>', delta: '<BigInt>', numBefore: '<BigInt>', numAfter: '<BigInt>', maxAtEvent: '<BigInt>', reason: '<String>' });
```
