/**
 * Tests for the realtime subscriptions plugin.
 *
 * Covers:
 * - Table discovery via @realtime smart tag
 * - Subscription field generation (onXxxChanged)
 * - Payload type generation (XxxSubscriptionPayload)
 * - NOTIFY channel naming (realtime:{schema}.{table})
 * - Tables without @realtime tag are excluded
 * - Empty registry produces no fields
 * - Multiple realtime tables produce multiple fields
 */

jest.mock('@pgpmjs/logger', () => ({
  Logger: jest.fn().mockImplementation(() => ({
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  })),
}));

const mockListen = jest.fn();
const mockConstant = jest.fn((val: any) => `constant(${val})`);
const mockObject = jest.fn((obj: any) => obj);
const mockContext = jest.fn(() => ({
  get: jest.fn((key: string) => `mock-${key}`),
}));

jest.mock('grafast', () => ({
  context: mockContext,
  listen: mockListen,
  object: mockObject,
  constant: mockConstant,
}));

let capturedFactory: Function | null = null;
jest.mock('graphile-utils', () => ({
  extendSchema: jest.fn((factory: any, name: string) => {
    capturedFactory = factory;
    return {
      name,
      version: '0.1.0',
      schema: { hooks: {} },
    };
  }),
  gql: jest.fn((strings: TemplateStringsArray) => strings.join('')),
}));

import { createRealtimeSubscriptionsPlugin, RealtimeSubscriptionsPlugin } from '../src/plugin';

// --- Test helpers ---

function createMockCodec(
  name: string,
  opts: {
    realtime?: boolean;
    schemaName?: string;
    attributes?: Record<string, any>;
  } = {},
) {
  const { realtime = false, schemaName = 'app_public', attributes = { id: {} } } = opts;
  return {
    name,
    attributes,
    extensions: {
      tags: realtime ? { realtime: true } : {},
      pg: { schemaName, name },
    },
  };
}

function createMockResource(name: string, codec: any) {
  return { codec, name };
}

function createMockBuild(resources: Record<string, any>, inflectionOverrides: Record<string, any> = {}) {
  return {
    input: {
      pgRegistry: {
        pgResources: resources,
      },
    },
    inflection: {
      tableType: (codec: any) => {
        const name = codec.name;
        return name.charAt(0).toUpperCase() + name.slice(1).replace(/_([a-z])/g, (_: string, c: string) => c.toUpperCase());
      },
      ...inflectionOverrides,
    },
  };
}

// --- Tests ---

