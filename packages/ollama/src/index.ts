const fetch: typeof globalThis.fetch = globalThis.fetch.bind(globalThis);

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonObject | JsonValue[];

interface JsonObject {
  [key: string]: JsonValue | undefined;
}

interface ModelDescriptor {
  id: string;
  name: string;
  api: string;
  provider: string;
  baseUrl: string;
  input: Array<'text' | 'image'>;
  reasoning: boolean;
  tools?: boolean;
  contextWindow?: number;
  maxOutputTokens?: number;
  cost?: {
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
  };
  headers?: Record<string, string>;
}

interface TextContent {
  type: 'text';
  text: string;
}

interface ImageContent {
  type: 'image';
  data: string;
  mimeType: string;
}

interface ThinkingContent {
  type: 'thinking';
  thinking: string;
}

interface ToolCallContent {
  type: 'toolCall';
  id: string;
  name: string;
  arguments: Record<string, JsonValue | undefined>;
}

interface Usage {
  input: number;
  output: number;
  reasoning: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
}

type Message =
  | {
      role: 'user';
      content: string | Array<TextContent | ImageContent>;
      timestamp: number;
    }
  | {
      role: 'assistant';
      content: Array<TextContent | ThinkingContent | ToolCallContent>;
      api: string;
      provider: string;
      model: string;
      usage: Usage;
      stopReason: 'stop' | 'length' | 'toolUse' | 'error' | 'aborted';
      errorMessage?: string;
      timestamp: number;
    }
  | {
      role: 'toolResult';
      toolCallId: string;
      toolName: string;
      content: Array<TextContent | ImageContent>;
      isError: boolean;
      details?: unknown;
      timestamp: number;
    };

interface Context {
  systemPrompt?: string;
  messages: Message[];
}

interface StreamOptions {
  maxTokens?: number;
  signal?: AbortSignal;
  temperature?: number;
}

type AssistantMessage = Extract<Message, { role: 'assistant' }>;

type AssistantMessageEvent =
  | { type: 'start'; partial: AssistantMessage }
  | { type: 'text_start'; contentIndex: number; partial: AssistantMessage }
  | { type: 'text_delta'; contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: 'text_end'; contentIndex: number; content: string; partial: AssistantMessage }
  | { type: 'thinking_start'; contentIndex: number; partial: AssistantMessage }
  | { type: 'thinking_delta'; contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: 'thinking_end'; contentIndex: number; content: string; partial: AssistantMessage }
  | { type: 'toolcall_start'; contentIndex: number; partial: AssistantMessage }
  | { type: 'toolcall_delta'; contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: 'toolcall_end'; contentIndex: number; toolCall: ToolCallContent; partial: AssistantMessage }
  | { type: 'done'; reason: 'stop' | 'length' | 'toolUse'; message: AssistantMessage }
  | { type: 'error'; reason: 'error' | 'aborted'; error: AssistantMessage };

interface AssistantMessageEventStream extends AsyncIterable<AssistantMessageEvent> {
  result(): Promise<AssistantMessage>;
}

class EventStream<TEvent, TResult = TEvent> implements AsyncIterable<TEvent> {
  private readonly queue: TEvent[] = [];
  private readonly waiting: Array<(result: IteratorResult<TEvent>) => void> = [];
  private done = false;
  private readonly finalResultPromise: Promise<TResult>;
  private resolveFinalResult!: (result: TResult) => void;

  constructor(
    private readonly isTerminal: (event: TEvent) => boolean,
    private readonly extractResult: (event: TEvent) => TResult
  ) {
    this.finalResultPromise = new Promise<TResult>((resolve) => {
      this.resolveFinalResult = resolve;
    });
  }

  push(event: TEvent): void {
    if (this.done) {
      return;
    }

    if (this.isTerminal(event)) {
      this.done = true;
      this.resolveFinalResult(this.extractResult(event));
    }

    const waiter = this.waiting.shift();
    if (waiter) {
      waiter({ value: event, done: false });
      return;
    }

    this.queue.push(event);
  }

  end(result?: TResult): void {
    this.done = true;
    if (result !== undefined) {
      this.resolveFinalResult(result);
    }

    while (this.waiting.length > 0) {
      this.waiting.shift()!({ value: undefined as never, done: true });
    }
  }

