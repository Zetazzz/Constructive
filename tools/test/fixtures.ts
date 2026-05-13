import type { AssistantMessage, ModelDescriptor, Usage } from 'agentic-kit';

const ZERO_USAGE: Usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

export function makeFakeModel(overrides: Partial<ModelDescriptor> = {}): ModelDescriptor {
  return {
    id: 'demo',
    name: 'Demo',
    api: 'fake-api',
    provider: 'fake',
    baseUrl: 'http://fake.local',
    input: ['text'],
    reasoning: false,
    tools: true,
    ...overrides,
  };
}

export function makeFakeAssistantMessage(
  overrides: Partial<AssistantMessage> = {}
): AssistantMessage {
  return {
    role: 'assistant',
    api: 'fake-api',
    provider: 'fake',
    model: 'demo',
    usage: { ...ZERO_USAGE, cost: { ...ZERO_USAGE.cost } },
    stopReason: 'stop',
    timestamp: Date.now(),
    content: [{ type: 'text', text: '' }],
    ...overrides,
  };
}
