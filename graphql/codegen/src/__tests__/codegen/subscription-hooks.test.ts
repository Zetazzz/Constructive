/**
 * Snapshot tests for subscription hook generators
 *
 * Tests the generated hook code for:
 * - Per-table subscription hooks (useContactSubscription, etc.)
 * - Connection state hook (useConnectionState)
 * - Subscription barrel file
 */
import { generateSubscriptionsBarrel } from '../../core/codegen/barrel';
import { generate } from '../../core/codegen/index';
import {
  generateAllSubscriptionHooks,
  generateConnectionStateHook,
  generateSubscriptionHook,
} from '../../core/codegen/subscriptions';
import {
  getSubscriptionFieldName,
  getSubscriptionFileName,
  getSubscriptionHookName,
} from '../../core/codegen/utils';
import type { FieldType, Relations, Table } from '../../types/schema';

const fieldTypes = {
  uuid: { gqlType: 'UUID', isArray: false } as FieldType,
  string: { gqlType: 'String', isArray: false } as FieldType,
  int: { gqlType: 'Int', isArray: false } as FieldType,
  datetime: { gqlType: 'Datetime', isArray: false } as FieldType,
  boolean: { gqlType: 'Boolean', isArray: false } as FieldType,
};

const emptyRelations: Relations = {
  belongsTo: [],
  hasOne: [],
  hasMany: [],
  manyToMany: [],
};

function createTable(partial: Partial<Table> & { name: string }): Table {
  return {
    name: partial.name,
    fields: partial.fields ?? [],
    relations: partial.relations ?? emptyRelations,
    query: partial.query,
    inflection: partial.inflection,
    constraints: partial.constraints,
    smartTags: partial.smartTags,
  };
}

const contactTable = createTable({
  name: 'Contact',
  fields: [
    { name: 'id', type: fieldTypes.uuid },
    { name: 'firstName', type: fieldTypes.string },
    { name: 'lastName', type: fieldTypes.string },
    { name: 'email', type: fieldTypes.string },
    { name: 'createdAt', type: fieldTypes.datetime },
  ],
  query: {
    all: 'contacts',
    one: 'contact',
    create: 'createContact',
    update: 'updateContact',
    delete: 'deleteContact',
  },
});

const contactTableWithRealtime = createTable({
  name: 'Contact',
  fields: [
    { name: 'id', type: fieldTypes.uuid },
    { name: 'firstName', type: fieldTypes.string },
    { name: 'lastName', type: fieldTypes.string },
    { name: 'email', type: fieldTypes.string },
    { name: 'createdAt', type: fieldTypes.datetime },
  ],
  query: {
    all: 'contacts',
    one: 'contact',
    create: 'createContact',
    update: 'updateContact',
    delete: 'deleteContact',
  },
  smartTags: { '@realtime': true },
});

const projectTable = createTable({
  name: 'Project',
  fields: [
    { name: 'id', type: fieldTypes.uuid },
    { name: 'name', type: fieldTypes.string },
    { name: 'active', type: fieldTypes.boolean },
    { name: 'createdAt', type: fieldTypes.datetime },
  ],
  query: {
    all: 'projects',
    one: 'project',
    create: 'createProject',
    update: 'updateProject',
    delete: 'deleteProject',
  },
});

const projectTableWithRealtime = createTable({
  name: 'Project',
  fields: [
    { name: 'id', type: fieldTypes.uuid },
    { name: 'name', type: fieldTypes.string },
    { name: 'active', type: fieldTypes.boolean },
    { name: 'createdAt', type: fieldTypes.datetime },
  ],
  query: {
    all: 'projects',
    one: 'project',
    create: 'createProject',
    update: 'updateProject',
    delete: 'deleteProject',
  },
  smartTags: { '@realtime': true },
});

