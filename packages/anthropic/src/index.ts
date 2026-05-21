const fetch: typeof globalThis.fetch = globalThis.fetch.bind(globalThis);

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonObject | JsonValue[];

interface JsonObject {
  [key: string]: JsonValue | undefined;
}

interface JsonSchema {
  additionalProperties?: boolean | JsonSchema;
  description?: string;
  enum?: JsonValue[];
  items?: JsonSchema | JsonSchema[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  type?: string | string[];
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
  rawArguments?: string;
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

interface ToolDefinition {
  name: string;
  description: string;
  parameters: JsonSchema;
}

interface Context {
  systemPrompt?: string;
  messages: Message[];
  tools?: ToolDefinition[];
}

interface StreamOptions {
  apiKey?: string;
  headers?: Record<string, string>;
  maxTokens?: number;
  onPayload?: (payload: unknown) => void;
  reasoning?: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
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

export interface AnthropicOptions {
  apiKey: string;
  baseUrl?: string;
  defaultModel?: string;
  headers?: Record<string, string>;
  maxTokens?: number;
  provider?: string;
}

export const ANTHROPIC_MODELS: ModelDescriptor[] = [
  {
    id: 'claude-sonnet-4-5',
    name: 'Claude Sonnet 4.5',
    api: 'anthropic-messages',
    provider: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    input: ['text', 'image'],
    reasoning: true,
    tools: true,
    contextWindow: 200000,
    maxOutputTokens: 8192,
    cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  },
  {
    id: 'claude-haiku-4-5',
    name: 'Claude Haiku 4.5',
    api: 'anthropic-messages',
    provider: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    input: ['text', 'image'],
    reasoning: false,
    tools: true,
    contextWindow: 200000,
    maxOutputTokens: 8192,
    cost: { input: 0.8, output: 4, cacheRead: 0.08, cacheWrite: 1 },
  },
];

export class AnthropicAdapter {
  public readonly api = 'anthropic-messages';
  public readonly provider: string;
  public readonly name: string;

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly defaultHeaders?: Record<string, string>;
  private readonly defaultModel: string;
  private readonly defaultMaxTokens: number;

  constructor(options: AnthropicOptions | string) {
    const normalized: AnthropicOptions =
      typeof options === 'string' ? { apiKey: options } : options;

    this.apiKey = normalized.apiKey;
    this.baseUrl = normalizeBaseUrl(normalized.baseUrl ?? 'https://api.anthropic.com/v1');
    this.provider = normalized.provider ?? 'anthropic';
    this.name = this.provider;
    this.defaultHeaders = normalized.headers;
    this.defaultModel = normalized.defaultModel ?? 'claude-sonnet-4-5';
    this.defaultMaxTokens = normalized.maxTokens ?? 4096;
  }

  createModel(modelId: string, overrides?: Partial<ModelDescriptor>): ModelDescriptor {
    const builtIn = ANTHROPIC_MODELS.find(
      (model) => model.provider === this.provider && model.id === modelId
    );

    if (builtIn) {
      return {
        ...builtIn,
        baseUrl: this.baseUrl,
        headers: { ...(builtIn.headers ?? {}), ...(this.defaultHeaders ?? {}), ...(overrides?.headers ?? {}) },
        ...overrides,
      };
    }

    return {
      id: modelId,
      name: modelId,
      api: this.api,
      provider: this.provider,
      baseUrl: this.baseUrl,
      input: ['text', 'image'],
      reasoning: false,
      tools: true,
      maxOutputTokens: overrides?.maxOutputTokens ?? this.defaultMaxTokens,
      headers: { ...(this.defaultHeaders ?? {}), ...(overrides?.headers ?? {}) },
      ...overrides,
    };
  }

  async listModels(): Promise<Array<ModelDescriptor | string>> {
    return ANTHROPIC_MODELS.filter((model) => model.provider === this.provider);
  }

  stream(
    model: ModelDescriptor,
    context: Context,
    options?: StreamOptions
  ): AssistantMessageEventStream {
    const stream = new DefaultAssistantMessageEventStream();
    const output = createAssistantMessage(model);

    void (async () => {
      const anthropicIndexMap = new Map<number, number>();
      const blockKinds = new Map<number, 'text' | 'thinking' | 'toolCall'>();
      let doneReason: 'stop' | 'length' | 'toolUse' = 'stop';

      try {
        const body = buildRequestBody(model, context, {
          ...options,
          maxTokens: options?.maxTokens ?? model.maxOutputTokens ?? this.defaultMaxTokens,
        });
        options?.onPayload?.(body);

        const response = await fetch(`${model.baseUrl}/messages`, {
          method: 'POST',
          headers: this.buildHeaders(model, options),
          body: JSON.stringify(body),
          signal: options?.signal,
        });

        if (!response.ok) {
          const text = await response.text().catch(() => '');
          throw new Error(`Anthropic error ${response.status}: ${text}`);
        }

        stream.push({ type: 'start', partial: clone(output) });

        const reader = response.body?.getReader();
        if (!reader) {
          throw new Error('No response body');
        }

        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }

          buffer += decoder.decode(value, { stream: true });
          const frames = buffer.split('\n\n');
          buffer = frames.pop() ?? '';

          for (const frame of frames) {
            const parsed = parseSseFrame(frame);
            if (!parsed?.data) {
              continue;
            }

            if (parsed.data === '[DONE]') {
              calculateUsageCost(model, output.usage);
              stream.push({ type: 'done', reason: doneReason, message: clone(output) });
              stream.end(output);
              return;
            }

            const event = JSON.parse(parsed.data) as AnthropicStreamEvent;

            if (event.type === 'message_start') {
              output.usage.input = event.message?.usage?.input_tokens ?? 0;
              output.usage.output = event.message?.usage?.output_tokens ?? 0;
              output.usage.cacheRead = event.message?.usage?.cache_read_input_tokens ?? 0;
              output.usage.cacheWrite = event.message?.usage?.cache_creation_input_tokens ?? 0;
              output.usage.totalTokens =
                output.usage.input + output.usage.output + output.usage.cacheRead + output.usage.cacheWrite;
              calculateUsageCost(model, output.usage);
              continue;
            }

            if (event.type === 'content_block_start') {
              const contentIndex = output.content.length;
              anthropicIndexMap.set(event.index, contentIndex);

              if (event.content_block?.type === 'text') {
                output.content.push({ type: 'text', text: event.content_block.text ?? '' });
                blockKinds.set(event.index, 'text');
                stream.push({ type: 'text_start', contentIndex, partial: clone(output) });
                if (event.content_block.text) {
                  stream.push({
                    type: 'text_delta',
                    contentIndex,
                    delta: event.content_block.text,
                    partial: clone(output),
                  });
                }
              } else if (event.content_block?.type === 'thinking') {
                output.content.push({ type: 'thinking', thinking: event.content_block.thinking ?? '' });
                blockKinds.set(event.index, 'thinking');
                stream.push({ type: 'thinking_start', contentIndex, partial: clone(output) });
                if (event.content_block.thinking) {
                  stream.push({
                    type: 'thinking_delta',
                    contentIndex,
                    delta: event.content_block.thinking,
                    partial: clone(output),
                  });
                }
              } else if (event.content_block?.type === 'tool_use') {
                const initialInput = event.content_block.input ?? {};
                const toolCall: ToolCallContent = {
                  type: 'toolCall',
                  id: event.content_block.id ?? `tool_${event.index}`,
                  name: event.content_block.name ?? '',
                  arguments: initialInput,
                  rawArguments:
                    Object.keys(initialInput).length > 0 ? JSON.stringify(initialInput) : '',
                };
                output.content.push(toolCall);
                blockKinds.set(event.index, 'toolCall');
                stream.push({ type: 'toolcall_start', contentIndex, partial: clone(output) });
              }
              continue;
            }

            if (event.type === 'content_block_delta') {
              const contentIndex = anthropicIndexMap.get(event.index);
              if (contentIndex === undefined) {
                continue;
              }

              const kind = blockKinds.get(event.index);
              if (kind === 'text' && event.delta?.type === 'text_delta' && event.delta.text) {
                const block = output.content[contentIndex] as TextContent;
                block.text += event.delta.text;
                stream.push({
                  type: 'text_delta',
                  contentIndex,
                  delta: event.delta.text,
                  partial: clone(output),
                });
              } else if (
                kind === 'thinking' &&
                event.delta?.type === 'thinking_delta' &&
                event.delta.thinking
              ) {
                const block = output.content[contentIndex] as ThinkingContent;
                block.thinking += event.delta.thinking;
                stream.push({
                  type: 'thinking_delta',
                  contentIndex,
                  delta: event.delta.thinking,
                  partial: clone(output),
                });
              } else if (
                kind === 'toolCall' &&
                event.delta?.type === 'input_json_delta' &&
                event.delta.partial_json !== undefined
              ) {
                const block = output.content[contentIndex] as ToolCallContent;
                block.rawArguments = `${block.rawArguments ?? ''}${event.delta.partial_json}`;
                block.arguments = parsePartialJson(block.rawArguments);
                stream.push({
                  type: 'toolcall_delta',
                  contentIndex,
                  delta: event.delta.partial_json,
                  partial: clone(output),
                });
              }
              continue;
            }

            if (event.type === 'content_block_stop') {
              const contentIndex = anthropicIndexMap.get(event.index);
              if (contentIndex === undefined) {
                continue;
              }

              const kind = blockKinds.get(event.index);
              if (kind === 'text') {
                stream.push({
                  type: 'text_end',
                  contentIndex,
                  content: (output.content[contentIndex] as TextContent).text,
                  partial: clone(output),
                });
              } else if (kind === 'thinking') {
                stream.push({
                  type: 'thinking_end',
                  contentIndex,
                  content: (output.content[contentIndex] as ThinkingContent).thinking,
                  partial: clone(output),
                });
              } else if (kind === 'toolCall') {
                const toolCall = output.content[contentIndex] as ToolCallContent;
                toolCall.arguments = parsePartialJson(toolCall.rawArguments ?? '');
                stream.push({
                  type: 'toolcall_end',
                  contentIndex,
                  toolCall: clone(toolCall),
                  partial: clone(output),
                });
              }
              continue;
            }

            if (event.type === 'message_delta') {
              if (event.delta?.stop_reason === 'max_tokens') {
                doneReason = 'length';
                output.stopReason = 'length';
              } else if (event.delta?.stop_reason === 'tool_use') {
                doneReason = 'toolUse';
                output.stopReason = 'toolUse';
              }

              if (event.usage) {
                output.usage.input =
                  event.usage.input_tokens ?? output.usage.input;
                output.usage.output =
                  event.usage.output_tokens ?? output.usage.output;
                output.usage.cacheRead =
                  event.usage.cache_read_input_tokens ?? output.usage.cacheRead;
                output.usage.cacheWrite =
                  event.usage.cache_creation_input_tokens ?? output.usage.cacheWrite;
                output.usage.totalTokens =
                  output.usage.input +
                  output.usage.output +
                  output.usage.cacheRead +
                  output.usage.cacheWrite;
                calculateUsageCost(model, output.usage);
              }
              continue;
            }

            if (event.type === 'message_stop') {
              calculateUsageCost(model, output.usage);
              stream.push({ type: 'done', reason: doneReason, message: clone(output) });
              stream.end(output);
              return;
            }
          }
        }

        calculateUsageCost(model, output.usage);
        stream.push({ type: 'done', reason: doneReason, message: clone(output) });
        stream.end(output);
      } catch (error) {
        output.stopReason = options?.signal?.aborted ? 'aborted' : 'error';
        output.errorMessage = error instanceof Error ? error.message : String(error);
        calculateUsageCost(model, output.usage);
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

  private buildHeaders(
    model?: ModelDescriptor,
    options?: Pick<StreamOptions, 'apiKey' | 'headers'>
  ): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'x-api-key': options?.apiKey ?? this.apiKey,
      'anthropic-version': '2023-06-01',
      ...(this.defaultHeaders ?? {}),
      ...(model?.headers ?? {}),
      ...(options?.headers ?? {}),
    };
  }
}

interface AnthropicStreamEvent {
  type: string;
  index: number;
  message?: {
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
    };
  };
  content_block?: {
    type?: string;
    id?: string;
    name?: string;
    text?: string;
    thinking?: string;
    input?: Record<string, JsonValue | undefined>;
  };
  delta?: {
    type?: string;
    text?: string;
    thinking?: string;
    partial_json?: string;
    stop_reason?: string | null;
  };
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
}

function buildRequestBody(
  model: ModelDescriptor,
  context: Context,
  options?: StreamOptions
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: model.id,
    messages: context.messages.map(toAnthropicMessage),
    max_tokens: options?.maxTokens ?? model.maxOutputTokens ?? 4096,
    stream: true,
  };

  if (context.systemPrompt) {
    body.system = context.systemPrompt;
  }
  if (options?.temperature !== undefined) {
    body.temperature = options.temperature;
  }
  if (model.reasoning && options?.reasoning) {
    body.thinking = {
      type: 'enabled',
      budget_tokens: clampThinkingBudget(options.reasoning),
    };
  }
  if (context.tools && context.tools.length > 0) {
    body.tools = context.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.parameters,
    }));
  }

  return body;
}

