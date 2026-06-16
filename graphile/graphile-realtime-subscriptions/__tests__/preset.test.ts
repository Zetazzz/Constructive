/**
 * Tests for the realtime subscriptions preset.
 */

jest.mock('@pgpmjs/logger', () => ({
  Logger: jest.fn().mockImplementation(() => ({
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  })),
}));

jest.mock('grafast', () => ({
  context: jest.fn(() => ({
    get: jest.fn((key: string) => `mock-${key}`),
  })),
  listen: jest.fn(),
  object: jest.fn((obj: any) => obj),
  constant: jest.fn(),
}));

jest.mock('graphile-utils', () => ({
  extendSchema: jest.fn((factory: any) => {
    const mockBuild = {
      input: { pgRegistry: { pgResources: {} } },
      inflection: { tableType: (codec: any) => codec.name },
    };
    const schema = factory(mockBuild);
    return {
      name: 'ExtendSchemaPlugin',
      schema: { hooks: {} },
      _typeDefs: schema.typeDefs,
      _plans: schema.plans,
    };
  }),
  gql: jest.fn((strings: TemplateStringsArray) => strings.join('')),
}));

import { RealtimeSubscriptionsPreset } from '../src/preset';

describe('RealtimeSubscriptionsPreset', () => {
  it('returns a preset with plugins array', () => {
    const preset = RealtimeSubscriptionsPreset();

    expect(preset).toBeDefined();
    expect(preset.plugins).toBeDefined();
    expect(preset.plugins).toHaveLength(1);
  });

  it('accepts empty options', () => {
    const preset = RealtimeSubscriptionsPreset({});

    expect(preset.plugins).toHaveLength(1);
    const plugin = preset.plugins![0];
    expect(plugin).toBeDefined();
  });
});
