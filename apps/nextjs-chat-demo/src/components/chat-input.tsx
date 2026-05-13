'use client';

import { type KeyboardEvent, useState } from 'react';

import { cn } from '@/lib/cn';

interface ChatInputProps {
  disabled?: boolean;
  placeholder?: string;
  onSend: (text: string) => void;
}

export function ChatInput({ disabled, placeholder, onSend }: ChatInputProps) {
  const [value, setValue] = useState('');

  function submit() {
    const text = value.trim();
    if (!text || disabled) return;
    onSend(text);
    setValue('');
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  return (
    <div className="flex gap-2">
      <textarea
        className={cn(
          'min-h-[44px] flex-1 resize-none rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm',
          'placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500',
          'dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-500',
          disabled ? 'cursor-not-allowed opacity-60' : ''
        )}
        rows={1}
        placeholder={placeholder ?? 'Type a message…'}
        value={value}
        disabled={disabled}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={onKeyDown}
      />
      <button
        type="button"
        disabled={disabled || value.trim().length === 0}
        onClick={submit}
        className={cn(
          'rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700',
          'disabled:cursor-not-allowed disabled:opacity-50'
        )}
      >
        Send
      </button>
    </div>
  );
}
