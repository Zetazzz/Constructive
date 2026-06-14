import { useCallback, useRef, useState } from 'react';

import { type ChatProvider, type Context,resolveModel, stream } from './kit-client';
import { splitThinking } from './thinking';

export type UIMessage = {
  id: string
  role: 'user' | 'assistant'
  text: string
  thinking?: string
  streaming?: boolean
  error?: string
}

type SendArgs = {
  provider: ChatProvider
  modelId: string
  systemPrompt: string
  openaiKey: string
}

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

export function useChat() {
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const rawBufRef = useRef<Map<string, string>>(new Map());
  const nativeThinkRef = useRef<Map<string, string>>(new Map());

  const send = useCallback(
    async (text: string, args: SendArgs) => {
      const trimmed = text.trim();
      if (!trimmed || isStreaming) return;

      const model = resolveModel(args.provider, args.modelId);
      if (!model) {
        setError(`Model ${args.provider}/${args.modelId} is not registered.`);
        return;
      }

      setError(null);
      const userMsg: UIMessage = { id: uid(), role: 'user', text: trimmed };
      const assistantId = uid();
      const assistantMsg: UIMessage = {
        id: assistantId,
        role: 'assistant',
        text: '',
        streaming: true,
      };

      const nextMessages = [...messages, userMsg, assistantMsg];
      setMessages(nextMessages);
      setIsStreaming(true);

      const context: Context = {
        systemPrompt: args.systemPrompt || undefined,
        messages: nextMessages
          .filter((m) => m.id !== assistantId && m.text.length > 0)
          .map((m) =>
            m.role === 'user'
              ? {
                role: 'user' as const,
                content: m.text,
                timestamp: Date.now(),
              }
              : {
                role: 'assistant' as const,
                content: [{ type: 'text' as const, text: m.text }],
                api: model.api,
                provider: model.provider,
                model: model.id,
                usage: {
                  input: 0,
                  output: 0,
                  reasoning: 0,
                  cacheRead: 0,
                  cacheWrite: 0,
                  totalTokens: 0,
                  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
                },
                stopReason: 'stop' as const,
                timestamp: Date.now(),
              },
          ),
      };

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const response = stream(model, context, {
          apiKey: args.provider === 'openai' ? args.openaiKey : undefined,
          signal: controller.signal,
        });

        const composeThinking = (id: string, tagThinking: string): string | undefined => {
          const native = nativeThinkRef.current.get(id) ?? '';
          if (native && tagThinking) return `${native}\n${tagThinking}`;
          return native || tagThinking || undefined;
        };

        for await (const event of response) {
          if (event.type === 'text_delta') {
            const prev = rawBufRef.current.get(assistantId) ?? '';
            const raw = prev + event.delta;
            rawBufRef.current.set(assistantId, raw);
            const { thinking: tagThinking, answer } = splitThinking(raw);
            const thinking = composeThinking(assistantId, tagThinking);
            setMessages((prev) =>
              prev.map((m) => (m.id === assistantId ? { ...m, text: answer, thinking } : m)),
            );
          } else if (event.type === 'thinking_delta') {
            const prev = nativeThinkRef.current.get(assistantId) ?? '';
            const next = prev + event.delta;
            nativeThinkRef.current.set(assistantId, next);
            const raw = rawBufRef.current.get(assistantId) ?? '';
            const { thinking: tagThinking } = splitThinking(raw);
            const thinking = composeThinking(assistantId, tagThinking);
            setMessages((prev) =>
              prev.map((m) => (m.id === assistantId ? { ...m, thinking } : m)),
            );
          } else if (event.type === 'error') {
            const errMsg = event.error.errorMessage ?? 'Stream error';
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId ? { ...m, streaming: false, error: errMsg } : m,
              ),
            );
            setError(errMsg);
          }
        }

        setMessages((prev) =>
          prev.map((m) => (m.id === assistantId ? { ...m, streaming: false } : m)),
        );
        rawBufRef.current.delete(assistantId);
        nativeThinkRef.current.delete(assistantId);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId ? { ...m, streaming: false, error: message } : m,
          ),
        );
        setError(message);
      } finally {
        setIsStreaming(false);
        abortRef.current = null;
      }
    },
    [messages, isStreaming],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  const clear = useCallback(() => {
    if (isStreaming) return;
    setMessages([]);
    setError(null);
    rawBufRef.current.clear();
    nativeThinkRef.current.clear();
  }, [isStreaming]);

  return { messages, send, stop, clear, isStreaming, error };
}
