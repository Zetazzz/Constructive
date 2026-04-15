import { PgMultiTenancyWrapperPlugin } from '../pg-client-wrapper-plugin';

/**
 * Tests for PgMultiTenancyWrapperPlugin.
 *
 * These are unit tests that exercise the plugin's middleware and proxy
 * logic without requiring a running PostGraphile/Grafast instance.
 * The integration path is tested via the e2e benchmark.
 */
describe('PgMultiTenancyWrapperPlugin', () => {
  it('should export a valid Grafast plugin', () => {
    expect(PgMultiTenancyWrapperPlugin).toBeDefined();
    expect(PgMultiTenancyWrapperPlugin.name).toBe('PgMultiTenancyWrapperPlugin');
    expect(PgMultiTenancyWrapperPlugin.grafast?.middleware?.prepareArgs).toBeInstanceOf(Function);
  });

  describe('prepareArgs middleware', () => {
    const prepareArgs = PgMultiTenancyWrapperPlugin.grafast!.middleware!.prepareArgs as Function;

    it('should call next() when no pgServices exist', async () => {
      const next = jest.fn().mockResolvedValue(undefined);
      const args = { resolvedPreset: {}, contextValue: {} };
      await prepareArgs(next, { args });
      expect(next).toHaveBeenCalled();
    });

    it('should call next() when pgServices is empty', async () => {
      const next = jest.fn().mockResolvedValue(undefined);
      const args = { resolvedPreset: { pgServices: [] as any[] }, contextValue: {} };
      await prepareArgs(next, { args });
      expect(next).toHaveBeenCalled();
    });

    it('should wrap withPgClient for each pgService', async () => {
      const originalWithPgClient = jest.fn();
      const contextValue: Record<string, any> = {
        pgp_main_withPgClient: originalWithPgClient,
      };
      const pgServices = [{ withPgClientKey: 'pgp_main_withPgClient' }];
      const args = { resolvedPreset: { pgServices }, contextValue };

      const next = jest.fn().mockResolvedValue(undefined);
      await prepareArgs(next, { args });

      expect(next).toHaveBeenCalled();
      // The original should have been replaced with a wrapper
      expect(contextValue.pgp_main_withPgClient).not.toBe(originalWithPgClient);
      expect(typeof contextValue.pgp_main_withPgClient).toBe('function');
    });

    it('should pass through to original when no transform is set', async () => {
      const mockClient = {
        query: jest.fn().mockResolvedValue({ rows: [] }),
      };
      const originalWithPgClient = jest.fn((_settings: any, cb: any) => cb(mockClient));
      const contextValue: Record<string, any> = {
        pgp_main_withPgClient: originalWithPgClient,
      };
      const pgServices = [{ withPgClientKey: 'pgp_main_withPgClient' }];
      const args = { resolvedPreset: { pgServices }, contextValue };

      const next = jest.fn().mockResolvedValue(undefined);
      await prepareArgs(next, { args });

      // Simulate execution — no pgSqlTextTransform set
      const wrappedWithPgClient = contextValue.pgp_main_withPgClient;
      await wrappedWithPgClient({}, (client: any) => {
        return client.query({ text: 'SELECT 1' });
      });

      // Should call query with UNCHANGED text
      expect(mockClient.query).toHaveBeenCalledWith({ text: 'SELECT 1' });
    });

    it('should apply transform when pgSqlTextTransform is set', async () => {
      const mockClient = {
        query: jest.fn().mockResolvedValue({ rows: [] }),
      };
      const originalWithPgClient = jest.fn((_settings: any, cb: any) => cb(mockClient));
      const contextValue: Record<string, any> = {
        pgp_main_withPgClient: originalWithPgClient,
      };
      const pgServices = [{ withPgClientKey: 'pgp_main_withPgClient' }];
      const args = { resolvedPreset: { pgServices }, contextValue };

      const next = jest.fn().mockResolvedValue(undefined);
      await prepareArgs(next, { args });

      // Simulate finalize() setting the transform (like grafast.context does)
      contextValue.pgSqlTextTransform = (text: string) =>
        text.replace(/"t_1_app"/g, '"t_2_app"');

      // Simulate execution
      const wrappedWithPgClient = contextValue.pgp_main_withPgClient;
      await wrappedWithPgClient({}, (client: any) => {
        return client.query({ text: 'SELECT * FROM "t_1_app"."users"' });
      });

      // Should call query with TRANSFORMED text
      expect(mockClient.query).toHaveBeenCalledWith({
        text: 'SELECT * FROM "t_2_app"."users"',
      });
    });

    it('should proxy withTransaction to transform nested queries', async () => {
      const mockTxClient = {
        query: jest.fn().mockResolvedValue({ rows: [] }),
      };
      const mockClient = {
        query: jest.fn().mockResolvedValue({ rows: [] }),
        withTransaction: jest.fn((cb: any) => cb(mockTxClient)),
      };
      const originalWithPgClient = jest.fn((_settings: any, cb: any) => cb(mockClient));
      const contextValue: Record<string, any> = {
        pgp_main_withPgClient: originalWithPgClient,
      };
      const pgServices = [{ withPgClientKey: 'pgp_main_withPgClient' }];
      const args = { resolvedPreset: { pgServices }, contextValue };

      const next = jest.fn().mockResolvedValue(undefined);
      await prepareArgs(next, { args });

      // Set transform
      contextValue.pgSqlTextTransform = (text: string) =>
        text.replace(/"schema_a"/g, '"schema_b"');

      // Simulate execution with transaction
      const wrappedWithPgClient = contextValue.pgp_main_withPgClient;
      await wrappedWithPgClient({}, (client: any) => {
        return client.withTransaction((txClient: any) => {
          return txClient.query({ text: 'INSERT INTO "schema_a"."items" VALUES (1)' });
        });
      });

      // The transaction client's query should also be transformed
      expect(mockTxClient.query).toHaveBeenCalledWith({
        text: 'INSERT INTO "schema_b"."items" VALUES (1)',
      });
    });

    it('should preserve release method on wrapped withPgClient', async () => {
      const release = jest.fn();
      const originalWithPgClient = Object.assign(
        jest.fn((_settings: any, cb: any) => cb({})),
        { release },
      );
      const contextValue: Record<string, any> = {
        pgp_main_withPgClient: originalWithPgClient,
      };
      const pgServices = [{ withPgClientKey: 'pgp_main_withPgClient' }];
      const args = { resolvedPreset: { pgServices }, contextValue };

      const next = jest.fn().mockResolvedValue(undefined);
      await prepareArgs(next, { args });

      expect(contextValue.pgp_main_withPgClient.release).toBe(release);
    });

    it('should handle multiple pgServices', async () => {
      const original1 = jest.fn();
      const original2 = jest.fn();
      const contextValue: Record<string, any> = {
        pgp_main_withPgClient: original1,
        pgp_auth_withPgClient: original2,
      };
      const pgServices = [
        { withPgClientKey: 'pgp_main_withPgClient' },
        { withPgClientKey: 'pgp_auth_withPgClient' },
      ];
      const args = { resolvedPreset: { pgServices }, contextValue };

      const next = jest.fn().mockResolvedValue(undefined);
      await prepareArgs(next, { args });

      // Both should be wrapped
      expect(contextValue.pgp_main_withPgClient).not.toBe(original1);
      expect(contextValue.pgp_auth_withPgClient).not.toBe(original2);
    });

    it('should skip services without withPgClientKey', async () => {
      const original = jest.fn();
      const contextValue: Record<string, any> = {
        pgp_main_withPgClient: original,
      };
      const pgServices = [
        { /* no withPgClientKey */ },
        { withPgClientKey: 'pgp_main_withPgClient' },
      ];
      const args = { resolvedPreset: { pgServices }, contextValue };

      const next = jest.fn().mockResolvedValue(undefined);
      await prepareArgs(next, { args });

      expect(next).toHaveBeenCalled();
      // Second service should still be wrapped
      expect(contextValue.pgp_main_withPgClient).not.toBe(original);
    });

    it('should preserve other client properties through the proxy', async () => {
      const mockClient = {
        query: jest.fn().mockResolvedValue({ rows: [] }),
        release: jest.fn(),
        someProp: 42,
      };
      const originalWithPgClient = jest.fn((_settings: any, cb: any) => cb(mockClient));
      const contextValue: Record<string, any> = {
        pgp_main_withPgClient: originalWithPgClient,
        pgSqlTextTransform: (text: string) => text, // identity
      };
      const pgServices = [{ withPgClientKey: 'pgp_main_withPgClient' }];
      const args = { resolvedPreset: { pgServices }, contextValue };

      const next = jest.fn().mockResolvedValue(undefined);
      await prepareArgs(next, { args });

      const wrappedWithPgClient = contextValue.pgp_main_withPgClient;
      await wrappedWithPgClient({}, (client: any) => {
        // Other properties should be accessible through the proxy
        expect(client.someProp).toBe(42);
        expect(client.release).toBe(mockClient.release);
      });
    });
  });
});
