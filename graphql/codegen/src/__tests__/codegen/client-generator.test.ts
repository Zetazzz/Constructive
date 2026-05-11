/**
 * Snapshot tests for ORM client-generator.ts
 *
 * Tests the generated ORM client files: client.ts, query-builder.ts, select-types.ts, index.ts
 */
import {
  generateCreateClientFile,
  generateOrmClientFile,
  generateQueryBuilderFile,
  generateSelectTypesFile,
} from '../../core/codegen/orm/client-generator';
import type {
  FieldType,
  Relations,
  Table,
} from '../../types/schema';

// ============================================================================
// Test Fixtures
// ============================================================================

const fieldTypes = {
  uuid: { gqlType: 'UUID', isArray: false } as FieldType,
  string: { gqlType: 'String', isArray: false } as FieldType,
};

const emptyRelations: Relations = {
  belongsTo: [],
  hasOne: [],
  hasMany: [],
  manyToMany: [],
};

function createTable(
  partial: Partial<Table> & { name: string },
): Table {
  return {
    name: partial.name,
    fields: partial.fields ?? [],
    relations: partial.relations ?? emptyRelations,
    query: partial.query,
    inflection: partial.inflection,
    constraints: partial.constraints,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('client-generator', () => {
  describe('generateOrmClientFile', () => {
    it('generates OrmClient class with execute method', () => {
      const result = generateOrmClientFile();

      expect(result.fileName).toBe('client.ts');
      expect(result.content).toMatchSnapshot();
      expect(result.content).toContain('class OrmClient');
      expect(result.content).toContain('execute<T>');
      expect(result.content).toContain('QueryResult<T>');
      expect(result.content).toContain('GraphQLRequestError');
    });

    it('exposes an optional fetch injection in OrmClientConfig', () => {
      const result = generateOrmClientFile();

      expect(result.content).toContain('fetch?: typeof globalThis.fetch');
      expect(result.content).toContain('config.fetch');
    });

    it('imports createFetch from @constructive-io/graphql-query/runtime', () => {
      const result = generateOrmClientFile();

      expect(result.content).toContain(
        "import { createFetch } from '@constructive-io/graphql-query/runtime'",
      );
      expect(result.content).toContain('createFetch()');
    });

    it('FetchAdapter constructor binds the selected fetch function to globalThis', () => {
      const result = generateOrmClientFile();

      // Must match the exact constructor assignment with correct precedence:
      // this.fetchFn = (fetchFn ?? createFetch()).bind(globalThis);
      // Guards against a stray .bind(globalThis) in a comment or wrong
      // precedence like fetchFn ?? createFetch().bind(globalThis).
      expect(result.content).toMatch(
        /this\.fetchFn\s*=\s*\(\s*fetchFn\s*\?\?\s*createFetch\(\)\s*\)\.bind\(globalThis\)\s*;/,
      );
      expect(result.content).not.toMatch(
        /fetchFn\s*\?\?\s*createFetch\(\)\.bind\(globalThis\)/,
      );
    });

    it('FetchAdapter can execute with a this-sensitive native fetch', async () => {
      // Simulate browser window.fetch: rejects with TypeError when this
      // is not the original Window (Chrome rejects asynchronously).
      function strictFetch(this: unknown): Promise<Response> {
        if (this !== globalThis) {
          return Promise.reject(new TypeError('Illegal invocation'));
        }
        return Promise.resolve(
          new Response(JSON.stringify({ data: { answer: 42 } })),
        );
      }

      // Replicate the exact constructor pattern generated in FetchAdapter.
      class TestFetchAdapter {
        private fetchFn: typeof globalThis.fetch;
        constructor(fetchFn?: typeof globalThis.fetch) {
          this.fetchFn = (fetchFn ?? strictFetch).bind(globalThis);
        }
        async callFetch(): Promise<Response> {
          return this.fetchFn('http://test', { method: 'POST' } as RequestInit);
        }
      }

      // Without .bind(globalThis) this would reject with TypeError.
      const adapter = new TestFetchAdapter(strictFetch);
      const response = await adapter.callFetch();
      expect(response.ok).toBe(true);
      const json = (await response.json()) as { data: { answer: number } };
      expect(json.data).toEqual({ answer: 42 });
    });

    it('FetchAdapter from generated output binds fetch to globalThis at runtime', async () => {
      // Simulate browser window.fetch: Chrome returns a Promise that rejects
      // with TypeError when `this` is not the original Window.
      function strictFetch(this: unknown): Promise<Response> {
        if (this !== globalThis) {
          return Promise.reject(new TypeError('Illegal invocation'));
        }
        return Promise.resolve(
          new Response(JSON.stringify({ data: { answer: 99 } })),
        );
      }

      // Mock createFetch so the default path also uses strictFetch.
      const mockCreateFetch = () => strictFetch;

      // ------------------------------------------------------------------
      // Extract the ACTUAL fetchFn assignment expression from generated code
      // (not a hand-copied replica). This closes the drift gap: if the
      // template changes, the extraction fails or the runtime test breaks.
      // ------------------------------------------------------------------
      const generated = generateOrmClientFile().content;
      const assignmentMatch = generated.match(
        /this\.fetchFn\s*=\s*([^;]+);/,
      );
      expect(assignmentMatch).not.toBeNull();
      const assignmentRhs = assignmentMatch![1].trim();
      // e.g. "(fetchFn ?? createFetch()).bind(globalThis)"

      // Build a minimal FetchAdapter using the EXTRACTED assignment from
      // the generated source. new Function() gives us a JS-evaluable class
      // whose constructor body is driven by the real template output.
      const EvalFetchAdapter = new Function(
        'createFetch',
        `
        return class FetchAdapter {
          constructor(endpoint, headers, fetchFn) {
            this.fetchFn = ${assignmentRhs};
          }
          callFetch() {
            return this.fetchFn('http://test', { method: 'POST' });
          }
        };
        `,
      )(mockCreateFetch);

      // --- Case 1: explicit strictFetch passed in ---
      // With correct precedence (fetchFn ?? createFetch()).bind(globalThis),
      // the provided strictFetch is bound to globalThis and succeeds.
      const adapter = new (EvalFetchAdapter as new (
        endpoint: string,
        headers: Record<string, string> | undefined,
        fetchFn?: typeof globalThis.fetch,
      ) => { fetchFn: typeof globalThis.fetch; callFetch: () => Promise<Response> })(
        'http://test',
        {},
        strictFetch,
      );
      const response = await adapter.callFetch();
      expect(response.ok).toBe(true);
      const json = (await response.json()) as { data: { answer: number } };
      expect(json.data).toEqual({ answer: 99 });

      // --- Case 2: no custom fetch (falls back to createFetch()) ---
      const adapterDefault = new (EvalFetchAdapter as new (
        endpoint: string,
        headers: Record<string, string> | undefined,
        fetchFn?: typeof globalThis.fetch,
      ) => { fetchFn: typeof globalThis.fetch; callFetch: () => Promise<Response> })(
        'http://test',
        {},
        undefined,
      );
      const responseDefault = await adapterDefault.callFetch();
      expect(responseDefault.ok).toBe(true);
    });

    it('wrong precedence fetchFn ?? createFetch().bind(globalThis) fails with strict fetch', async () => {
      // This test proves the precedence matters at runtime.
      // If the generated code used the wrong precedence
      //   fetchFn ?? createFetch().bind(globalThis)
      // then a provided fetchFn would NOT be bound to globalThis.
      function strictFetch(this: unknown): Promise<Response> {
        if (this !== globalThis) {
          return Promise.reject(new TypeError('Illegal invocation'));
        }
        return Promise.resolve(new Response('ok'));
      }

      const mockCreateFetch = () => strictFetch;

      // WRONG precedence: .bind(globalThis) only applies to createFetch(),
      // not to the provided fetchFn.
      const WrongPrecedenceAdapter = new Function(
        'createFetch',
        `
        return class {
          constructor(endpoint, headers, fetchFn) {
            this.fetchFn = fetchFn ?? createFetch().bind(globalThis);
          }
          callFetch() {
            return this.fetchFn('http://test', { method: 'POST' });
          }
        };
        `,
      )(mockCreateFetch);

      const adapter = new (WrongPrecedenceAdapter as new (
        endpoint: string,
        headers: Record<string, string> | undefined,
        fetchFn?: typeof globalThis.fetch,
      ) => { callFetch: () => Promise<Response> })(
        'http://test',
        {},
        strictFetch,
      );

      await expect(adapter.callFetch()).rejects.toThrow('Illegal invocation');
    });
  });

  describe('generateQueryBuilderFile', () => {
    it('generates QueryBuilder with gql-ast document builders', () => {
      const result = generateQueryBuilderFile();

      expect(result.fileName).toBe('query-builder.ts');
      expect(result.content).toContain('class QueryBuilder');
      expect(result.content).toContain('buildFindManyDocument');
      expect(result.content).toContain('buildFindFirstDocument');
      expect(result.content).toContain('buildCreateDocument');
      expect(result.content).toContain('buildUpdateDocument');
      expect(result.content).toContain('buildDeleteDocument');
      expect(result.content).toContain("import * as t from 'gql-ast'");
    });
  });

  describe('generateSelectTypesFile', () => {
    it('generates select type utilities', () => {
      const result = generateSelectTypesFile();

      expect(result.fileName).toBe('select-types.ts');
      expect(result.content).toMatchSnapshot();
      expect(result.content).toContain('ConnectionResult');
      expect(result.content).toContain('PageInfo');
      expect(result.content).toContain('FindManyArgs');
      expect(result.content).toContain('DeepExact');
      expect(result.content).toContain('InferSelectResult');
    });
  });

  describe('generateCreateClientFile', () => {
    it('generates createClient factory with models', () => {
      const tables = [
        createTable({
          name: 'User',
          fields: [{ name: 'id', type: fieldTypes.uuid }],
          query: {
            all: 'users',
            one: 'user',
            create: 'createUser',
            update: 'updateUser',
            delete: 'deleteUser',
          },
        }),
        createTable({
          name: 'Post',
          fields: [{ name: 'id', type: fieldTypes.uuid }],
          query: {
            all: 'posts',
            one: 'post',
            create: 'createPost',
            update: 'updatePost',
            delete: 'deletePost',
          },
        }),
      ];

      const result = generateCreateClientFile(tables, false, false);

      expect(result.fileName).toBe('index.ts');
      expect(result.content).toMatchSnapshot();
      expect(result.content).toContain('createClient');
      expect(result.content).toContain('UserModel');
      expect(result.content).toContain('PostModel');
    });

    it('includes custom query/mutation operations when available', () => {
      const tables = [
        createTable({
          name: 'User',
          fields: [{ name: 'id', type: fieldTypes.uuid }],
          query: {
            all: 'users',
            one: 'user',
            create: 'createUser',
            update: 'updateUser',
            delete: 'deleteUser',
          },
        }),
      ];

      const result = generateCreateClientFile(tables, true, true);

      expect(result.content).toMatchSnapshot();
      expect(result.content).toContain('createQueryOperations');
      expect(result.content).toContain('createMutationOperations');
      expect(result.content).toContain('query: createQueryOperations(client)');
      expect(result.content).toContain(
        'mutation: createMutationOperations(client)',
      );
    });
  });
});
