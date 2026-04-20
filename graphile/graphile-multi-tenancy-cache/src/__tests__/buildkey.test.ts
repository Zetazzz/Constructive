/**
 * Unit tests for buildKey-based handler caching (v4-buildkey).
 *
 * Tests cover:
 *  - buildKey computation determinism and sensitivity
 *  - identical build inputs with different svc_keys share the same handler
 *  - different schemas / roles produce different buildKeys
 *  - svc_key-based flush evicts the correct handler
 *  - databaseId-level flush works correctly
 *  - shutdown clears all state
 */

import { createHash } from 'node:crypto';

// We test computeBuildKey directly and use mocks for the orchestrator functions
// that depend on PostGraphile.

// --- computeBuildKey tests (pure function, no mocking needed) ---

import { computeBuildKey } from '../multi-tenancy-cache';

function makeMockPool(overrides: Record<string, unknown> = {}): import('pg').Pool {
  const defaults = {
    host: 'localhost',
    port: 5432,
    database: 'testdb',
    user: 'postgres',
  };
  return { options: { ...defaults, ...overrides } } as unknown as import('pg').Pool;
}

describe('computeBuildKey', () => {
  it('should be deterministic for identical inputs', () => {
    const pool = makeMockPool();
    const k1 = computeBuildKey(pool, ['public'], 'anon', 'authenticated');
    const k2 = computeBuildKey(pool, ['public'], 'anon', 'authenticated');
    expect(k1).toBe(k2);
  });

  it('should produce a 16-char hex string', () => {
    const pool = makeMockPool();
    const key = computeBuildKey(pool, ['public'], 'anon', 'authenticated');
    expect(key).toMatch(/^[0-9a-f]{16}$/);
  });

  it('should differ when schemas differ', () => {
    const pool = makeMockPool();
    const k1 = computeBuildKey(pool, ['public'], 'anon', 'authenticated');
    const k2 = computeBuildKey(pool, ['private'], 'anon', 'authenticated');
    expect(k1).not.toBe(k2);
  });

  it('should differ when schema order differs', () => {
    const pool = makeMockPool();
    const k1 = computeBuildKey(pool, ['public', 'private'], 'anon', 'authenticated');
    const k2 = computeBuildKey(pool, ['private', 'public'], 'anon', 'authenticated');
    expect(k1).not.toBe(k2);
  });

  it('should differ when anonRole differs', () => {
    const pool = makeMockPool();
    const k1 = computeBuildKey(pool, ['public'], 'anon', 'authenticated');
    const k2 = computeBuildKey(pool, ['public'], 'guest', 'authenticated');
    expect(k1).not.toBe(k2);
  });

  it('should differ when roleName differs', () => {
    const pool = makeMockPool();
    const k1 = computeBuildKey(pool, ['public'], 'anon', 'authenticated');
    const k2 = computeBuildKey(pool, ['public'], 'anon', 'admin');
    expect(k1).not.toBe(k2);
  });

  it('should differ when database differs', () => {
    const p1 = makeMockPool({ database: 'db_a' });
    const p2 = makeMockPool({ database: 'db_b' });
    const k1 = computeBuildKey(p1, ['public'], 'anon', 'authenticated');
    const k2 = computeBuildKey(p2, ['public'], 'anon', 'authenticated');
    expect(k1).not.toBe(k2);
  });

  it('should differ when host differs', () => {
    const p1 = makeMockPool({ host: 'host-a' });
    const p2 = makeMockPool({ host: 'host-b' });
    const k1 = computeBuildKey(p1, ['public'], 'anon', 'authenticated');
    const k2 = computeBuildKey(p2, ['public'], 'anon', 'authenticated');
    expect(k1).not.toBe(k2);
  });

  it('should differ when port differs', () => {
    const p1 = makeMockPool({ port: 5432 });
    const p2 = makeMockPool({ port: 5433 });
    const k1 = computeBuildKey(p1, ['public'], 'anon', 'authenticated');
    const k2 = computeBuildKey(p2, ['public'], 'anon', 'authenticated');
    expect(k1).not.toBe(k2);
  });

  it('should differ when user differs', () => {
    const p1 = makeMockPool({ user: 'alice' });
    const p2 = makeMockPool({ user: 'bob' });
    const k1 = computeBuildKey(p1, ['public'], 'anon', 'authenticated');
    const k2 = computeBuildKey(p2, ['public'], 'anon', 'authenticated');
    expect(k1).not.toBe(k2);
  });

  it('should NOT differ when only svc_key would differ (svc_key is not an input)', () => {
    // Same pool, schemas, roles → same buildKey, regardless of svc_key
    const pool = makeMockPool();
    const k1 = computeBuildKey(pool, ['services_public'], 'administrator', 'administrator');
    const k2 = computeBuildKey(pool, ['services_public'], 'administrator', 'administrator');
    expect(k1).toBe(k2);
  });
});