  async *[Symbol.asyncIterator](): AsyncIterator<TEvent> {
    while (true) {
      if (this.queue.length > 0) {
        yield this.queue.shift()!;
        continue;
      }

      if (this.done) {
        return;
      }

      const next = await new Promise<IteratorResult<TEvent>>((resolve) => {
        this.waiting.push(resolve);
      });

      if (next.done) {
        return;
      }

      yield next.value;
    }
  }

  result(): Promise<TResult> {
    return this.finalResultPromise;
  }
}

class DefaultAssistantMessageEventStream
  extends EventStream<AssistantMessageEvent, AssistantMessage>
  implements AssistantMessageEventStream
{
  constructor() {
    super(
      (event) => event.type === 'done' || event.type === 'error',
      (event) => {
        if (event.type === 'done') {
          return event.message;
        }
        if (event.type === 'error') {
          return event.error;
        }
        throw new Error('Unexpected terminal event');
      }
    );
  }
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface GenerateInput {
  model: string;
  prompt?: string;
  messages?: ChatMessage[];
  system?: string;
  stream?: boolean;
  temperature?: number;
  maxTokens?: number;
}

interface OllamaTagsResponse {
  models?: Array<{ name: string }>;
}

interface OllamaChatLine {
  done?: boolean;
  done_reason?: 'stop' | 'length';
  message?: { role?: string; content?: string; thinking?: string };
  prompt_eval_count?: number;
  eval_count?: number;
  response?: string;
}

interface OllamaEmbeddingResponse {
  embedding: number[];
}

export const OLLAMA_MODELS: ModelDescriptor[] = [];

export class OllamaClient {
  constructor(private readonly baseUrl = 'http://localhost:11434') {}

  async listModels(): Promise<string[]> {
    const response = await fetch(`${this.baseUrl}/api/tags`);
    if (!response.ok) {
      throw new Error(`listModels failed: ${response.status} ${response.statusText}`);
    }

    const payload = (await response.json()) as OllamaTagsResponse;
    return payload.models?.map((model) => model.name) ?? [];
  }

  async showModel(model: string): Promise<{ capabilities?: string[] } | null> {
    const response = await fetch(`${this.baseUrl}/api/show`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model }),
    });
    if (!response.ok) return null;
    return (await response.json()) as { capabilities?: string[] };
  }

  async pullModel(model: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: model }),
    });
    if (!response.ok) {
      throw new Error(`pullModel failed: ${response.status} ${response.statusText}`);
    }
  }

  async deleteModel(model: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/api/delete`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: model }),
    });
    if (!response.ok) {
      throw new Error(`deleteModel failed: ${response.status} ${response.statusText}`);
    }
  }

  async generateEmbedding(text: string, model = 'nomic-embed-text'): Promise<number[]> {
    const response = await fetch(`${this.baseUrl}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt: text }),
    });
    if (!response.ok) {
      throw new Error(`generateEmbedding failed: ${response.status} ${response.statusText}`);
    }

    const payload = (await response.json()) as OllamaEmbeddingResponse;
    return payload.embedding;
  }

  async generate(input: GenerateInput): Promise<string>;
  async generate(input: GenerateInput, onChunk: (chunk: string) => void): Promise<void>;
  async generate(
    input: GenerateInput,
    onChunk?: (chunk: string) => void
  ): Promise<string | void> {
    const context = legacyInputToContext(input);
    const model: ModelDescriptor = {
      id: input.model,
      name: input.model,
      api: 'ollama-native',
      provider: 'ollama',
      baseUrl: this.baseUrl,
      input: ['text', 'image'],
      reasoning: false,
      tools: false,
      maxOutputTokens: input.maxTokens,
    };

    const adapter = new OllamaAdapter(this.baseUrl);
    const response = adapter.stream(model, context, {
      maxTokens: input.maxTokens,
      signal: undefined,
      temperature: input.temperature,
    });

    if (onChunk || input.stream) {
      for await (const event of response) {
        if (event.type === 'text_delta') {
          onChunk?.(event.delta);
        }
      }
      return;
    }

    const message = await response.result();
    return message.content
      .filter((block): block is TextContent => block.type === 'text')
      .map((block) => block.text)
      .join('');
  }
}

export class OllamaAdapter {
  public readonly api = 'ollama-native';
  public readonly provider = 'ollama';
  public readonly name = 'ollama';

