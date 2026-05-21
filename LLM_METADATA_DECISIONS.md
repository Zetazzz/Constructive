# LLM Call Metadata Decisions

Date: 2026-05-21

Companion to [`REDESIGN_DECISIONS.md`](./REDESIGN_DECISIONS.md). Records the design
choices behind the token-usage / cost / call-metadata surface that billing and
metering consumers depend on. Append-only — each new decision gets the next
number; older entries stay as-is even when superseded (superseding entries
explicitly reference the entry they replace).

Tracking issue: [constructive-planning #907](https://github.com/constructive-io/constructive-planning/issues/907).

## Usage shape

1. **Reasoning is a subset of `output`, not a sibling.** `output` keeps the
   `completion_tokens` value the provider reports (which already includes
   reasoning per OpenAI's wire contract), and `reasoning` is exposed as a
   separate read-only count. The `totalTokens` invariant remains
   `input + output + cacheRead + cacheWrite` — adding `reasoning` to the total
   would double-count, since the provider already folded it into
   `completion_tokens` upstream. Billing derives pure-completion tokens as
   `output - reasoning` when it needs a separate rate.

2. **Anthropic `reasoning` stays zero.** The Anthropic Messages API does not
   expose a reasoning-token count even when extended thinking is on; the cost
   of thinking blocks is server-side folded into `output_tokens`. We do not
   fabricate a value or estimate from thinking-content character counts.

3. **Ollama `reasoning` stays zero.** Ollama's native API reports only
   `prompt_eval_count` and `eval_count`; there is no reasoning breakdown.
   Same policy as Anthropic — leave the field at zero rather than guess.

4. **No OpenAI-named alias fields on `Usage`.** The canonical shape stays
   `input` / `output` / `reasoning` / `cacheRead` / `cacheWrite` /
   `totalTokens`. Billing and downstream consumers translate at the boundary
   (`prompt_tokens → input`, `completion_tokens → output`,
   `reasoning_tokens → reasoning`, `total_tokens → totalTokens`, plus the
   cache fields). Adding aliases would either duplicate state or invite drift.

5. **No separate cost rate for reasoning tokens.** Reasoning cost is folded
   into the output rate via `model.cost.output`. Every model we currently ship
   prices reasoning at the same rate as output. Add a `model.cost.reasoning`
   schedule field only when we onboard a model that prices reasoning
   separately.

## Aggregation surface

6. **Cumulative usage lives on `AgentState.totalUsage` and on the
   `agent_end` and `turn_end` events.** Reset on `prompt()`, preserved across
   `continue()` — matching `stepCount` semantics. Consumers should not have
   to re-walk `messages[]` to derive a sum we already compute. Per-message
   usage remains accessible at `messages[i].usage`.

7. **`useChat` exposes a single `usage` field (cumulative).** The React hook
   surfaces `usage: Usage | null`, populated from `turn_end`/`agent_end`
   events and reset to `null` on each new `prompt()`. Advanced consumers can
   still inspect per-message usage by walking `messages`.

## Provider implementation

8. **Each provider package is standalone — no runtime dependency on
   `agentic-kit` core.** `packages/anthropic`, `packages/openai`, and
   `packages/ollama` each inline their own copies of the shared types
   (`Usage`, `Message`, `ModelDescriptor`, etc.) and their own
   `calculateUsageCost` helper. This is deliberate: provider packages must
   be drop-in usable without pulling the agentic-kit hub. Sync between the
   canonical type in `packages/agentic-kit/src/types.ts` and the per-provider
   copies is a maintenance cost we accept. Any change to `Usage` must land in
   all four locations. Earlier plan drafts proposed lifting
   `calculateUsageCost` to the shared package and importing it everywhere —
   that proposal is rejected here. (Only `packages/agent` depends on
   `agentic-kit`; it imports `addUsage` from the hub for cumulative-usage
   accumulation.)

9. **Ollama calls a local `calculateUsageCost` on the final payload.** Prior
   to this change, the Ollama adapter set `usage.input`/`usage.output`/
   `totalTokens` but never invoked any cost calculator — so `cost.total`
   stayed at zero even when `model.cost` was populated. Fixed by adding a
   local `calculateUsageCost` helper (mirroring the ones in
   `packages/anthropic` and `packages/openai`) and calling it in
   `processPayload` after token counts are assigned.

10. **OpenAI no longer double-counts `reasoning_tokens` into `output`.**
    Previously, `applyUsage` did
    `output = completion_tokens + reasoning_tokens` — but
    `completion_tokens` already includes reasoning per OpenAI's contract.
    Now: `output = completion_tokens`, `reasoning = reasoning_tokens`.

11. **OpenAI `totalTokens` fallback includes `cacheWrite`.** Prior fallback
    was `prompt_tokens ?? (input + output + cacheRead)` — missing `cacheWrite`.
    Currently a no-op for stock OpenAI (which doesn't emit cache writes), but
    breaks the invariant for OpenAI-compatible endpoints (OpenRouter) that
    do.

12. **OpenRouter `prompt_tokens_details.cache_write_tokens` ingestion is
    deferred.** No billing consumer currently asks for it. When a consumer
    materializes, we add the read in `applyUsage` and the cost rate in the
    relevant model descriptor — both small. Tracking under #907 follow-up.

## Streaming and abort semantics

13. **Anthropic writes `usage.input` at `message_start`, and overwrites on
    `message_delta`.** This is intentional: it ensures input-token counts
    survive an early stream abort (caller has the input cost even if the
    completion never finishes). OpenAI providers only emit usage at the
    terminal chunk, so an aborted OpenAI stream yields all-zero usage; this
    is a provider-API limit, not something we paper over.

## Out of scope (deferred, not declined)

14. **Service-tier cost multipliers (OpenAI Responses API
    `flex`/`priority`).** Not on the agentic-kit roadmap until we add the
    Responses-API adapter. Pi-mono applies these as a post-hoc multiplier
    on `usage.cost.*`; we'll follow the same pattern when needed.

15. **Audio-token counts.** No consumer; add when speech I/O lands.

16. **Per-session persistence / write-through to a database.** Billing's
    consumer pulls from the event stream; storage is downstream of this
    package's concern.

17. **`totalUsage` on event emits is a shallow snapshot, not a live reference.**
    The `turn_end` and `agent_end` events attach
    `{ ...this._state.totalUsage, cost: { ...this._state.totalUsage.cost } }`
    rather than the mutable state object directly. Why: `agent_end` already
    does `[...this._state.messages]` (a shallow array copy) for the same
    reason — listeners receive a stable value that won't change if the agent
    continues running. `Usage` is a two-level object (`cost` is a nested
    object literal), so the copy must be two levels deep. A full deep clone
    (`JSON.parse(JSON.stringify(...))`) was rejected as overkill for a flat
    numeric object; `structuredClone` was rejected as unnecessary verbosity
    for the same reason. Downstream SSE serialisation (which JSON-serialises
    the event anyway) would have made a live reference safe in practice, but
    the shallow-copy convention is consistent with the `messages` precedent
    and makes the event contract independent of the serialisation path.

18. **`useChat` resets `usage` at the start of `runStream`, not at the
    `send` / `sendMessages` / `respondWithDecision` call sites.** All three
    entry-points flow through `runStream`, so the reset is centralised there.
    This avoids three separate call-site edits and ensures the reset fires
    unconditionally for every new request — including decision-resume
    requests via `respondWithDecision`. Mirrors the agent-side rule from
    decision #6 (reset on each new request, not on `continue()`).
