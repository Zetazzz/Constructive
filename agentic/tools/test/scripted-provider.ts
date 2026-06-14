import {
  type AssistantMessage,
  type AssistantMessageEvent,
  createAssistantMessageEventStream,
  type ModelDescriptor,
  type ProviderAdapter,
} from 'agentic-kit';

import { makeFakeAssistantMessage, makeFakeModel } from './fixtures';

export interface ScriptedProviderOptions {
  responses: AssistantMessage[];
  delayMs?: number;
  api?: string;
  provider?: string;
}

export function createScriptedProvider(opts: ScriptedProviderOptions): ProviderAdapter {
  const api = opts.api ?? 'fake-api';
  const provider = opts.provider ?? 'fake';
  let callIndex = 0;

  return {
    api,
    provider,
    createModel: (modelId: string, overrides?: Partial<ModelDescriptor>) =>
      makeFakeModel({ id: modelId, api, provider, ...overrides }),
    stream: () => {
      const stream = createAssistantMessageEventStream();
      const message =
        opts.responses[callIndex++] ??
        makeFakeAssistantMessage({
          api,
          provider,
          stopReason: 'error',
          errorMessage: 'scripted provider: no response queued for this call',
          content: [],
        });

      const events = deriveEventSequence(message);
      const emit = () => {
        for (const event of events) {
          stream.push(event);
        }
        stream.end(message);
      };

      if (opts.delayMs && opts.delayMs > 0) {
        setTimeout(emit, opts.delayMs);
      } else {
        queueMicrotask(emit);
      }

      return stream;
    },
  };
}

function deriveEventSequence(message: AssistantMessage): AssistantMessageEvent[] {
  const events: AssistantMessageEvent[] = [];
  events.push({ type: 'start', partial: message });

  for (let i = 0; i < message.content.length; i++) {
    const block = message.content[i];
    if (block.type === 'text') {
      events.push({ type: 'text_start', contentIndex: i, partial: message });
      if (block.text.length > 0) {
        events.push({
          type: 'text_delta',
          contentIndex: i,
          delta: block.text,
          partial: message,
        });
      }
      events.push({
        type: 'text_end',
        contentIndex: i,
        content: block.text,
        partial: message,
      });
    } else if (block.type === 'thinking') {
      events.push({ type: 'thinking_start', contentIndex: i, partial: message });
      if (block.thinking.length > 0) {
        events.push({
          type: 'thinking_delta',
          contentIndex: i,
          delta: block.thinking,
          partial: message,
        });
      }
      events.push({
        type: 'thinking_end',
        contentIndex: i,
        content: block.thinking,
        partial: message,
      });
    } else if (block.type === 'toolCall') {
      events.push({ type: 'toolcall_start', contentIndex: i, partial: message });
      events.push({
        type: 'toolcall_end',
        contentIndex: i,
        toolCall: block,
        partial: message,
      });
    }
  }

  if (message.stopReason === 'error' || message.stopReason === 'aborted') {
    events.push({ type: 'error', reason: message.stopReason, error: message });
  } else {
    events.push({ type: 'done', reason: message.stopReason, message });
  }

  return events;
}
