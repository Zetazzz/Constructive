# agentResourceChunk

<!-- @constructive-io/graphql-codegen - DO NOT EDIT -->

React Query hooks for AgentResourceChunk data operations

## Usage

```typescript
useAgentResourceChunksQuery({ selection: { fields: { id: true, agentResourceId: true, body: true, chunkIndex: true, embedding: true, metadata: true, createdAt: true, updatedAt: true, embeddingVectorDistance: true, searchScore: true } } })
useAgentResourceChunkQuery({ id: '<UUID>', selection: { fields: { id: true, agentResourceId: true, body: true, chunkIndex: true, embedding: true, metadata: true, createdAt: true, updatedAt: true, embeddingVectorDistance: true, searchScore: true } } })
useCreateAgentResourceChunkMutation({ selection: { fields: { id: true } } })
useUpdateAgentResourceChunkMutation({ selection: { fields: { id: true } } })
useDeleteAgentResourceChunkMutation({})
```

## Examples

### List all agentResourceChunks

```typescript
const { data, isLoading } = useAgentResourceChunksQuery({
  selection: { fields: { id: true, agentResourceId: true, body: true, chunkIndex: true, embedding: true, metadata: true, createdAt: true, updatedAt: true, embeddingVectorDistance: true, searchScore: true } },
});
```

### Create a agentResourceChunk

```typescript
const { mutate } = useCreateAgentResourceChunkMutation({
  selection: { fields: { id: true } },
});
mutate({ agentResourceId: '<UUID>', body: '<String>', chunkIndex: '<Int>', embedding: '<Vector>', metadata: '<JSON>', embeddingVectorDistance: '<Float>', searchScore: '<Float>' });
```
