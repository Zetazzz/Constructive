# Shared test helpers

Repo-internal helpers for unit tests. Imported via the `@test/*` tsconfig path
alias (see each package's `__tests__/tsconfig.json` and `jest.config.js`).
Not a workspace package, not published.

## Helpers

- `makeFakeModel(overrides?)` — `ModelDescriptor` with sane defaults.
- `makeFakeAssistantMessage(overrides?)` — `AssistantMessage` with zero usage and stop reason.
- `createScriptedProvider({ responses })` — `ProviderAdapter` that emits a derived event sequence per `AssistantMessage` in `responses` on successive `stream()` calls. `stopReason` of `error` or `aborted` produces an `error` terminal event; otherwise `done`.
- `createScriptedSSEResponse(events)` — `Response` whose body serializes each `AgentEvent` as one SSE frame (`data: <json>\n\n`).
- `parseSSEStream(stream)` — async iterable that parses `AgentEvent` SSE frames from a `ReadableStream<Uint8Array>`. Handles split chunks, multi-line `data:`, comment lines, event-type framing, trailing newlines, and mid-event abort (incomplete trailing event is dropped, per SSE spec).

## Adding a helper

Promote a helper to `tools/test/` only when a third package needs the same
idiom. Duplication of a 30-line scripted helper across two packages is fine;
duplicating across three is the trigger for promotion.