function toAnthropicMessage(message: Message): Record<string, unknown> {
  if (message.role === 'user') {
    return {
      role: 'user',
      content:
        typeof message.content === 'string'
          ? [{ type: 'text', text: message.content }]
          : message.content.map((block) =>
            block.type === 'text'
              ? { type: 'text', text: block.text }
              : {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: block.mimeType,
                  data: block.data,
                },
              }
          ),
    };
  }

  if (message.role === 'toolResult') {
    return {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: message.toolCallId,
          is_error: message.isError,
          content: message.content
            .map((block) =>
              block.type === 'text' ? block.text : `[image:${block.mimeType};bytes=${block.data.length}]`
            )
            .join('\n'),
        },
      ],
    };
  }

  return {
    role: 'assistant',
    content: message.content.map((block) => {
      if (block.type === 'text') {
        return { type: 'text', text: block.text };
      }
      if (block.type === 'thinking') {
        return { type: 'text', text: `<thinking>${block.thinking}</thinking>` };
      }
      return {
        type: 'tool_use',
        id: block.id,
        name: block.name,
        input: block.arguments,
      };
    }),
  };
}

function clampThinkingBudget(reasoning: NonNullable<StreamOptions['reasoning']>): number {
  switch (reasoning) {
  case 'minimal':
    return 256;
  case 'low':
    return 1024;
  case 'medium':
    return 4096;
  case 'high':
    return 8192;
  case 'xhigh':
    return 16384;
  }
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

function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '');
  if (/\/v\d+$/.test(trimmed)) {
    return trimmed;
  }
  return `${trimmed}/v1`;
}

