import { ChevronDown } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import type { UIMessage } from '#/lib/use-chat';
import { cn } from '#/lib/utils';

type Props = {
  messages: UIMessage[];
  modelId: string;
  hasAnyModel: boolean;
};

export function MessageList({ messages, modelId, hasAnyModel }: Props) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages]);

  if (messages.length === 0) {
    return <EmptyState modelId={modelId} hasAnyModel={hasAnyModel} />;
  }

  return (
    <div className="flex flex-col gap-0.5 px-3 py-4">
      {messages.map((m, i) => {
        const prev = messages[i - 1];
        const next = messages[i + 1];
        const continuesPrev = prev?.role === m.role;
        const continuesNext = next?.role === m.role;
        return (
          <Row
            key={m.id}
            message={m}
            isFirstOfGroup={!continuesPrev}
            isLastOfGroup={!continuesNext}
          />
        );
      })}
      <div ref={endRef} className="h-1" />
    </div>
  );
}

function Row({
  message,
  isFirstOfGroup,
  isLastOfGroup,
}: {
  message: UIMessage;
  isFirstOfGroup: boolean;
  isLastOfGroup: boolean;
}) {
  const isUser = message.role === 'user';
  const empty = message.text.length === 0;
  const hasThinking = !isUser && !!message.thinking;
  const showTyping = !isUser && empty && !!message.streaming && !hasThinking;
  const hideAnswerBubble = !isUser && empty && !!message.streaming && hasThinking && !message.error;

  const tailClasses = isUser
    ? cn(
      'rounded-[20px]',
      !isFirstOfGroup && 'rounded-tr-[6px]',
      !isLastOfGroup && 'rounded-br-[6px]',
    )
    : cn(
      'rounded-[20px]',
      !isFirstOfGroup && 'rounded-tl-[6px]',
      !isLastOfGroup && 'rounded-bl-[6px]',
    );

  return (
    <div
      className={cn(
        'bubble-in flex w-full',
        isUser ? 'justify-end' : 'justify-start',
        isLastOfGroup ? 'mb-1.5' : 'mb-[2px]',
      )}
    >
      <div className={cn('flex max-w-[78%] flex-col', isUser ? 'items-end' : 'items-start')}>
        {hasThinking && (
          <ThinkingTrail
            text={message.thinking!}
            streaming={!!message.streaming}
            answerStarted={!empty}
          />
        )}
        {hideAnswerBubble ? null : (
          <div
            className={cn(
              'px-3.5 py-2 text-[15.5px] leading-[1.35] whitespace-pre-wrap break-words',
              tailClasses,
              isUser ? 'bg-bubble-user text-white' : 'bg-bubble-assistant text-label',
              message.error && 'bg-ios-red-soft text-ios-red',
            )}
            style={{ letterSpacing: '-0.24px' }}
          >
            {showTyping ? (
              <div className="flex items-center gap-1.5 py-1">
                <span className="typing-dot" />
                <span className="typing-dot" />
                <span className="typing-dot" />
              </div>
            ) : (
              <>
                {message.text}
                {message.streaming && !message.error && !empty && (
                  <span className="caret-at" aria-hidden />
                )}
              </>
            )}
            {message.error && <div className="mt-1 text-[13px] opacity-90">{message.error}</div>}
          </div>
        )}
      </div>
    </div>
  );
}

function ThinkingTrail({
  text,
  streaming,
  answerStarted,
}: {
  text: string;
  streaming: boolean;
  answerStarted: boolean;
}) {
  const active = streaming && !answerStarted;
  const [open, setOpen] = useState(active);
  const [userToggled, setUserToggled] = useState(false);

  useEffect(() => {
    if (!userToggled) setOpen(active);
  }, [active, userToggled]);

  return (
    <div className={cn('w-full', answerStarted || !streaming ? 'mb-1.5' : 'mb-0')}>
      <button
        type="button"
        onClick={() => {
          setUserToggled(true);
          setOpen((v) => !v);
        }}
        className={cn(
          'press flex items-center gap-1 rounded-full px-2.5 py-1 text-[12.5px] font-normal transition-colors',
          active ? 'bg-ios-blue-tint text-ios-blue' : 'bg-fill-4 text-label-2 hover:bg-fill-3',
        )}
        aria-expanded={open}
      >
        <span>{active ? 'Thinking' : 'Thought process'}</span>
        {active && (
          <span className="flex items-center gap-[2px]">
            <span className="size-[3px] rounded-full bg-ios-blue/70 animate-pulse [animation-delay:0ms]" />
            <span className="size-[3px] rounded-full bg-ios-blue/70 animate-pulse [animation-delay:180ms]" />
            <span className="size-[3px] rounded-full bg-ios-blue/70 animate-pulse [animation-delay:360ms]" />
          </span>
        )}
        <ChevronDown
          className={cn('size-3 transition-transform duration-200', open && 'rotate-180')}
        />
      </button>
      {open && (
        <div className="mt-1.5 rounded-[12px] bg-fill-4 px-3 py-2 text-[13.5px] leading-[1.45] text-label-2 whitespace-pre-wrap break-words">
          {text}
          {active && <span className="caret-at" aria-hidden />}
        </div>
      )}
    </div>
  );
}

function EmptyState({ modelId, hasAnyModel }: { modelId: string; hasAnyModel: boolean }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
      <div className="flex size-14 items-center justify-center rounded-[16px] bg-ios-blue text-white">
        <svg
          viewBox="0 0 24 24"
          className="size-7"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5Z" />
        </svg>
      </div>
      <div className="max-w-[280px] space-y-1">
        <h2 className="text-[22px] font-semibold text-label" style={{ letterSpacing: '-0.5px' }}>
          {hasAnyModel ? 'New conversation' : 'Connect a model'}
        </h2>
        <p className="text-[15px] leading-[1.35] text-label-2" style={{ letterSpacing: '-0.24px' }}>
          {hasAnyModel ? (
            <>
              Messages are sent to <span className="text-label">{modelId}</span> from your browser —
              keys stay local.
            </>
          ) : (
            <>Add an OpenAI key or a local Ollama endpoint in Settings.</>
          )}
        </p>
      </div>
    </div>
  );
}