describe('Subscription naming utils', () => {
  it('generates subscription hook name', () => {
    expect(getSubscriptionHookName(contactTable)).toBe(
      'useContactSubscription',
    );
    expect(getSubscriptionHookName(projectTable)).toBe(
      'useProjectSubscription',
    );
  });

  it('generates subscription file name', () => {
    expect(getSubscriptionFileName(contactTable)).toBe(
      'useContactSubscription.ts',
    );
  });

  it('generates subscription field name', () => {
    expect(getSubscriptionFieldName(contactTable)).toBe('onContactChanged');
    expect(getSubscriptionFieldName(projectTable)).toBe('onProjectChanged');
  });
});

describe('Subscription Hook Generator', () => {
  describe('generateSubscriptionHook', () => {
    it('generates subscription hook for Contact table', () => {
      const result = generateSubscriptionHook(contactTable);
      expect(result.fileName).toBe('useContactSubscription.ts');
      expect(result.content).toMatchSnapshot();
    });

    it('generates subscription hook for Project table', () => {
      const result = generateSubscriptionHook(projectTable);
      expect(result.fileName).toBe('useProjectSubscription.ts');
      expect(result.content).toMatchSnapshot();
    });

    it('includes subscription document with correct field name', () => {
      const result = generateSubscriptionHook(contactTable);
      expect(result.content).toContain('onContactChanged');
      expect(result.content).toContain('SUBSCRIPTION_DOCUMENT');
    });

    it('includes field metadata constant', () => {
      const result = generateSubscriptionHook(contactTable);
      expect(result.content).toContain('FIELD_META');
      expect(result.content).toContain('"onContactChanged"');
      expect(result.content).toContain('"contact"');
    });

    it('imports from ORM client for types', () => {
      const result = generateSubscriptionHook(contactTable);
      expect(result.content).toContain('../../orm/client');
      expect(result.content).toContain('SubscriptionEvent');
      expect(result.content).toContain('Unsubscribe');
    });

    it('imports query keys for cache invalidation', () => {
      const result = generateSubscriptionHook(contactTable);
      expect(result.content).toContain('contactKeys');
      expect(result.content).toContain('invalidateQueries');
    });

    it('exports options interface', () => {
      const result = generateSubscriptionHook(contactTable);
      expect(result.content).toContain('ContactSubscriptionOptions');
    });

    it('includes useEffect for subscription lifecycle', () => {
      const result = generateSubscriptionHook(contactTable);
      expect(result.content).toContain('useEffect');
      expect(result.content).toContain('useRef');
    });

    it('checks isRealtimeEnabled before subscribing', () => {
      const result = generateSubscriptionHook(contactTable);
      expect(result.content).toContain('isRealtimeEnabled');
    });

    it('re-exports SubscriptionEvent type', () => {
      const result = generateSubscriptionHook(contactTable);
      // Should re-export for consumer convenience
      expect(result.content).toContain('SubscriptionEvent');
    });
  });

  describe('generateAllSubscriptionHooks', () => {
    it('generates hooks for all tables', () => {
      const results = generateAllSubscriptionHooks([
        contactTable,
        projectTable,
      ]);
      expect(results).toHaveLength(2);
      expect(results[0].fileName).toBe('useContactSubscription.ts');
      expect(results[1].fileName).toBe('useProjectSubscription.ts');
    });

    it('returns empty array for no tables', () => {
      const results = generateAllSubscriptionHooks([]);
      expect(results).toHaveLength(0);
    });
  });
});

describe('Connection State Hook Generator', () => {
  describe('generateConnectionStateHook', () => {
    it('generates useConnectionState hook', () => {
      const result = generateConnectionStateHook();
      expect(result.fileName).toBe('useConnectionState.ts');
      expect(result.content).toMatchSnapshot();
    });

    it('imports ConnectionState type from ORM client', () => {
      const result = generateConnectionStateHook();
      expect(result.content).toContain('ConnectionState');
      expect(result.content).toContain('../../orm/client');
    });

    it('uses useState and useEffect', () => {
      const result = generateConnectionStateHook();
      expect(result.content).toContain('useState');
      expect(result.content).toContain('useEffect');
    });

    it('calls getClient for connection state', () => {
      const result = generateConnectionStateHook();
      expect(result.content).toContain('getClient');
      expect(result.content).toContain('getConnectionState');
    });

    it('subscribes to connection state changes', () => {
      const result = generateConnectionStateHook();
      expect(result.content).toContain('onConnectionStateChange');
    });

    it('checks isRealtimeEnabled', () => {
      const result = generateConnectionStateHook();
      expect(result.content).toContain('isRealtimeEnabled');
    });

    it('re-exports ConnectionState type', () => {
      const result = generateConnectionStateHook();
      expect(result.content).toContain('ConnectionState');
    });
  });
});

