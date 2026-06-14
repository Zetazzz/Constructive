import { useCallback, useEffect, useState } from 'react';

import {
  type ChatModelOption,
  discoverOllamaModels,
  listOpenAIModelOptions,
} from './kit-client';

type ModelsState = {
  openai: ChatModelOption[]
  ollama: ChatModelOption[]
  ollamaError?: string
  loading: boolean
}

export function useModels(args: { openaiEnabled: boolean; ollamaBaseUrl: string }) {
  const { openaiEnabled, ollamaBaseUrl } = args;
  const [state, setState] = useState<ModelsState>({ openai: [], ollama: [], loading: true });

  const refresh = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, ollamaError: undefined }));
    const openai = openaiEnabled ? listOpenAIModelOptions() : [];
    let ollama: ChatModelOption[] = [];
    let ollamaError: string | undefined;
    try {
      ollama = await discoverOllamaModels(ollamaBaseUrl);
    } catch (error) {
      ollamaError = error instanceof Error ? error.message : 'Failed to reach Ollama';
    }
    setState({ openai, ollama, ollamaError, loading: false });
  }, [openaiEnabled, ollamaBaseUrl]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { ...state, refresh };
}
