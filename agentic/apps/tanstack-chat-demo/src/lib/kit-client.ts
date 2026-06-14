import { OllamaClient } from '@agentic-kit/ollama';
import {
  type AssistantMessageEvent,
  type Context,
  getModel,
  getModels,
  type ModelDescriptor,
  registerModel,
  stream,
  type StreamOptions,
} from 'agentic-kit';

export type ChatProvider = 'openai' | 'ollama'

export type ChatModelOption = {
  id: string
  provider: ChatProvider
  name: string
  contextWindow?: number
}

const DEFAULT_OLLAMA_URL = 'http://localhost:11434';

export async function discoverOllamaModels(
  baseUrl: string = DEFAULT_OLLAMA_URL,
): Promise<ChatModelOption[]> {
  const trimmed = baseUrl.replace(/\/+$/, '') || DEFAULT_OLLAMA_URL;
  const client = new OllamaClient(trimmed);
  const ids = await client.listModels();
  const details = await Promise.all(
    ids.map((id) => client.showModel(id).catch(() => null)),
  );
  const options: ChatModelOption[] = [];
  ids.forEach((id, i) => {
    const caps = details[i]?.capabilities ?? [];
    if (!caps.includes('completion')) return;
    registerModel({
      id,
      name: id,
      api: 'ollama-native',
      provider: 'ollama',
      baseUrl: trimmed,
      input: caps.includes('vision') ? ['text', 'image'] : ['text'],
      reasoning: caps.includes('thinking'),
      tools: caps.includes('tools'),
    });
    options.push({ id, provider: 'ollama', name: id });
  });
  return options;
}

export function listOpenAIModelOptions(): ChatModelOption[] {
  return getModels('openai').map((m) => ({
    id: m.id,
    provider: 'openai',
    name: m.name,
    contextWindow: m.contextWindow,
  }));
}

export function resolveModel(provider: ChatProvider, id: string): ModelDescriptor | undefined {
  return getModel(provider, id);
}

export type { AssistantMessageEvent, Context, ModelDescriptor, StreamOptions };
export { stream };