describe('Subscription Barrel Generator', () => {
  it('generates barrel with subscription hooks and connection state', () => {
    const result = generateSubscriptionsBarrel([contactTable, projectTable]);
    expect(result).toMatchSnapshot();
  });

  it('includes connection state hook export', () => {
    const result = generateSubscriptionsBarrel([contactTable]);
    expect(result).toContain('./useConnectionState');
  });

  it('includes per-table subscription hook exports', () => {
    const result = generateSubscriptionsBarrel([contactTable, projectTable]);
    expect(result).toContain('./useContactSubscription');
    expect(result).toContain('./useProjectSubscription');
  });
});

describe('Smart Tag Gating', () => {
  const minConfig = {
    tables: { include: [], exclude: [], systemExclude: [] },
    queries: { include: [], exclude: [], systemExclude: [] },
    mutations: { include: [], exclude: [], systemExclude: [] },
    codegen: { skipQueryField: false },
    reactQuery: true,
  } as any;

  it('does not generate subscription hooks when no tables have @realtime', () => {
    const result = generate({
      tables: [contactTable, projectTable],
      config: minConfig,
    });
    expect(result.stats.subscriptionHooks).toBe(0);
    const subFiles = result.files.filter((f) => f.path.startsWith('subscriptions/'));
    expect(subFiles).toHaveLength(0);
  });

  it('generates subscription hooks only for tables with @realtime', () => {
    const result = generate({
      tables: [contactTableWithRealtime, projectTable],
      config: minConfig,
    });
    expect(result.stats.subscriptionHooks).toBe(1);
    const subFiles = result.files.filter((f) => f.path.startsWith('subscriptions/'));
    expect(subFiles.some((f) => f.path.includes('useContactSubscription'))).toBe(true);
    expect(subFiles.some((f) => f.path.includes('useProjectSubscription'))).toBe(false);
    expect(subFiles.some((f) => f.path.includes('useConnectionState'))).toBe(true);
    expect(subFiles.some((f) => f.path === 'subscriptions/index.ts')).toBe(true);
  });

  it('generates subscription hooks for all @realtime tables', () => {
    const result = generate({
      tables: [contactTableWithRealtime, projectTableWithRealtime],
      config: minConfig,
    });
    expect(result.stats.subscriptionHooks).toBe(2);
    const subFiles = result.files.filter((f) => f.path.startsWith('subscriptions/'));
    expect(subFiles.some((f) => f.path.includes('useContactSubscription'))).toBe(true);
    expect(subFiles.some((f) => f.path.includes('useProjectSubscription'))).toBe(true);
  });

  it('does not emit useConnectionState or barrel when no @realtime tables', () => {
    const result = generate({
      tables: [contactTable],
      config: minConfig,
    });
    const subFiles = result.files.filter((f) => f.path.startsWith('subscriptions/'));
    expect(subFiles).toHaveLength(0);
    const mainBarrel = result.files.find((f) => f.path === 'index.ts');
    expect(mainBarrel?.content).not.toContain('./subscriptions');
  });

  it('emits subscriptions barrel in main index when @realtime tables exist', () => {
    const result = generate({
      tables: [contactTableWithRealtime],
      config: minConfig,
    });
    const mainBarrel = result.files.find((f) => f.path === 'index.ts');
    expect(mainBarrel?.content).toContain('./subscriptions');
  });
});
