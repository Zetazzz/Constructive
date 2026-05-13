import { TextEncoder } from 'util';

import { OpenAIAdapter } from '../src';

const fetch = global.fetch as jest.Mock;

function createStreamingResponse(lines: string[]) {
  const payload = lines.join('\n');
  const encoded = new TextEncoder().encode(payload);
  const reader = {
    read: jest
      .fn()
      .mockResolvedValueOnce({ done: false, value: encoded })
      .mockResolvedValueOnce({ done: true, value: undefined }),
  };

  return {
    ok: true,
    body: { getReader: () => reader },
  };
}

describe('OpenAIAdapter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('streams text and tool calls with parsed partial JSON', async () => {
    (fetch as jest.Mock).mockResolvedValueOnce(
      createStreamingResponse([
        'data: {"choices":[{"delta":{"content":"Hello "},"finish_reason":null}]}',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"lookup","arguments":"{\\"city\\":\\"Pa"}}]},"finish_reason":null}]}',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"ris\\"}"}}]},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}',
        'data: [DONE]',
      ])
    );

    const adapter = new OpenAIAdapter({ apiKey: 'test-key' });
    const model = adapter.createModel('gpt-5.4-mini');
    const stream = adapter.stream(model, {
      messages: [{ role: 'user', content: 'hi', timestamp: Date.now() }],
      tools: [
        {
          name: 'lookup',
          description: 'Lookup a city',
          parameters: {
            type: 'object',
            properties: {
              city: { type: 'string' },
            },
            required: ['city'],
          },
        },
      ],
    });

    const eventTypes: string[] = [];
    for await (const event of stream) {
      eventTypes.push(event.type);
    }

    const message = await stream.result();
    const toolCall = message.content.find((block) => block.type === 'toolCall');

    expect(eventTypes).toEqual(
      expect.arrayContaining(['text_start', 'text_delta', 'toolcall_start', 'toolcall_delta', 'toolcall_end', 'done'])
    );
    expect(message.stopReason).toBe('toolUse');
    expect(message.usage.totalTokens).toBe(15);
    expect(toolCall).toMatchObject({
      type: 'toolCall',
      name: 'lookup',
      arguments: { city: 'Paris' },
    });
  });

  it('falls back to built-in models when no API key is configured', async () => {
    const adapter = new OpenAIAdapter();
    const models = await adapter.listModels();

    expect(models).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'gpt-5.4' }),
        expect.objectContaining({ id: 'gpt-5.4-mini' }),
        expect.objectContaining({ id: 'gpt-5.4-nano' }),
      ])
    );
  });
});