function parsePartialJson(raw: string): Record<string, JsonValue | undefined> {
  const trimmed = raw.trim();
  if (!trimmed) {
    return {};
  }

  try {
    return JSON.parse(trimmed) as Record<string, JsonValue | undefined>;
  } catch {
    // continue
  }

  const completed = completePartialJson(trimmed);
  if (!completed) {
    return {};
  }

  try {
    return JSON.parse(completed) as Record<string, JsonValue | undefined>;
  } catch {
    return {};
  }
}

function completePartialJson(input: string): string | undefined {
  let output = input;
  let inString = false;
  let escaping = false;
  const stack: string[] = [];

  for (const char of input) {
    if (escaping) {
      escaping = false;
      continue;
    }

    if (char === '\\') {
      escaping = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) {
      continue;
    }

    if (char === '{') {
      stack.push('}');
    } else if (char === '[') {
      stack.push(']');
    } else if (char === '}' || char === ']') {
      stack.pop();
    }
  }

  if (inString) {
    output += '"';
  }

  while (stack.length > 0) {
    output += stack.pop();
  }

  return output;
}

function parseSseFrame(frame: string): { event?: string; data?: string } | undefined {
  const lines = frame.split('\n');
  const data: string[] = [];
  let event: string | undefined;

  for (const line of lines) {
    if (line.startsWith('event:')) {
      event = line.slice(6).trim();
    } else if (line.startsWith('data:')) {
      data.push(line.slice(5).trim());
    }
  }

  if (!event && data.length === 0) {
    return undefined;
  }

  return {
    event,
    data: data.join('\n'),
  };
}

function clone<TValue>(value: TValue): TValue {
  return JSON.parse(JSON.stringify(value)) as TValue;
}

export default AnthropicAdapter;
