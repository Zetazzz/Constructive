import { ArrowUp, Square } from 'lucide-react';
import { type KeyboardEvent, useEffect, useRef, useState } from 'react';

import { cn } from '#/lib/utils';

type Props = {
  onSend: (text: string) => void;
  onStop: () => void;
  disabled?: boolean;
  isStreaming: boolean;
};

export function ChatInput({ onSend, onStop, disabled, isStreaming }: Props) {
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [value]);

  const hasText = value.trim().length > 0;
  const canSend = hasText && !disabled && !isStreaming;
  const showAction = isStreaming || hasText;

  function submit() {
    if (!canSend) return;
    onSend(value);
    setValue('');
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  return (
    <div className="px-3 pt-2 pb-3">
      <div
        className={cn(
          'relative flex items-end rounded-[22px] border border-hairline bg-bg transition-colors',
          'focus-within:border-label-3',
          disabled && 'opacity-50',
        )}
      >
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={disabled ? 'Add a model in Settings' : 'Message'}
          rows={1}
          disabled={disabled}
          className={cn(
            'block min-h-[24px] w-full resize-none bg-transparent py-[9px] pl-4 pr-10 text-[16px] leading-[1.35] text-label',
            'placeholder:text-label-3',
            'focus:outline-none',
          )}
          style={{ letterSpacing: '-0.24px' }}
        />
        {showAction && (
          <button
            type="button"
            onClick={isStreaming ? onStop : submit}
            disabled={!isStreaming && !canSend}
            aria-label={isStreaming ? 'Stop' : 'Send'}
            className={cn(
              'press absolute bottom-1 right-1 flex size-[30px] items-center justify-center rounded-full text-white transition-colors',
              isStreaming ? 'bg-label hover:bg-label/85' : 'bg-ios-blue hover:bg-ios-blue-press',
            )}
          >
            {isStreaming ? (
              <Square className="size-3 fill-current" />
            ) : (
              <ArrowUp className="size-4" strokeWidth={2.5} />
            )}
          </button>
        )}
      </div>
    </div>
  );
}
