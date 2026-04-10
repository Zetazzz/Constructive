/**
 * Tests for single-flight error handling in getOrCreateTenantInstance.
 *
 * Validates that:
 * 1. The creatingTemplates map is cleaned up on failure (no stale promises)
 * 2. Coalesced callers receive the error (not hung forever)
 * 3. A retry after failure triggers a fresh creation attempt
 * 4. Partial resources (pgl, httpServer) are cleaned up on failure
 */

import type { Pool } from 'pg';

// We need to mock modules BEFORE importing the module under test.
// The orchestrator imports postgraphile, grafserv, express, etc.

const mockRelease = jest.fn().mockResolvedValue(undefined);
const mockReady = jest.fn().mockResolvedValue(undefined);
const mockAddTo = jest.fn().mockResolvedValue(undefined);
const mockCreateServ = jest.fn().mockReturnValue({
  addTo: mockAddTo,
  ready: mockReady,
});
const mockPostgraphile = jest.fn().mockReturnValue({
  createServ: mockCreateServ,
  release: mockRelease,
});

jest.mock('postgraphile', () => ({
  postgraphile: mockPostgraphile,
}));

jest.mock('grafserv/express/v4', () => ({
  grafserv: {},
}));

const mockHttpClose = jest.fn((cb?: () => void) => { if (cb) cb(); });
const mockCreateServer = jest.fn().mockReturnValue({
  close: mockHttpClose,
  listening: false,
});
jest.mock('node:http', () => ({
  createServer: mockCreateServer,
}));

jest.mock('express', () => {
  const fn = jest.fn().mockReturnValue({});
  return fn;
});

// Mock introspection cache to control fingerprints
const mockGetOrCreateIntrospection = jest.fn();
jest.mock('../introspection-cache', () => ({
  getOrCreateIntrospection: mockGetOrCreateIntrospection,
  clearIntrospectionCache: jest.fn(),
  getIntrospectionCacheStats: jest.fn().mockReturnValue({
    size: 0,
    hits: 0,
    misses: 0,
    entries: [],
  }),
}));

import {
  getOrCreateTenantInstance,
  shutdownMultiTenancyCache,
} from '../multi-tenancy-cache';
import type { TenantConfig } from '../multi-tenancy-cache';

// Helper to build a mock TenantConfig
function makeTenantConfig(overrides: Partial<TenantConfig> = {}): TenantConfig {
  return {
    cacheKey: 'test-tenant',
    pool: {} as Pool,
    schemas: ['app_public'],
    dbname: 'testdb',
    anonRole: 'anonymous',
    roleName: 'authenticated',
    ...overrides,
  };
}

// Dummy preset builder
const presetBuilder = jest.fn().mockReturnValue({});

describe('Single-flight error handling in getOrCreateTenantInstance', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default: introspection succeeds with a consistent fingerprint
    mockGetOrCreateIntrospection.mockResolvedValue({
      raw: '{}',
      parsed: {},
      fingerprint: 'fp-test-abc123',
    });
    // Default: template creation succeeds
    mockReady.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await shutdownMultiTenancyCache();
  });

  it('should clean up creatingTemplates on creation failure and allow retry', async () => {
    // First call: make serv.ready() fail (simulates PostGraphile startup error)
    mockReady.mockRejectedValueOnce(new Error('DB timeout during startup'));

    // Attempt 1: should fail
    await expect(
      getOrCreateTenantInstance(makeTenantConfig(), presetBuilder)
    ).rejects.toThrow('DB timeout during startup');

    // Attempt 2: should succeed (creatingTemplates was cleaned up, so we get a fresh attempt)
    mockReady.mockResolvedValueOnce(undefined);
    const result = await getOrCreateTenantInstance(
      makeTenantConfig({ cacheKey: 'test-tenant-2' }),
      presetBuilder
    );

    expect(result).toBeDefined();
    expect(result.fingerprint).toBe('fp-test-abc123');
    // postgraphile was called twice (once for failed, once for retry)
    expect(mockPostgraphile).toHaveBeenCalledTimes(2);
  });

  it('should propagate error to coalesced callers', async () => {
    // Make creation slow enough for a second request to coalesce
    let rejectReady: (err: Error) => void;
    mockReady.mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectReady = reject;
      })
    );

    const config1 = makeTenantConfig({ cacheKey: 'tenant-1' });
    const config2 = makeTenantConfig({ cacheKey: 'tenant-2' });

    // Start two concurrent requests — same fingerprint, so second will coalesce
    const p1 = getOrCreateTenantInstance(config1, presetBuilder);
    const p2 = getOrCreateTenantInstance(config2, presetBuilder);

    // Reject the creation — both callers should get the error
    rejectReady!(new Error('Connection refused'));

    await expect(p1).rejects.toThrow('Connection refused');
    await expect(p2).rejects.toThrow('Connection refused');

    // Only one postgraphile instance was created (coalesced)
    expect(mockPostgraphile).toHaveBeenCalledTimes(1);
  });

  it('should clean up partial resources (pgl, httpServer) on failure', async () => {
    mockReady.mockRejectedValueOnce(new Error('Startup crash'));

    await expect(
      getOrCreateTenantInstance(makeTenantConfig(), presetBuilder)
    ).rejects.toThrow('Startup crash');

    // pgl.release() should have been called for cleanup
    expect(mockRelease).toHaveBeenCalledTimes(1);
    // httpServer.close() should have been called for cleanup
    expect(mockHttpClose).toHaveBeenCalledTimes(1);
  });

  it('should not leave stale promise after failure (map is empty)', async () => {
    mockReady.mockRejectedValueOnce(new Error('Transient error'));

    await expect(
      getOrCreateTenantInstance(makeTenantConfig(), presetBuilder)
    ).rejects.toThrow('Transient error');

    // After failure, a new request with the same fingerprint should
    // trigger a NEW creation (not wait on a stale promise)
    mockReady.mockResolvedValueOnce(undefined);
    const result = await getOrCreateTenantInstance(
      makeTenantConfig({ cacheKey: 'retry-tenant' }),
      presetBuilder
    );

    expect(result).toBeDefined();
    // Two postgraphile calls: first failed, second succeeded
    expect(mockPostgraphile).toHaveBeenCalledTimes(2);
  });

  it('should fall back to dedicated instance when introspection fails', async () => {
    mockGetOrCreateIntrospection.mockRejectedValueOnce(
      new Error('Introspection SQL timeout')
    );

    const result = await getOrCreateTenantInstance(
      makeTenantConfig(),
      presetBuilder
    );

    // Should still return a result (dedicated instance fallback)
    expect(result).toBeDefined();
    expect(result.isShared).toBe(false);
    expect(result.fingerprint).toMatch(/^dedicated-/);
  });
});