// --- Orchestrator tests (require mocking PostGraphile) ---

// Mock the heavy dependencies before importing the orchestrator
jest.mock('postgraphile', () => ({
  postgraphile: jest.fn(() => ({
    createServ: jest.fn(() => ({
      addTo: jest.fn(async () => {}),
      ready: jest.fn(async () => {}),
    })),
    release: jest.fn(async () => {}),
  })),
}));

jest.mock('grafserv/express/v4', () => ({
  grafserv: 'mock-grafserv',
}));

jest.mock('express', () => {
  const mockExpress = jest.fn(() => {
    const app = jest.fn();
    return app;
  });
  return mockExpress;
});

jest.mock('node:http', () => ({
  createServer: jest.fn(() => ({
    listening: false,
    close: jest.fn((cb: () => void) => cb()),
  })),
}));

jest.mock('@pgpmjs/logger', () => ({
  Logger: jest.fn().mockImplementation(() => ({
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  })),
}));

import {
  configureMultiTenancyCache,
  getOrCreateTenantInstance,
  getTenantInstance,
  flushTenantInstance,
  flushByDatabaseId,
  getMultiTenancyCacheStats,
  shutdownMultiTenancyCache,
  getBuildKeyForSvcKey,
} from '../multi-tenancy-cache';

const mockPresetBuilder = jest.fn((_pool: import('pg').Pool, _schemas: string[], _anon: string, _role: string): import('graphile-config').GraphileConfig.Preset => ({
  extends: [] as import('graphile-config').GraphileConfig.Preset[],
  pgServices: [] as never[],
}));

beforeEach(async () => {
  await shutdownMultiTenancyCache();
  configureMultiTenancyCache({ basePresetBuilder: mockPresetBuilder });
  mockPresetBuilder.mockClear();
});

afterAll(async () => {
  await shutdownMultiTenancyCache();
});

describe('getOrCreateTenantInstance — buildKey deduplication', () => {
  it('should return same handler for different svc_keys with identical build inputs', async () => {
    const pool = makeMockPool();

    const t1 = await getOrCreateTenantInstance({
      svcKey: 'schemata:db-0001-tenant-a:services_public',
      pool,
      schemas: ['services_public'],
      anonRole: 'administrator',
      roleName: 'administrator',
    });

    const t2 = await getOrCreateTenantInstance({
      svcKey: 'schemata:db-0002-tenant-b:services_public',
      pool,
      schemas: ['services_public'],
      anonRole: 'administrator',
      roleName: 'administrator',
    });

    // Same handler object (same buildKey)
    expect(t1).toBe(t2);
    expect(t1.buildKey).toBe(t2.buildKey);

    // Preset builder called only once (deduplication)
    expect(mockPresetBuilder).toHaveBeenCalledTimes(1);

    // Both svc_keys resolve to the same buildKey
    expect(getBuildKeyForSvcKey('schemata:db-0001-tenant-a:services_public')).toBe(t1.buildKey);
    expect(getBuildKeyForSvcKey('schemata:db-0002-tenant-b:services_public')).toBe(t1.buildKey);
  });

  it('should return different handlers when schemas differ', async () => {
    const pool = makeMockPool();

    const t1 = await getOrCreateTenantInstance({
      svcKey: 'tenant-a',
      pool,
      schemas: ['schema_a'],
      anonRole: 'anon',
      roleName: 'auth',
    });

    const t2 = await getOrCreateTenantInstance({
      svcKey: 'tenant-b',
      pool,
      schemas: ['schema_b'],
      anonRole: 'anon',
      roleName: 'auth',
    });

    expect(t1).not.toBe(t2);
    expect(t1.buildKey).not.toBe(t2.buildKey);
    expect(mockPresetBuilder).toHaveBeenCalledTimes(2);
  });

  it('should return different handlers when roles differ', async () => {
    const pool = makeMockPool();

    const t1 = await getOrCreateTenantInstance({
      svcKey: 'tenant-a',
      pool,
      schemas: ['public'],
      anonRole: 'anon',
      roleName: 'user',
    });

    const t2 = await getOrCreateTenantInstance({
      svcKey: 'tenant-b',
      pool,
      schemas: ['public'],
      anonRole: 'anon',
      roleName: 'admin',
    });

    expect(t1).not.toBe(t2);
    expect(t1.buildKey).not.toBe(t2.buildKey);
  });
});

