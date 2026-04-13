import {
  clearIntrospectionCache,
  getIntrospectionCacheStats,
  getOrCreateIntrospection,
  invalidateIntrospection,
  sweepIntrospectionCache,
  _testSetMaxEntries,
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

    it('should evict oldest entries via TTL (not capacity)', async () => {
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

      // Mark only the first entry as expired past TTL
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

  describe('sweepIntrospectionCache (capacity-based / LRU eviction)', () => {
    afterEach(() => {
      _testSetMaxEntries(undefined); // restore default
    });

    it('should evict LRU entries when cache exceeds max-entries cap', async () => {
      // Populate cache with default cap (100), then lower the cap
      const now = Date.now();
      const entries: any[] = [];
      for (let i = 0; i < 8; i++) {
        mockFetch.mockResolvedValueOnce({
          raw: `{"i":${i}}`,
          parsed: { tables: [], types: [], functions: [] } as any,
        });
        mockFingerprint.mockReturnValueOnce(`fp-cap-${i}`);

        const entry = await getOrCreateIntrospection(mockPool, [`s${i}`], 'db-cap');
        entries.push(entry);
      }

      expect(getIntrospectionCacheStats().size).toBe(8);

      // Now lower the cap to 5 — cache has 8, which is over the new cap
      _testSetMaxEntries(5);

      // Assign deterministic lastAccessedAt — oldest first
      // entries[0] = oldest (least recently accessed)
      // entries[7] = newest (most recently accessed)
      for (let i = 0; i < 8; i++) {
        entries[i].lastAccessedAt = now + i * 1000;
      }

      // Sweep — should evict the 3 oldest (8 - 5 = 3 excess)
      const evicted = await sweepIntrospectionCache();
      expect(evicted).toBe(3);
      expect(getIntrospectionCacheStats().size).toBe(5);

      // Verify LRU order: entries 0, 1, 2 evicted; 3-7 remain
      const remaining = getIntrospectionCacheStats().entries.map((e) => e.key);
      expect(remaining).not.toContain('db-cap:s0');
      expect(remaining).not.toContain('db-cap:s1');
      expect(remaining).not.toContain('db-cap:s2');
      expect(remaining).toContain('db-cap:s3');
      expect(remaining).toContain('db-cap:s4');
      expect(remaining).toContain('db-cap:s5');
      expect(remaining).toContain('db-cap:s6');
      expect(remaining).toContain('db-cap:s7');
    });

    it('should evict by TTL first, then by capacity (LRU) for the remainder', async () => {
      // Populate cache with default cap, then lower it
      const now = Date.now();
      const entries: any[] = [];
      for (let i = 0; i < 6; i++) {
        mockFetch.mockResolvedValueOnce({
          raw: `{"i":${i}}`,
          parsed: { tables: [], types: [], functions: [] } as any,
        });
        mockFingerprint.mockReturnValueOnce(`fp-mix-${i}`);

        const entry = await getOrCreateIntrospection(mockPool, [`m${i}`], 'db-mix');
        entries.push(entry);
      }

      expect(getIntrospectionCacheStats().size).toBe(6);

      // Now lower the cap to 3
      _testSetMaxEntries(3);

      // entries[0]: TTL-expired (31 min ago)
      entries[0].lastAccessedAt = now - (31 * 60 * 1000);
      // entries[1]: oldest non-expired
      entries[1].lastAccessedAt = now + 1000;
      // entries[2]: second oldest non-expired
      entries[2].lastAccessedAt = now + 2000;
      // entries[3]: third oldest non-expired
      entries[3].lastAccessedAt = now + 3000;
      // entries[4]: fourth
      entries[4].lastAccessedAt = now + 4000;
      // entries[5]: newest
      entries[5].lastAccessedAt = now + 5000;

      // Phase 1 removes entries[0] (TTL). Remaining = 5, still > 3.
      // Phase 2 removes 2 oldest by LRU = entries[1], entries[2].
      const evicted = await sweepIntrospectionCache();
      expect(evicted).toBe(3); // 1 TTL + 2 LRU
      expect(getIntrospectionCacheStats().size).toBe(3);

      const remaining = getIntrospectionCacheStats().entries.map((e) => e.key);
      expect(remaining).not.toContain('db-mix:m0'); // TTL evicted
      expect(remaining).not.toContain('db-mix:m1'); // LRU evicted
      expect(remaining).not.toContain('db-mix:m2'); // LRU evicted
      expect(remaining).toContain('db-mix:m3');
      expect(remaining).toContain('db-mix:m4');
      expect(remaining).toContain('db-mix:m5');
    });

    it('should not evict when at exactly the cap (not over)', async () => {
      for (let i = 0; i < 3; i++) {
        mockFetch.mockResolvedValueOnce({
          raw: `{"i":${i}}`,
          parsed: { tables: [], types: [], functions: [] } as any,
        });
        mockFingerprint.mockReturnValueOnce(`fp-exact-${i}`);
        await getOrCreateIntrospection(mockPool, [`e${i}`], 'db-exact');
      }

      // Lower cap to exactly match cache size
      _testSetMaxEntries(3);

      expect(getIntrospectionCacheStats().size).toBe(3);
      const evicted = await sweepIntrospectionCache();
      expect(evicted).toBe(0);
      expect(getIntrospectionCacheStats().size).toBe(3);
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
