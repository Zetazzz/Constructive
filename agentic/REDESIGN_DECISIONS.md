# Agentic Kit Redesign Decisions

Date: 2026-04-18

This document records the redesign decisions made while evaluating `agentic-kit`
against the comparable `pi-mono` architecture, especially `packages/ai` and
`packages/agent`.

## Scope and Package Boundaries

1. `agentic-kit` remains the low-level provider portability layer.
2. Stateful orchestration moves into a separate `@agentic-kit/agent` package.
3. Tool execution stays out of `agentic-kit` core; the core only models tools,
   tool calls, and tool results.
4. `@agentic-kit/agent` v1 should be intentionally minimal, shipping only the
   sequential tool loop, lifecycle events, abort/continue, and pluggable context
   transforms. Steering/follow-up queues and richer interruption policies are
   deferred to phase 2.

## Core Type System

5. Core tool definitions use plain JSON Schema.
6. TypeBox/Zod support stays as helper adapters, not the core contract.
7. Core models are represented by a provider-independent `ModelDescriptor`
   registry with capability metadata.
8. The model registry must support both built-in descriptors and runtime
   registration of custom models/providers from day one.
9. The core message model treats `image` input and `thinking` output as
   first-class content blocks in v1.
10. `usage`, `cost`, `stopReason`, and abort-driven partial-result semantics are
    mandatory parts of the core contract in v1.

## Streaming and Conversation Semantics

11. Structured event streams become the primary streaming primitive; text-only
    chunk callbacks remain as convenience wrappers.
12. Cross-provider replay and handoff is a hard requirement for v1, including
    normalization for reasoning blocks, tool-call IDs, aborted turns, and
    orphaned tool results.

## Provider Strategy

13. OpenAI-compatible backends should be handled by one generalized adapter path
    with compatibility flags, not many first-class provider packages.
14. Embeddings stay out of the primary conversational core and live behind a
    separate optional capability interface or companion package.

## Migration Strategy

15. `agentic-kit` should ship a backward-compatibility layer for the current
    `generate({ model, prompt }, { onChunk })` API for one transition release.

## Architectural Implications

These decisions imply the following target architecture:

- `agentic-kit`
  Low-level portability layer. Owns message/content types, model descriptors,
  provider registry, streaming event protocol, compatibility transforms, usage,
  and provider adapters.
- `@agentic-kit/agent`
  Optional stateful runtime. Owns tool execution, sequential loop semantics,
  lifecycle events, context transforms, and abort/continue behavior.
- Separate optional capabilities or companion packages
  For non-conversational workloads such as embeddings, and optional schema
  helpers such as TypeBox/Zod integration.

## Design Principles Confirmed

- Keep the protocol portable and runtime-agnostic.
- Normalize provider differences in the core instead of leaking them upward.
- Treat OpenAI-compatible APIs as a compatibility class, not a brand-specific
  architecture.
- Avoid coupling the low-level layer to any single schema library or vendor SDK.
- Preserve a migration path from the existing text-only API while moving the
  real architecture to structured messages and events.