describe('getTenantInstance — fast path', () => {
  it('should return handler after registration via getOrCreateTenantInstance', async () => {
    const pool = makeMockPool();
    await getOrCreateTenantInstance({
      svcKey: 'key-1',
      pool,
      schemas: ['public'],
      anonRole: 'anon',
      roleName: 'auth',
    });

    const result = getTenantInstance('key-1');
    expect(result).toBeDefined();
    expect(result!.buildKey).toBeTruthy();
  });

  it('should return undefined for unregistered svc_key', () => {
    expect(getTenantInstance('nonexistent')).toBeUndefined();
  });
});

describe('flushTenantInstance — svc_key-based flush', () => {
  it('should evict the handler and clear all svc_key mappings for the buildKey', async () => {
    const pool = makeMockPool();

    // Two svc_keys share the same handler
    await getOrCreateTenantInstance({
      svcKey: 'key-a',
      pool,
      schemas: ['public'],
      anonRole: 'anon',
      roleName: 'auth',
    });
    await getOrCreateTenantInstance({
      svcKey: 'key-b',
      pool,
      schemas: ['public'],
      anonRole: 'anon',
      roleName: 'auth',
    });

    expect(getTenantInstance('key-a')).toBeDefined();
    expect(getTenantInstance('key-b')).toBeDefined();

    // Flush via key-a
    flushTenantInstance('key-a');

    // Both svc_keys should lose their handler (same buildKey was evicted)
    expect(getTenantInstance('key-a')).toBeUndefined();
    expect(getTenantInstance('key-b')).toBeUndefined();

    const stats = getMultiTenancyCacheStats();
    expect(stats.handlerCacheSize).toBe(0);
    expect(stats.svcKeyMappings).toBe(0);
  });

  it('should not affect handlers with different buildKeys', async () => {
    const pool = makeMockPool();

    await getOrCreateTenantInstance({
      svcKey: 'key-a',
      pool,
      schemas: ['schema_a'],
      anonRole: 'anon',
      roleName: 'auth',
    });
    await getOrCreateTenantInstance({
      svcKey: 'key-b',
      pool,
      schemas: ['schema_b'],
      anonRole: 'anon',
      roleName: 'auth',
    });

    flushTenantInstance('key-a');

    expect(getTenantInstance('key-a')).toBeUndefined();
    expect(getTenantInstance('key-b')).toBeDefined();

    const stats = getMultiTenancyCacheStats();
    expect(stats.handlerCacheSize).toBe(1);
  });

  it('should be a no-op for unknown svc_key', () => {
    expect(() => flushTenantInstance('nonexistent')).not.toThrow();
  });
});