  private readonly client: OllamaClient;
  private readonly baseUrl: string;

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl ?? 'http://localhost:11434';
    this.client = new OllamaClient(this.baseUrl);
  }

  createModel(modelId: string, overrides?: Partial<ModelDescriptor>): ModelDescriptor {
    return {
      id: modelId,
      name: modelId,
      api: this.api,
      provider: this.provider,
      baseUrl: this.baseUrl,
      input: ['text', 'image'],
      reasoning: false,
      tools: false,
      ...overrides,
    };
  }

  async listModels(): Promise<Array<ModelDescriptor | string>> {
    return this.client.listModels();
  }

  stream(model: ModelDescriptor, context: Context, options?: StreamOptions): AssistantMessageEventStream {
    const stream = new DefaultAssistantMessageEventStream();
    const output = createAssistantMessage(model);

    void (async () => {
      const body: Record<string, unknown> = {
        model: model.id,
        stream: true,
        messages: toOllamaMessages(context),
        options: {
          temperature: options?.temperature,
          num_predict: options?.maxTokens,
        },
      };
      if (model.reasoning) body.think = true;

      try {
        const response = await fetch(`${model.baseUrl}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: options?.signal,
        });

        if (!response.ok) {
          const text = await response.text().catch(() => '');
          throw new Error(`Ollama error ${response.status}: ${text}`);
        }

        stream.push({ type: 'start', partial: clone(output) });

        if (!response.body) {
          throw new Error('No response body');
        }
        const decoder = new TextDecoder();
        let buffer = '';
        let textIndex: number | undefined;
        let thinkingIndex: number | undefined;
        let finished = false;

        const processPayload = (payload: OllamaChatLine): boolean => {
          const thinking = payload.message?.thinking ?? '';
          if (thinking) {
            if (thinkingIndex === undefined) {
              thinkingIndex = output.content.push({ type: 'thinking', thinking: '' }) - 1;
              stream.push({
                type: 'thinking_start',
                contentIndex: thinkingIndex,
                partial: clone(output),
              });
            }

            const block = output.content[thinkingIndex] as ThinkingContent;
            block.thinking += thinking;
            stream.push({
              type: 'thinking_delta',
              contentIndex: thinkingIndex,
              delta: thinking,
              partial: clone(output),
            });
          }

          const text = payload.message?.content ?? payload.response ?? '';
          if (text) {
            if (textIndex === undefined) {
              textIndex = output.content.push({ type: 'text', text: '' }) - 1;
              stream.push({ type: 'text_start', contentIndex: textIndex, partial: clone(output) });
            }

            const block = output.content[textIndex] as TextContent;
            block.text += text;
            stream.push({
              type: 'text_delta',
              contentIndex: textIndex,
              delta: text,
              partial: clone(output),
            });
          }

          if (!payload.done) {
            return false;
          }

          output.usage.input = payload.prompt_eval_count ?? output.usage.input;
          output.usage.output = payload.eval_count ?? output.usage.output;
          output.usage.totalTokens = output.usage.input + output.usage.output;
          calculateUsageCost(model, output.usage);
          output.stopReason = payload.done_reason === 'length' ? 'length' : 'stop';

          if (thinkingIndex !== undefined) {
            stream.push({
              type: 'thinking_end',
              contentIndex: thinkingIndex,
              content: (output.content[thinkingIndex] as ThinkingContent).thinking,
              partial: clone(output),
            });
          }
          if (textIndex !== undefined) {
            stream.push({
              type: 'text_end',
              contentIndex: textIndex,
              content: (output.content[textIndex] as TextContent).text,
              partial: clone(output),
            });
          }
          stream.push({
            type: 'done',
            reason: output.stopReason === 'length' ? 'length' : 'stop',
            message: clone(output),
          });
          stream.end(output);
          finished = true;
          return true;
        };

        for await (const chunk of iterateResponseBody(response.body)) {
          buffer += decoder.decode(chunk, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) {
              continue;
            }

            const payload = JSON.parse(trimmed) as OllamaChatLine;
            if (processPayload(payload)) {
              return;
            }
          }
        }

        const trailing = buffer.trim();
        if (!finished && trailing) {
          const payload = JSON.parse(trailing) as OllamaChatLine;
          if (processPayload(payload)) {
            return;
          }
        }

        if (thinkingIndex !== undefined) {
          stream.push({
            type: 'thinking_end',
            contentIndex: thinkingIndex,
            content: (output.content[thinkingIndex] as ThinkingContent).thinking,
            partial: clone(output),
          });
        }
        if (textIndex !== undefined) {
          stream.push({
            type: 'text_end',
            contentIndex: textIndex,
            content: (output.content[textIndex] as TextContent).text,
            partial: clone(output),
          });
        }
        stream.push({
          type: 'done',
          reason: output.stopReason === 'length' ? 'length' : 'stop',
          message: clone(output),
        });
        stream.end(output);
      } catch (error) {
        output.stopReason = options?.signal?.aborted ? 'aborted' : 'error';
        output.errorMessage = error instanceof Error ? error.message : String(error);
        stream.push({
          type: 'error',
          reason: output.stopReason === 'aborted' ? 'aborted' : 'error',
          error: clone(output),
        });
        stream.end(output);
      }
    })();

    return stream;
  }
}

function toOllamaMessages(context: Context): Array<{ role: string; content: string; images?: string[] }> {
  const messages = context.messages.map((message) => {
    if (message.role === 'user') {
      if (typeof message.content === 'string') {
        return { role: 'user', content: message.content };
      }

      return {
        role: 'user',
        content: message.content
          .filter((block): block is TextContent => block.type === 'text')
          .map((block) => block.text)
          .join('\n'),
        images: message.content
          .filter((block): block is ImageContent => block.type === 'image')
          .map((block) => block.data),
      };
    }

    if (message.role === 'toolResult') {
      return {
        role: 'user',
        content: message.content
          .map((block) =>
            block.type === 'text' ? block.text : `[image:${block.mimeType};bytes=${block.data.length}]`
          )
          .join('\n'),
      };
    }

    return {
      role: 'assistant',
      content: message.content
        .map((block) => {
          if (block.type === 'text') {
            return block.text;
          }
          if (block.type === 'thinking') {
            return `<thinking>${block.thinking}</thinking>`;
          }
          return `<tool-call name="${block.name}">${JSON.stringify(block.arguments)}</tool-call>`;
        })
        .join('\n'),
    };
  });

  if (context.systemPrompt) {
    messages.unshift({
      role: 'system',
      content: context.systemPrompt,
    });
  }

  return messages;
}

function createAssistantMessage(model: ModelDescriptor): AssistantMessage {
  return {
    role: 'assistant',
    api: model.api,
    provider: model.provider,
    model: model.id,
    content: [],
    usage: {
      input: 0,
      output: 0,
      reasoning: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: 'stop',
    timestamp: Date.now(),
  };
}

function calculateUsageCost(model: ModelDescriptor, usage: Usage): void {
  usage.cost.input = ((model.cost?.input ?? 0) / 1_000_000) * usage.input;
  usage.cost.output = ((model.cost?.output ?? 0) / 1_000_000) * usage.output;
  usage.cost.cacheRead = ((model.cost?.cacheRead ?? 0) / 1_000_000) * usage.cacheRead;
  usage.cost.cacheWrite = ((model.cost?.cacheWrite ?? 0) / 1_000_000) * usage.cacheWrite;
  usage.cost.total =
    usage.cost.input + usage.cost.output + usage.cost.cacheRead + usage.cost.cacheWrite;
}

function legacyInputToContext(input: GenerateInput): Context {
  const messages: Message[] = input.messages
    ? input.messages
      .filter((message) => message.role !== 'system')
      .map((message) =>
        message.role === 'assistant'
          ? {
            role: 'assistant' as const,
            api: 'ollama-native',
            provider: 'ollama',
            model: input.model,
            content: [{ type: 'text', text: message.content }],
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
          }
          : {
            role: 'user' as const,
            content: message.content,
            timestamp: Date.now(),
          }
      )
    : [{ role: 'user' as const, content: input.prompt ?? '', timestamp: Date.now() }];

  return {
    systemPrompt: input.system ?? input.messages?.find((message) => message.role === 'system')?.content,
    messages,
  };
}

function clone<TValue>(value: TValue): TValue {
  return JSON.parse(JSON.stringify(value)) as TValue;
}

async function* iterateResponseBody(
  body: NonNullable<Response['body']>
): AsyncGenerator<Uint8Array, void, void> {
  if ('getReader' in body && typeof body.getReader === 'function') {
    const reader = body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        return;
      }

      if (value) {
        yield value;
      }
    }
  }

  for await (const chunk of body as unknown as AsyncIterable<Uint8Array | Buffer | string>) {
    if (typeof chunk === 'string') {
      yield new TextEncoder().encode(chunk);
      continue;
    }

    yield chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
  }
}

export default OllamaClient;
