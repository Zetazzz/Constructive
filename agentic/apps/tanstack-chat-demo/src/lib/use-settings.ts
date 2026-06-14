import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'agentic-kit.chat.settings.v1';

export type ChatSettings = {
  openaiKey: string
  ollamaBaseUrl: string
  selectedProvider: 'openai' | 'ollama'
  selectedModelId: string
  systemPrompt: string
}

const DEFAULTS: ChatSettings = {
  openaiKey: '',
  ollamaBaseUrl: 'http://localhost:11434',
  selectedProvider: 'openai',
  selectedModelId: 'gpt-5.4-mini',
  systemPrompt: 'You are a helpful assistant.',
};

function readFromStorage(): ChatSettings {
  if (typeof window === 'undefined') return DEFAULTS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<ChatSettings>;
    return { ...DEFAULTS, ...parsed };
  } catch {
    return DEFAULTS;
  }
}

export function useSettings() {
  const [settings, setSettings] = useState<ChatSettings>(DEFAULTS);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setSettings(readFromStorage());
    setHydrated(true);
  }, []);

  const update = useCallback((patch: Partial<ChatSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      }
      return next;
    });
  }, []);

  return { settings, update, hydrated };
}
