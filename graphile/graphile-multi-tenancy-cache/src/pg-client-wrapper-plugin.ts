/**
 * PgMultiTenancyWrapperPlugin
 *
 * Grafast middleware plugin that intercepts client.query() to transform SQL
 * per-request. Runs in grafast.middleware.prepareArgs AFTER PgContextPlugin,
 * wrapping the withPgClient function to proxy client.query() calls through
 * an async SQL text transform.
 *
 * The transform is read LAZILY at call time (not at middleware time) because
 * grafast.context finalization happens after middleware.
 *
 * The transform is async because pgsql-parser/pgsql-deparser use WASM.
 * Since client.query() already returns a Promise, the async proxy is
 * transparent to callers.
 */

import type { GraphileConfig } from 'graphile-config';

/**
 * Create a Proxy that intercepts client.query() and client.withTransaction()
 * to transform SQL text before it reaches PostgreSQL.
 *
 * The transform is async (returns Promise<string>) because the underlying
 * pgsql-parser uses WASM. The cache inside buildSchemaRemapTransform
 * provides a fast synchronous return path for repeated queries.
 */
function createSqlTransformProxy<T extends Record<string, any>>(
  client: T,
  transform: (text: string) => Promise<string>,
): T {
  return new Proxy(client, {
    get(target, prop, receiver) {
      if (prop === 'query') {
        return async (opts: any) => {
          if (typeof opts === 'object' && opts !== null && typeof opts.text === 'string') {
            const transformedText = await transform(opts.text);
            return target.query({ ...opts, text: transformedText });
          }
          // Fallback for string-form queries
          if (typeof opts === 'string') {
            const transformedText = await transform(opts);
            return target.query(transformedText);
          }
          return target.query(opts);
        };
      }

      if (prop === 'withTransaction') {
        return (callback: (txClient: any) => any) =>
          target.withTransaction((txClient: any) =>
            callback(createSqlTransformProxy(txClient, transform)),
          );
      }

      return Reflect.get(target, prop, receiver);
    },
  });
}

/**
 * Wrap a withPgClient function to lazily read pgSqlTextTransform from
 * contextValue at call time and apply the transform proxy.
 */
function wrapWithPgClient(
  original: any,
  contextValue: Record<string, any>,
): any {
  const wrapped = (pgSettings: any, callback: (client: any) => any) =>
    original(pgSettings, (client: any) => {
      const transform = contextValue.pgSqlTextTransform;
      if (typeof transform === 'function') {
        return callback(createSqlTransformProxy(client, transform));
      }
      return callback(client);
    });

  // Preserve .release() if present
  if (typeof original.release === 'function') {
    wrapped.release = original.release.bind(original);
  }

  return wrapped;
}

/**
 * The plugin — intercepts all pgService withPgClient functions to enable
 * per-request SQL text transformation.
 */
export const PgMultiTenancyWrapperPlugin: GraphileConfig.Plugin = {
  name: 'PgMultiTenancyWrapperPlugin',
  version: '0.1.0',

  grafast: {
    middleware: {
      prepareArgs(next, event) {
        const { args } = event;
        const resolvedPreset = args.resolvedPreset as any;
        const contextValue = args.contextValue as Record<string, any>;

        if (resolvedPreset?.pgServices) {
          for (const svc of resolvedPreset.pgServices) {
            const key = svc.withPgClientKey || 'withPgClient';
            const original = contextValue[key];
            if (typeof original === 'function') {
              contextValue[key] = wrapWithPgClient(original, contextValue);
            }
          }
        }

        return next();
      },
    },
  },
};
