/**
 * Loader Registry — manages a set of ModuleLoader instances.
 *
 * Resolves all registered loaders in parallel for a given database,
 * returning a typed modules map. Each loader's result is independently
 * cached — a change to one module doesn't invalidate the others.
 */

import { Logger } from '@pgpmjs/logger';

import type { LoaderContext, ModuleLoader } from './types';

const log = new Logger('loader-registry');

export interface LoaderRegistry {
  /** Register a loader. Throws if a loader with the same name already exists. */
  register(loader: ModuleLoader): void;
  /** Resolve all registered loaders in parallel for the given context. */
  resolveAll(ctx: LoaderContext): Promise<Record<string, unknown>>;
  /** Get a specific loader by name. */
  get<T = unknown>(name: string): ModuleLoader<T> | undefined;
  /** Invalidate caches for one database (or all databases if omitted). */
  invalidate(databaseId?: string): void;
  /** List all registered loader names. */
  readonly names: string[];
}

export function createLoaderRegistry(): LoaderRegistry {
  const loaders = new Map<string, ModuleLoader>();

  return {
    register(loader: ModuleLoader): void {
      if (loaders.has(loader.name)) {
        throw new Error(`Loader "${loader.name}" is already registered`);
      }
      loaders.set(loader.name, loader);
      log.debug(`Registered loader: ${loader.name}`);
    },

    async resolveAll(ctx: LoaderContext): Promise<Record<string, unknown>> {
      if (loaders.size === 0) return {};

      const entries = Array.from(loaders.entries());
      const results = await Promise.all(
        entries.map(async ([name, loader]) => {
          const value = await loader.resolve(ctx);
          return [name, value] as const;
        }),
      );

      const modules: Record<string, unknown> = {};
      for (const [name, value] of results) {
        if (value !== undefined) {
          modules[name] = value;
        }
      }
      return modules;
    },

    get<T = unknown>(name: string): ModuleLoader<T> | undefined {
      return loaders.get(name) as ModuleLoader<T> | undefined;
    },

    invalidate(databaseId?: string): void {
      for (const loader of loaders.values()) {
        loader.invalidate(databaseId);
      }
      log.debug(
        databaseId
          ? `Invalidated all loaders for databaseId=${databaseId}`
          : 'Invalidated all loaders',
      );
    },

    get names(): string[] {
      return Array.from(loaders.keys());
    },
  };
}
