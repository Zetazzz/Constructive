import { join } from 'path';
import { getConnectionsObject, seed } from 'graphile-test';
import type { GraphQLQueryFnObj } from 'graphile-test';
import { BulkMutationPreset } from '../src';

const SCHEMA = 'bulk_test';
const sqlFile = (f: string) => join(__dirname, '../sql', f);

type QueryFn = GraphQLQueryFnObj;

// Shared setup for all test groups — single schema build is expensive
let teardown: () => Promise<void>;
let query: QueryFn;

beforeAll(async () => {
  const testPreset = {
    extends: [BulkMutationPreset()],
  };

  const connections = await getConnectionsObject(
    {
      schemas: [SCHEMA],
      preset: testPreset,
      useRoot: true,
    },
    [seed.sqlfile([sqlFile('test-seed.sql')])]
  );

  teardown = connections.teardown;
  query = connections.query;
}, 30_000);

afterAll(async () => {
  if (teardown) await teardown();
});

// ============================================================================
// SCHEMA GENERATION
// ============================================================================
describe('Schema generation', () => {
  let fieldNames: string[];

  beforeAll(async () => {
    const result = await query<{ __type: { fields: { name: string }[] } }>({
      query: `
        query {
          __type(name: "Mutation") {
            fields { name }
          }
        }
      `,
    });
    fieldNames = result.data?.__type?.fields?.map((f) => f.name) ?? [];
  });

  it('generates bulk insert/upsert/update/delete for items (all behaviors)', () => {
    expect(fieldNames).toContain('bulkCreateItems');
    expect(fieldNames).toContain('bulkUpsertItems');
    expect(fieldNames).toContain('bulkUpdateItems');
    expect(fieldNames).toContain('bulkDeleteItems');
  });

  it('generates only insert + upsert for categories', () => {
    expect(fieldNames).toContain('bulkCreateCategories');
    expect(fieldNames).toContain('bulkUpsertCategories');
    expect(fieldNames).not.toContain('bulkUpdateCategories');
    expect(fieldNames).not.toContain('bulkDeleteCategories');
  });

  it('generates insert + update + delete for products (no upsert)', () => {
    expect(fieldNames).toContain('bulkCreateProducts');
    expect(fieldNames).not.toContain('bulkUpsertProducts');
    expect(fieldNames).toContain('bulkUpdateProducts');
    expect(fieldNames).toContain('bulkDeleteProducts');
  });

  it('does NOT generate bulk mutations for non-tagged tables', () => {
    const noBulk = fieldNames.filter(
      (n) => n.includes('NoBulk') && n.startsWith('bulk')
    );
    expect(noBulk).toHaveLength(0);
  });
});

// ============================================================================
// BULK INSERT
// ============================================================================
describe('Bulk insert', () => {
  it('inserts multiple rows', async () => {
    const result = await query<{
      bulkCreateItems: { affectedCount: number };
    }>({
      query: `
        mutation {
          bulkCreateItems(input: {
            values: [
              { name: "New A", price: "1.00", quantity: 1 }
              { name: "New B", price: "2.00", quantity: 2 }
            ]
          }) {
            affectedCount
          }
        }
      `,
    });
    expect(result.errors).toBeUndefined();
    expect(result.data?.bulkCreateItems.affectedCount).toBe(2);
  });

  it('returns zero when values is empty', async () => {
    const result = await query<{
      bulkCreateItems: { affectedCount: number };
    }>({
      query: `
        mutation {
          bulkCreateItems(input: { values: [] }) {
            affectedCount
          }
        }
      `,
    });
    expect(result.errors).toBeUndefined();
    expect(result.data?.bulkCreateItems.affectedCount).toBe(0);
  });

  it('supports ON CONFLICT DO NOTHING (ignore duplicates)', async () => {
    const result = await query<{
      bulkCreateItems: { affectedCount: number };
    }>({
      query: `
        mutation {
          bulkCreateItems(input: {
            values: [
              { name: "Widget A", price: "1.00", quantity: 1 }
              { name: "Brand New", price: "5.00", quantity: 5 }
            ]
            onConflict: {
              constraint: ITEMS_NAME_KEY
              action: IGNORE
            }
          }) {
            affectedCount
          }
        }
      `,
    });
    expect(result.errors).toBeUndefined();
    // Widget A already exists, should be ignored; Brand New is new
    expect(result.data?.bulkCreateItems.affectedCount).toBe(1);
  });
});

// ============================================================================
// BULK UPSERT
// ============================================================================
describe('Bulk upsert', () => {
  it('upserts rows (inserts new, updates existing)', async () => {
    const result = await query<{
      bulkUpsertItems: { affectedCount: number };
    }>({
      query: `
        mutation {
          bulkUpsertItems(input: {
            values: [
              { name: "Widget A", price: "99.99", quantity: 999 }
              { name: "Upserted New", price: "3.00", quantity: 3 }
            ]
            onConflict: {
              constraint: ITEMS_NAME_KEY
            }
          }) {
            affectedCount
          }
        }
      `,
    });
    expect(result.errors).toBeUndefined();
    expect(result.data?.bulkUpsertItems.affectedCount).toBe(2);
  });
});

// ============================================================================
// BULK UPDATE
// ============================================================================
describe('Bulk update', () => {
  it('updates rows matching a condition', async () => {
    const result = await query<{
      bulkUpdateItems: { affectedCount: number };
    }>({
      query: `
        mutation {
          bulkUpdateItems(input: {
            where: { name: "Gadget X" }
            patch: { quantity: 0 }
          }) {
            affectedCount
          }
        }
      `,
    });
    expect(result.errors).toBeUndefined();
    expect(result.data?.bulkUpdateItems.affectedCount).toBe(1);
  });
});

// ============================================================================
// BULK DELETE
// ============================================================================
describe('Bulk delete', () => {
  it('deletes rows matching a condition', async () => {
    const result = await query<{
      bulkDeleteItems: { affectedCount: number };
    }>({
      query: `
        mutation {
          bulkDeleteItems(input: {
            where: { name: "Gadget X" }
          }) {
            affectedCount
          }
        }
      `,
    });
    expect(result.errors).toBeUndefined();
    expect(result.data?.bulkDeleteItems.affectedCount).toBe(1);
  });
});
