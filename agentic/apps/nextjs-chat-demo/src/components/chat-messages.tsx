'use client';

import type { ToolDecisionPendingEvent } from '@agentic-kit/react';
import type { AssistantMessage, Message } from 'agentic-kit';
import { useEffect, useRef } from 'react';

import { cn } from '@/lib/cn';

import { ToolApprovalCard } from './tool-approval-card';
import { ToolCallCard } from './tool-call-card';

interface ChatMessagesProps {
  messages: Message[];
  streamingMessage: AssistantMessage | null;
  pendingDecisions: ReadonlyMap<string, ToolDecisionPendingEvent>;
  executingToolCallIds: ReadonlySet<string>;
  respondWithDecision: (toolCallId: string, value: unknown) => Promise<void>;
  isStreaming: boolean;
}

export function ChatMessages({
  messages,
  streamingMessage,
  pendingDecisions,
  executingToolCallIds,
  respondWithDecision,
  isStreaming,
}: ChatMessagesProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [messages, streamingMessage, isStreaming]);

  const toolResultsByCallId = new Map<
    string,
    Extract<Message, { role: 'toolResult' }>
  >();
  for (const m of messages) {
    if (m.role === 'toolResult') {
      toolResultsByCallId.set(m.toolCallId, m);
    }
  }

  return (
    <div
      ref={scrollRef}
      className="flex-1 overflow-y-auto rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900"
    >
      {messages.length === 0 && !streamingMessage ? (
        <p className="text-sm text-zinc-500">No messages yet. Ask the assistant something.</p>
      ) : null}

      <ul className="flex flex-col gap-3">
        {messages.map((m, idx) => {
          if (m.role === 'toolResult') return null;
          if (m.role === 'user') {
            return (
              <li key={idx} className="flex justify-end">
                <div className="max-w-[80%] rounded-2xl bg-blue-600 px-3 py-2 text-sm text-white">
                  {typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}
                </div>
              </li>
            );
          }
          if (m.role === 'assistant') {
            return (
              <li key={idx} className="flex justify-start">
                <div className="flex max-w-[85%] flex-col gap-2">
                  <AssistantMessageBody
                    message={m}
                    toolResultsByCallId={toolResultsByCallId}
                    pendingDecisions={pendingDecisions}
                    executingToolCallIds={executingToolCallIds}
                    respondWithDecision={respondWithDecision}
                  />
                </div>
              </li>
            );
          }
          return null;
        })}
        {streamingMessage ? (
          <li className="flex justify-start">
            <div className="flex max-w-[85%] flex-col gap-2">
              <AssistantMessageBody
                message={streamingMessage}
                toolResultsByCallId={toolResultsByCallId}
                pendingDecisions={pendingDecisions}
                executingToolCallIds={executingToolCallIds}
                respondWithDecision={respondWithDecision}
              />
            </div>
          </li>
        ) : null}
        {isStreaming && !streamingMessage ? (
          <li className="flex justify-start">
            <div className="rounded-2xl bg-zinc-100 px-3 py-2 text-xs text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
              thinking…
            </div>
          </li>
        ) : null}
      </ul>
    </div>
  );
}

interface AssistantMessageBodyProps {
  message: AssistantMessage;
  toolResultsByCallId: Map<string, Extract<Message, { role: 'toolResult' }>>;
  pendingDecisions: ReadonlyMap<string, ToolDecisionPendingEvent>;
  executingToolCallIds: ReadonlySet<string>;
  respondWithDecision: (toolCallId: string, value: unknown) => Promise<void>;
}

function AssistantMessageBody({
  message,
  toolResultsByCallId,
  pendingDecisions,
  executingToolCallIds,
  respondWithDecision,
}: AssistantMessageBodyProps) {
  return (
    <>
      {message.content.map((block, i) => {
        if (block.type === 'text') {
          return (
            <div
              key={i}
              className={cn(
                'rounded-2xl bg-zinc-100 px-3 py-2 text-sm text-zinc-900',
                'dark:bg-zinc-800 dark:text-zinc-100'
              )}
            >
              {block.text}
            </div>
          );
        }
        if (block.type === 'toolCall') {
          const result = toolResultsByCallId.get(block.id);
          const needsDecision =
            pendingDecisions.has(block.id) &&
            !result &&
            (!('decision' in block) || block.decision === undefined);
          const isExecuting = executingToolCallIds.has(block.id);
          return (
            <div key={i} className="flex flex-col gap-2">
              <ToolCallCard
                name={block.name}
                args={block.arguments as Record<string, unknown>}
                result={result}
                isExecuting={isExecuting}
              />
              {needsDecision ? (
                <ToolApprovalCard
                  toolName={block.name}
                  args={block.arguments as Record<string, unknown>}
                  onAllow={() =>
                    void respondWithDecision(block.id, { approved: true })
                  }
                  onDeny={() =>
                    void respondWithDecision(block.id, { approved: false })
                  }
                />
              ) : null}
            </div>
          );
        }
        return null;
      })}
    </>
  );
}