describe('createRealtimeSubscriptionsPlugin', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    capturedFactory = null;
  });

  describe('plugin structure', () => {
    it('returns a plugin object with name', () => {
      const plugin = createRealtimeSubscriptionsPlugin();

      expect(plugin).toBeDefined();
      expect(plugin.name).toBe('RealtimeSubscriptionsPlugin');
    });

    it('exports RealtimeSubscriptionsPlugin as alias', () => {
      expect(RealtimeSubscriptionsPlugin).toBe(createRealtimeSubscriptionsPlugin);
    });
  });

  describe('table discovery', () => {
    it('discovers tables with @realtime tag', () => {
      createRealtimeSubscriptionsPlugin();

      const codec = createMockCodec('projects', { realtime: true });
      const build = createMockBuild({
        projects: createMockResource('projects', codec),
      });

      const result = capturedFactory!(build);

      expect(result.typeDefs).toContain('onProjectsChanged');
      expect(result.typeDefs).toContain('ProjectsSubscriptionPayload');
    });

    it('skips tables without @realtime tag', () => {
      createRealtimeSubscriptionsPlugin();

      const codec = createMockCodec('users', { realtime: false });
      const build = createMockBuild({
        users: createMockResource('users', codec),
      });

      const result = capturedFactory!(build);

      expect(result.typeDefs).toBe('');
      expect(result.plans).toEqual({});
    });

    it('skips resources without codec attributes (functions, etc.)', () => {
      createRealtimeSubscriptionsPlugin();

      const build = createMockBuild({
        my_function: { codec: { name: 'my_function' }, name: 'my_function' },
      });

      const result = capturedFactory!(build);

      expect(result.typeDefs).toBe('');
      expect(result.plans).toEqual({});
    });

    it('returns empty when registry has no resources', () => {
      createRealtimeSubscriptionsPlugin();

      const build = createMockBuild({});
      const result = capturedFactory!(build);

      expect(result.typeDefs).toBe('');
      expect(result.plans).toEqual({});
    });

    it('discovers multiple realtime tables', () => {
      createRealtimeSubscriptionsPlugin();

      const projectsCodec = createMockCodec('projects', { realtime: true });
      const tasksCodec = createMockCodec('tasks', { realtime: true });
      const usersCodec = createMockCodec('users', { realtime: false });

      const build = createMockBuild({
        projects: createMockResource('projects', projectsCodec),
        tasks: createMockResource('tasks', tasksCodec),
        users: createMockResource('users', usersCodec),
      });

      const result = capturedFactory!(build);

      expect(result.typeDefs).toContain('onProjectsChanged');
      expect(result.typeDefs).toContain('onTasksChanged');
      expect(result.typeDefs).not.toContain('onUsersChanged');
    });
  });

  describe('type definitions', () => {
    it('generates subscription field with optional id argument', () => {
      createRealtimeSubscriptionsPlugin();

      const codec = createMockCodec('documents', { realtime: true });
      const build = createMockBuild({
        documents: createMockResource('documents', codec),
      });

      const result = capturedFactory!(build);

      expect(result.typeDefs).toContain('onDocumentsChanged(id: UUID): DocumentsSubscriptionPayload');
    });

    it('generates payload type with event and row fields', () => {
      createRealtimeSubscriptionsPlugin();

      const codec = createMockCodec('documents', { realtime: true });
      const build = createMockBuild({
        documents: createMockResource('documents', codec),
      });

      const result = capturedFactory!(build);

      expect(result.typeDefs).toContain('type DocumentsSubscriptionPayload');
      expect(result.typeDefs).toContain('event: String!');
      expect(result.typeDefs).toContain('documents: Documents');
    });

    it('extends Subscription type', () => {
      createRealtimeSubscriptionsPlugin();

      const codec = createMockCodec('projects', { realtime: true });
      const build = createMockBuild({
        projects: createMockResource('projects', codec),
      });

      const result = capturedFactory!(build);

      expect(result.typeDefs).toMatch(/^extend type Subscription \{/);
    });
  });

  describe('NOTIFY channel naming', () => {
    it('uses realtime:{schema}.{table} format', () => {
      createRealtimeSubscriptionsPlugin();

      const codec = createMockCodec('projects', {
        realtime: true,
        schemaName: 'app_public',
      });
      const build = createMockBuild({
        projects: createMockResource('projects', codec),
      });

      const result = capturedFactory!(build);

      // The subscribePlan should reference the correct topic
      expect(result.plans).toBeDefined();
      expect(result.plans['Subscription']).toBeDefined();
      expect(result.plans['Subscription']['onProjectsChanged']).toBeDefined();

      // Invoke subscribePlan to verify it calls constant() with the right channel
      const mockArgs = { get: jest.fn(() => 'test-id') };
      result.plans['Subscription']['onProjectsChanged'].subscribePlan(null, mockArgs);

      expect(mockConstant).toHaveBeenCalledWith('realtime:app_public.projects');
    });

    it('handles different schema names', () => {
      createRealtimeSubscriptionsPlugin();

      const codec = createMockCodec('items', {
        realtime: true,
        schemaName: 'inventory_public',
      });
      const build = createMockBuild({
        items: createMockResource('items', codec),
      });

      const result = capturedFactory!(build);

      const mockArgs = { get: jest.fn(() => 'test-id') };
      result.plans['Subscription']['onItemsChanged'].subscribePlan(null, mockArgs);

      expect(mockConstant).toHaveBeenCalledWith('realtime:inventory_public.items');
    });
  });

  describe('plan generation', () => {
    it('generates subscribePlan and plan for each table', () => {
      createRealtimeSubscriptionsPlugin();

      const codec = createMockCodec('projects', { realtime: true });
      const build = createMockBuild({
        projects: createMockResource('projects', codec),
      });

      const result = capturedFactory!(build);
      const subscriptionPlan = result.plans['Subscription']['onProjectsChanged'];

      expect(typeof subscriptionPlan.subscribePlan).toBe('function');
      expect(typeof subscriptionPlan.plan).toBe('function');
    });

    it('subscribePlan calls listen with pgSubscriber and topic', () => {
      createRealtimeSubscriptionsPlugin();

      const codec = createMockCodec('tasks', { realtime: true });
      const build = createMockBuild({
        tasks: createMockResource('tasks', codec),
      });

      const result = capturedFactory!(build);
      const mockArgs = { get: jest.fn(() => 'some-id') };

      result.plans['Subscription']['onTasksChanged'].subscribePlan(null, mockArgs);

      expect(mockContext).toHaveBeenCalled();
      expect(mockListen).toHaveBeenCalled();
    });

    it('plan function returns event as-is', () => {
      createRealtimeSubscriptionsPlugin();

      const codec = createMockCodec('tasks', { realtime: true });
      const build = createMockBuild({
        tasks: createMockResource('tasks', codec),
      });

      const result = capturedFactory!(build);
      const mockEvent = { get: jest.fn() };

      const planResult = result.plans['Subscription']['onTasksChanged'].plan(mockEvent);
      expect(planResult).toBe(mockEvent);
    });

    it('generates payload type plans with event and row resolvers', () => {
      createRealtimeSubscriptionsPlugin();

      const codec = createMockCodec('tasks', { realtime: true });
      const mockResource = createMockResource('tasks', codec);
      const build = createMockBuild({
        tasks: mockResource,
      });

      const result = capturedFactory!(build);
      const payloadPlan = result.plans['TasksSubscriptionPayload'];

      expect(payloadPlan).toBeDefined();
      expect(typeof payloadPlan.event).toBe('function');
      expect(typeof payloadPlan.tasks).toBe('function');
    });

    it('payload event resolver calls parent.get("event")', () => {
      createRealtimeSubscriptionsPlugin();

      const codec = createMockCodec('tasks', { realtime: true });
      const build = createMockBuild({
        tasks: createMockResource('tasks', codec),
      });

      const result = capturedFactory!(build);
      const mockParent = { get: jest.fn(() => 'INSERT') };

      result.plans['TasksSubscriptionPayload'].event(mockParent);
      expect(mockParent.get).toHaveBeenCalledWith('event');
    });

    it('payload row resolver calls resource.get with subscribed id', () => {
      createRealtimeSubscriptionsPlugin();

      const codec = createMockCodec('tasks', { realtime: true });
      const mockResource = {
        ...createMockResource('tasks', codec),
        get: jest.fn(),
      };
      const build = createMockBuild({
        tasks: mockResource,
      });

      const result = capturedFactory!(build);
      const mockParent = { get: jest.fn(() => 'test-uuid') };

      result.plans['TasksSubscriptionPayload'].tasks(mockParent);
      expect(mockParent.get).toHaveBeenCalledWith('subscribedId');
      expect(mockResource.get).toHaveBeenCalledWith({ id: 'test-uuid' });
    });
  });
});
