import type { GetConnectionsInput, GetConnectionsResult } from 'graphile-realtime-test';
import { getConnections as getLowLevelConnections } from 'graphile-realtime-test';
import { ConstructivePreset } from 'graphile-settings';
import type { SeedAdapter } from 'pgsql-test/seed/types';

/**
 * Creates realtime test connections using the full ConstructivePreset.
 *
 * This wraps `graphile-realtime-test`'s `getConnections` by injecting the
 * ConstructivePreset into the schema build. The returned `GetConnectionsResult`
 * includes a fully wired WebSocket server, notify helpers, and all Constructive
 * plugins (auth, RLS, storage, search, realtime subscriptions, etc.).
 *
 * Mirrors the pattern of `@constructive-io/graphql-test`'s `getConnections`
 * wrapping `graphile-test`.
 */
export async function getConnections(
  input: GetConnectionsInput,
  seedAdapters?: SeedAdapter[],
): Promise<GetConnectionsResult> {
  const mergedInput: GetConnectionsInput = {
    ...input,
    preset: {
      extends: [
        ConstructivePreset,
        ...(input.preset?.extends ?? []),
      ],
      ...(input.preset?.disablePlugins && { disablePlugins: input.preset.disablePlugins }),
      ...(input.preset?.plugins && { plugins: input.preset.plugins }),
      ...(input.preset?.schema && { schema: input.preset.schema }),
      ...(input.preset?.grafast && { grafast: input.preset.grafast }),
    },
  };

  return getLowLevelConnections(mergedInput, seedAdapters);
}