describe('flushByDatabaseId — database-level flush', () => {
  it('should evict all handlers associated with a databaseId', async () => {
    const pool = makeMockPool();

    await getOrCreateTenantInstance({
      svcKey: 'key-a',
      pool,
      schemas: ['schema_a'],
      anonRole: 'anon',
      roleName: 'auth',
      databaseId: 'db-001',
    });
    await getOrCreateTenantInstance({
      svcKey: 'key-b',
      pool,
      schemas: ['schema_b'],
      anonRole: 'anon',
      roleName: 'auth',
      databaseId: 'db-001',
    });

    expect(getMultiTenancyCacheStats().handlerCacheSize).toBe(2);

    flushByDatabaseId('db-001');

    expect(getTenantInstance('key-a')).toBeUndefined();
    expect(getTenantInstance('key-b')).toBeUndefined();
    expect(getMultiTenancyCacheStats().handlerCacheSize).toBe(0);
    expect(getMultiTenancyCacheStats().databaseIdMappings).toBe(0);
  });

  it('should not affect handlers from other databaseIds', async () => {
    const pool = makeMockPool();

    await getOrCreateTenantInstance({
      svcKey: 'key-a',
      pool,
      schemas: ['schema_a'],
      anonRole: 'anon',
      roleName: 'auth',
      databaseId: 'db-001',
    });
    await getOrCreateTenantInstance({
      svcKey: 'key-b',
      pool,
      schemas: ['schema_b'],
      anonRole: 'anon',
      roleName: 'auth',
      databaseId: 'db-002',
    });

    flushByDatabaseId('db-001');

    expect(getTenantInstance('key-a')).toBeUndefined();
    expect(getTenantInstance('key-b')).toBeDefined();
    expect(getMultiTenancyCacheStats().handlerCacheSize).toBe(1);
  });

  it('should be a no-op for unknown databaseId', () => {
    expect(() => flushByDatabaseId('nonexistent')).not.toThrow();
  });
});

describe('shutdownMultiTenancyCache', () => {
  it('should clear all state', async () => {
    const pool = makeMockPool();

    await getOrCreateTenantInstance({
      svcKey: 'key-a',
      pool,
      schemas: ['public'],
      anonRole: 'anon',
      roleName: 'auth',
      databaseId: 'db-001',
    });
    await getOrCreateTenantInstance({
      svcKey: 'key-b',
      pool,
      schemas: ['private'],
      anonRole: 'anon',
      roleName: 'auth',
      databaseId: 'db-002',
    });

    expect(getMultiTenancyCacheStats().handlerCacheSize).toBe(2);
    expect(getMultiTenancyCacheStats().svcKeyMappings).toBe(2);

    await shutdownMultiTenancyCache();

    const stats = getMultiTenancyCacheStats();
    expect(stats.handlerCacheSize).toBe(0);
    expect(stats.svcKeyMappings).toBe(0);
    expect(stats.databaseIdMappings).toBe(0);
    expect(stats.inflightCreations).toBe(0);
  });
});

describe('getMultiTenancyCacheStats', () => {
  it('should report correct counts', async () => {
    const pool = makeMockPool();

    // Create 3 svc_keys, 2 of which share the same buildKey
    await getOrCreateTenantInstance({
      svcKey: 'key-a',
      pool,
      schemas: ['public'],
      anonRole: 'anon',
      roleName: 'auth',
      databaseId: 'db-001',
    });
    await getOrCreateTenantInstance({
      svcKey: 'key-b',
      pool,
      schemas: ['public'],
      anonRole: 'anon',
      roleName: 'auth',
      databaseId: 'db-001',
    });
    await getOrCreateTenantInstance({
      svcKey: 'key-c',
      pool,
      schemas: ['private'],
      anonRole: 'anon',
      roleName: 'auth',
      databaseId: 'db-002',
    });

    const stats = getMultiTenancyCacheStats();
    expect(stats.handlerCacheSize).toBe(2);     // 2 unique buildKeys
    expect(stats.svcKeyMappings).toBe(3);        // 3 svc_keys
    expect(stats.databaseIdMappings).toBe(2);    // 2 databaseIds
    expect(stats.inflightCreations).toBe(0);
  });
});

describe('re-creation after flush', () => {
  it('should create a new handler after flushing and re-requesting', async () => {
    const pool = makeMockPool();

    const t1 = await getOrCreateTenantInstance({
      svcKey: 'key-a',
      pool,
      schemas: ['public'],
      anonRole: 'anon',
      roleName: 'auth',
    });

    flushTenantInstance('key-a');
    expect(getTenantInstance('key-a')).toBeUndefined();

    const t2 = await getOrCreateTenantInstance({
      svcKey: 'key-a',
      pool,
      schemas: ['public'],
      anonRole: 'anon',
      roleName: 'auth',
    });

    // New handler instance (though same buildKey)
    expect(t2).not.toBe(t1);
    expect(t2.buildKey).toBe(t1.buildKey);
    expect(getTenantInstance('key-a')).toBeDefined();
  });
});
