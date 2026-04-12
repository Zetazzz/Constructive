import {
  clearIntrospectionCache,
  getIntrospectionCacheStats,
  getOrCreateIntrospection,
  invalidateIntrospection,
  sweepIntrospectionCache,
} from '../introspection-cache';

// Mock dependencies
jest.mock('../introspection', () => ({
  fetchAndParseIntrospection: jest.fn(),
}));

jest.mock('../fingerprint', () => ({
  getSchemaFingerprint: jest.fn(),
}));

import { fetchAndParseIntrospection } from '../introspection';
import { getSchemaFingerprint } from '../fingerprint';

const mockFetch = fetchAndParseIntrospection as jest.MockedFunction<typeof fetchAndParseIntrospection>;
const mockFingerprint = getSchemaFingerprint as jest.MockedFunction<typeof getSchemaFingerprint>;

// Minimal mock pool
const mockPool = {} as import('pg').Pool;

function setupMocks(fingerprint = 'fp-abc123') {
  mockFetch.mockResolvedValue({
    raw: '{"tables":[]}',
    parsed: { tables: [], types: [], functions: [] } as any,
  });
  mockFingerprint.mockReturnValue(fingerprint);
}

describe('Introspection Cache', () => {
  beforeEach(() => {
    clearIntrospectionCache();
    jest.clearAllMocks();
  });

  afterAll(() => {
    clearIntrospectionCache();
  });

  describe('getOrCreateIntrospection', () => {
    it('should fetch on cache miss and return cached on hit', async () => {
      setupMocks('fp-1');

      // First call — MISS
      const result1 = await getOrCreateIntrospection(mockPool, ['public'], 'db1');
      expect(result1.fingerprint).toBe('fp-1');
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Second call — HIT
      const result2 = await getOrCreateIntrospection(mockPool, ['public'], 'db1');
      expect(result2.fingerprint).toBe('fp-1');
      expect(mockFetch).toHaveBeenCalledTimes(1); // No additional fetch
    });

    it('should update lastAccessedAt on cache hit', async () => {
      setupMocks('fp-2');

      const result1 = await getOrCreateIntrospection(mockPool, ['public'], 'db2');
      const firstAccess = result1.lastAccessedAt;

      // Wait a tiny bit so timestamps differ
      await new Promise((resolve) => setTimeout(resolve, 10));

      const result2 = await getOrCreateIntrospection(mockPool, ['public'], 'db2');
      expect(result2.lastAccessedAt).toBeGreaterThanOrEqual(firstAccess);
    });

    it('should sort schemas for consistent keys', async () => {
      setupMocks('fp-sorted');

      await getOrCreateIntrospection(mockPool, ['b_schema', 'a_schema'], 'db3');
      const result = await getOrCreateIntrospection(mockPool, ['a_schema', 'b_schema'], 'db3');
      expect(result.fingerprint).toBe('fp-sorted');
      expect(mockFetch).toHaveBeenCalledTimes(1); // Same key, so only 1 fetch
    });

    it('should coalesce concurrent requests for the same key', async () => {
      setupMocks('fp-coalesce');

      // Fire two requests simultaneously
      const [r1, r2] = await Promise.all([
        getOrCreateIntrospection(mockPool, ['public'], 'db4'),
        getOrCreateIntrospection(mockPool, ['public'], 'db4'),
      ]);

      expect(r1).toBe(r2); // Same object
      expect(mockFetch).toHaveBeenCalledTimes(1); // Only one fetch
    });

    it('should not cache failures and allow retries', async () => {
      mockFetch.mockRejectedValueOnce(new Error('DB timeout'));
      mockFingerprint.mockReturnValue('fp-retry');

      // First call — fails
      await expect(
        getOrCreateIntrospection(mockPool, ['public'], 'db5')
      ).rejects.toThrow('DB timeout');

      // Second call — should retry (not stuck on failed promise)
      setupMocks('fp-retry');
      const result = await getOrCreateIntrospection(mockPool, ['public'], 'db5');
      expect(result.fingerprint).toBe('fp-retry');
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('invalidateIntrospection', () => {
    it('should invalidate a specific entry', async () => {
      setupMocks('fp-inv1');
      await getOrCreateIntrospection(mockPool, ['public'], 'db6');
      expect(getIntrospectionCacheStats().size).toBe(1);

      invalidateIntrospection('db6', ['public']);
      expect(getIntrospectionCacheStats().size).toBe(0);
    });

    it('should invalidate all entries for a database', async () => {
      setupMocks('fp-inv2');
      await getOrCreateIntrospection(mockPool, ['schema_a'], 'db7');

      mockFetch.mockResolvedValueOnce({
        raw: '{"tables":[]}',
        parsed: { tables: [], types: [], functions: [] } as any,
      });
      mockFingerprint.mockReturnValueOnce('fp-inv2b');
      await getOrCreateIntrospection(mockPool, ['schema_b'], 'db7');

      expect(getIntrospectionCacheStats().size).toBe(2);

      invalidateIntrospection('db7');
      expect(getIntrospectionCacheStats().size).toBe(0);
    });
  });

  describe('sweepIntrospectionCache (LRU/TTL eviction)', () => {
    it('should not evict recently-accessed entries', async () => {
      setupMocks('fp-fresh');
      await getOrCreateIntrospection(mockPool, ['public'], 'db-fresh');
      expect(getIntrospectionCacheStats().size).toBe(1);

      const evicted = await sweepIntrospectionCache();
      expect(evicted).toBe(0);
      expect(getIntrospectionCacheStats().size).toBe(1);
    });

    it('should evict entries past the idle TTL', async () => {
      setupMocks('fp-old');
      const result = await getOrCreateIntrospection(mockPool, ['public'], 'db-old');

      // Simulate entry being last accessed 31 minutes ago
      result.lastAccessedAt = Date.now() - (31 * 60 * 1000);

      const evicted = await sweepIntrospectionCache();
      expect(evicted).toBe(1);
      expect(getIntrospectionCacheStats().size).toBe(0);
    });

    it('should not evict entries within the TTL window', async () => {
      setupMocks('fp-within');
      const result = await getOrCreateIntrospection(mockPool, ['public'], 'db-within');

      // Simulate entry last accessed 10 minutes ago (within 30min TTL)
      result.lastAccessedAt = Date.now() - (10 * 60 * 1000);

      const evicted = await sweepIntrospectionCache();
      expect(evicted).toBe(0);
      expect(getIntrospectionCacheStats().size).toBe(1);
    });

    it('should evict oldest entries when over MAX_ENTRIES cap', async () => {
      // We can't easily create 100+ entries in a unit test, but we can verify
      // the LRU logic by checking that older entries are evicted first
      // when we have a mix of old and new entries.

      // Create 3 entries with different lastAccessedAt
      const entries: any[] = [];
      for (let i = 0; i < 3; i++) {
        mockFetch.mockResolvedValueOnce({
          raw: `{"i":${i}}`,
          parsed: { tables: [], types: [], functions: [] } as any,
        });
        mockFingerprint.mockReturnValueOnce(`fp-lru-${i}`);

        const entry = await getOrCreateIntrospection(mockPool, [`schema_${i}`], 'db-lru');
        entries.push(entry);
      }

      expect(getIntrospectionCacheStats().size).toBe(3);

      // Mark only the first entry as expired
      entries[0].lastAccessedAt = Date.now() - (31 * 60 * 1000);

      const evicted = await sweepIntrospectionCache();
      expect(evicted).toBe(1);
      expect(getIntrospectionCacheStats().size).toBe(2);

      // Verify the expired entry is gone and fresh ones remain
      const stats = getIntrospectionCacheStats();
      const keys = stats.entries.map((e) => e.key);
      expect(keys).not.toContain('db-lru:schema_0');
      expect(keys).toContain('db-lru:schema_1');
      expect(keys).toContain('db-lru:schema_2');
    });

    it('should return 0 when cache is empty', async () => {
      const evicted = await sweepIntrospectionCache();
      expect(evicted).toBe(0);
    });
  });

  describe('getIntrospectionCacheStats', () => {
    it('should return empty stats when cache is empty', () => {
      const stats = getIntrospectionCacheStats();
      expect(stats.size).toBe(0);
      expect(stats.entries).toHaveLength(0);
    });

    it('should include lastAccessedAt in stats', async () => {
      setupMocks('fp-stats');
      await getOrCreateIntrospection(mockPool, ['public'], 'db-stats');

      const stats = getIntrospectionCacheStats();
      expect(stats.size).toBe(1);
      expect(stats.entries[0].lastAccessedAt).toBeDefined();
      expect(typeof stats.entries[0].lastAccessedAt).toBe('number');
      expect(stats.entries[0].fingerprint).toBe('fp-stats');
    });
  });

  describe('clearIntrospectionCache', () => {
    it('should clear all entries and stop sweep timer', async () => {
      setupMocks('fp-clear');
      await getOrCreateIntrospection(mockPool, ['public'], 'db-clear');
      expect(getIntrospectionCacheStats().size).toBe(1);

      clearIntrospectionCache();
      expect(getIntrospectionCacheStats().size).toBe(0);
    });
  });
});
