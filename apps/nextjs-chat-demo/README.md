# nextjs-chat-demo

A Next.js 15 demo proving `agentic-kit` can replace `@ai-sdk/react` for the
dashboard chatbot. Demonstrates:

- streaming chat via `useChat` from `@agentic-kit/react`
- a plain server tool (`get_current_time`)
- a **pausable** server tool (`send_email`) — model proposes args, the UI shows
  Allow / Deny, the answer is fed back in via `respondWithDecision`, and the
  agent resumes server-side.

## Run

```bash
# from monorepo root
pnpm install

# point the demo at OpenAI
export OPENAI_API_KEY=sk-...

pnpm --filter nextjs-chat-demo dev
# open http://localhost:3001
```

## AI SDK → agentic-kit migration map

| Dashboard (AI SDK)                                 | This demo (agentic-kit)                                  |
| -------------------------------------------------- | -------------------------------------------------------- |
| `streamText` + `convertToModelMessages`            | `Agent.prompt()` / `continue()` + `handle.toResponse()`  |
| `tool({ needsApproval: true })`                    | `AgentTool.decision` JSON Schema                         |
| `addToolApprovalResponse({ id, approved })`        | `respondWithDecision(toolCallId, value)` (auto re-POST)  |
| `result.toUIMessageStreamResponse()`               | `handle.toResponse()`                                    |
| `useChat` from `@ai-sdk/react`                     | `useChat` from `@agentic-kit/react`                      |

## Out of scope

This demo deliberately does not port:

- mentions / @-suggestions
- multi-slot queue (`messageQueue`, `isFullySettled`, `sendAutomaticallyWhen`)
- task queue UI (`plan_tasks`, `complete_task`, `approve_previous_tool`)
- ask vs agent modes, settings menu
- FAB + portal placement
- history dropdown

These are dashboard UI sugar that sits on top of the SDK, not in it.

## Workspace dep wiring

`@agentic-kit/react`, `@agentic-kit/agent`, and `agentic-kit` packages declare
build outputs (`main: index.js`, `module: esm/index.js`) that don't exist on
disk in development. To consume them without a build step the demo combines:

- `tsconfig.json` `paths` map to `../../packages/*/src/index.ts`
- `next.config.mjs` `transpilePackages` so SWC compiles the TS source
- `experimental.externalDir` so Next is happy reading from outside the app dir

See [`PLAN.md`](./PLAN.md) for the full implementation plan and
[`GAPS.md`](./GAPS.md) for everything that felt rough to wire up.
