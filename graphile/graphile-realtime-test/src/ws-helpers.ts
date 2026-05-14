import type { Client as GqlWsClient } from 'graphql-ws';

/**
 * Collect the next event from a graphql-ws WebSocket subscription.
 *
 * Returns a promise that resolves with the first `next` payload's `data`,
 * or rejects on error / timeout. The subscription is automatically
 * unsubscribed after the first event.
 */
export function nextEvent<T = Record<string, unknown>>(
  client: GqlWsClient,
  query: string,
  variables?: Record<string, unknown>,
  timeoutMs = 10000,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error(`nextEvent timed out after \${timeoutMs}ms`));
    }, timeoutMs);

    const unsubscribe = client.subscribe(
      { query, variables },
      {
        next(value) {
          clearTimeout(timer);
          unsubscribe();
          resolve(value.data as T);
        },
        error(err) {
          clearTimeout(timer);
          unsubscribe();
          reject(Array.isArray(err) ? err[0] : err);
        },
        complete() {
          clearTimeout(timer);
          reject(new Error('Subscription completed without yielding a value'));
        },
      },
    );
  });
}

/**
 * Subscribe and collect events into an array until `unsubscribe()` is called.
 *
 * Useful for assertions that need to inspect multiple events after the fact.
 */
export function collectWsEvents<T = Record<string, unknown>>(
  client: GqlWsClient,
  query: string,
  variables?: Record<string, unknown>,
): { events: T[]; unsubscribe: () => void } {
  const events: T[] = [];
  const unsubscribe = client.subscribe(
    { query, variables },
    {
      next(value) {
        events.push(value.data as T);
      },
      error() { /* swallow */ },
      complete() { /* done */ },
    },
  );
  return { events, unsubscribe };
}

export const delay = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));
