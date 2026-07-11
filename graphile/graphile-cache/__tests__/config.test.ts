import {
  configureGraphileCache,
  getCacheConfig,
  getCacheStats,
  graphileCache,
} from '../src/graphile-cache';

describe('Graphile cache Constructive options', () => {
  const original = getCacheConfig();

  afterEach(() => {
    configureGraphileCache({
      graphileRuntime: {
        cacheMax: original.max,
        cacheTtlMs: original.ttl,
      },
    });
  });

  it('applies resolved runtime overrides to the live cache instance', () => {
    configureGraphileCache({
      graphileRuntime: { cacheMax: 7, cacheTtlMs: 1234 },
    });

    expect(graphileCache.max).toBe(7);
    expect(graphileCache.ttl).toBe(1234);
    expect(getCacheStats()).toMatchObject({ max: 7, ttl: 1234 });
  });
});
