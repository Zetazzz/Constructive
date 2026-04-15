/**
 * PgMultiTenancyWrapperPlugin
 *
 * A Grafast middleware plugin that intercepts SQL queries at the
 * `client.query()` level, applying a per-request `sqlTextTransform`
 * to replace template schema names with real tenant schema names.
 *
 * ## How it works
 *
 * 1. During `prepareArgs`, wraps each pgService's `withPgClient` function
 *    with a lazy proxy.
 * 2. At execution time (when PgExecutor calls `withPgClient`), the proxy
 *    reads `pgSqlTextTransform` from the Grafast context (set by
 *    `grafast.context` in the preset).
 * 3. If a transform is present, `client.query()` is proxied to transform
 *    the SQL text before it reaches PostgreSQL.
 * 4. `client.withTransaction()` is also proxied so transaction-scoped
 *    queries (cursors, mutations) are transformed too.
 *
 * ## Why this avoids Crystal changes
 *
 * Crystal's `PgExecutor._executeWithClient()` sends SQL to PostgreSQL via
 * `client.query({ text: sql, ... })`.  By wrapping the `withPgClient`
 * function that PgExecutor reads from the Grafast context, we intercept
 * the `client` object before PgExecutor sees it — and our proxy transforms
 * `text` in every `query()` call.
 *
 * This achieves the same effect as Crystal PR #5's `prepareSql()` gateway,
 * but entirely from the outside — no Crystal source modifications needed.
 *
 * @module pg-client-wrapper-plugin
 */

/**
 * Create a proxy around a PgClient that transforms SQL text in all
 * `query()` calls.  Also wraps `withTransaction()` so that transaction
 * clients are proxied identically.
 */
function createSqlTransformProxy<T extends object>(
  client: T,
  transform: (text: string) => string,
): T {
  return new Proxy(client, {
    get(target: any, prop: string | symbol, receiver: any) {
      if (prop === 'query') {
        return (opts: { text: string; [k: string]: any }) => {
          return target.query({ ...opts, text: transform(opts.text) });
        };
      }
      if (prop === 'withTransaction') {
        return (callback: (txClient: any) => any) => {
          return target.withTransaction((txClient: any) => {
            return callback(createSqlTransformProxy(txClient, transform));
          });
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}

/**
 * Wrap a `withPgClient` function so that — at call time — it checks
 * the Grafast `contextValue` for a `pgSqlTextTransform`.  If present,
 * the database client is proxied to transform SQL.
 *
 * The transform is read **lazily** (at invocation time, not during
 * `prepareArgs`) because `grafast.context` runs *after* middleware
 * in the `hookArgs` finalization step.
 */
function wrapWithPgClient(
  original: (...args: any[]) => any,
  contextValue: Record<string, any>,
) {
  const wrapped = (
    pgSettings: any,
    callback: (client: any) => any,
  ) => {
    const transform = contextValue.pgSqlTextTransform as
      | ((text: string) => string)
      | undefined;

    if (typeof transform === 'function') {
      return original(pgSettings, (client: any) =>
        callback(createSqlTransformProxy(client, transform)),
      );
    }
    // No transform — pass through unchanged
    return original(pgSettings, callback);
  };
  // Preserve the release method (used during shutdown)
  if (typeof (original as any).release === 'function') {
    (wrapped as any).release = (original as any).release;
  }
  return wrapped;
}

/**
 * Grafast plugin that enables per-request SQL schema remapping without
 * modifying Crystal's source code.
 *
 * ## Usage
 *
 * Add this plugin to the PostGraphile preset alongside
 * `graphile-multi-tenancy-cache`:
 *
 * ```ts
 * import { PgMultiTenancyWrapperPlugin } from 'graphile-multi-tenancy-cache';
 *
 * const preset = {
 *   plugins: [PgMultiTenancyWrapperPlugin],
 *   grafast: {
 *     context: (requestContext) => ({
 *       pgSqlTextTransform: getTenantTransform(requestContext),
 *     }),
 *   },
 * };
 * ```
 *
 * The plugin reads `pgSqlTextTransform` from the Grafast context at
 * execution time and applies it to every SQL query.
 */
export const PgMultiTenancyWrapperPlugin: GraphileConfig.Plugin = {
  name: 'PgMultiTenancyWrapperPlugin',
  version: '0.1.0',

  grafast: {
    middleware: {
      prepareArgs(next, { args }) {
        const pgServices = args.resolvedPreset?.pgServices;
        if (!pgServices || pgServices.length === 0) {
          return next();
        }

        const contextValue = args.contextValue as Record<string, any>;

        for (const svc of pgServices) {
          const key = (svc as any).withPgClientKey as string | undefined;
          if (!key) continue;

          const original = contextValue[key];
          if (typeof original !== 'function') continue;

          // Replace with a lazy wrapper that reads the transform at call time
          contextValue[key] = wrapWithPgClient(original, contextValue);
        }

        return next();
      },
    },
  },
};
