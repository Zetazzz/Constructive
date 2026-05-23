import { TtlCache } from '../src/cache';

describe('TtlCache', () => {
  it('stores and retrieves values', () => {
    const cache = new TtlCache<string>(60_000);
    cache.set('key1', 'value1');
    expect(cache.get('key1')).toBe('value1');
  });

  it('returns undefined for missing keys', () => {
    const cache = new TtlCache<string>(60_000);
    expect(cache.get('missing')).toBeUndefined();
  });

  it('expires entries after TTL', () => {
    const cache = new TtlCache<string>(1); // 1ms TTL
    cache.set('key1', 'value1');

    // Wait for TTL to expire
    const start = Date.now();
    while (Date.now() - start < 5) {
      // spin
    }

    expect(cache.get('key1')).toBeUndefined();
  });

  it('deletes entries', () => {
    const cache = new TtlCache<string>(60_000);
    cache.set('key1', 'value1');
    cache.delete('key1');
    expect(cache.get('key1')).toBeUndefined();
  });

  it('clears all entries', () => {
    const cache = new TtlCache<string>(60_000);
    cache.set('a', '1');
    cache.set('b', '2');
    expect(cache.size).toBe(2);
    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.get('a')).toBeUndefined();
  });

  it('tracks size correctly', () => {
    const cache = new TtlCache<number>(60_000);
    expect(cache.size).toBe(0);
    cache.set('x', 1);
    cache.set('y', 2);
    expect(cache.size).toBe(2);
  });
});
