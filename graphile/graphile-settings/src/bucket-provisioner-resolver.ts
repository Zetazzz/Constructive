/**
 * Bucket provisioner resolver for the Constructive bucket provisioner plugin.
 *
 * Reads CDN/S3 configuration from the Constructive env resolver and lazily
 * returns a StorageConnectionConfig on first use.
 *
 * Follows the same lazy-init pattern as presigned-url-resolver.ts.
 */

import { getConstructiveEnvOptions } from '@constructive-io/graphql-env';
import type { ConstructiveOptions } from '@constructive-io/graphql-types';
import { Logger } from '@pgpmjs/logger';
import type { StorageConnectionConfig } from 'graphile-bucket-provisioner-plugin';

const log = new Logger('bucket-provisioner-resolver');

type StorageRuntimeOptions = Pick<ConstructiveOptions, 'cdn'>;
const connectionResolvers = new WeakMap<
  StorageRuntimeOptions,
  () => StorageConnectionConfig
>();

const resolveConnection = (
  options?: StorageRuntimeOptions
): StorageConnectionConfig => {
  const cdn = (options ?? getConstructiveEnvOptions()).cdn ?? {};
  const { provider, awsRegion, awsAccessKey, awsSecretKey, endpoint } = cdn;

  if (!awsAccessKey || !awsSecretKey) {
    throw new Error(
      '[bucket-provisioner-resolver] Missing S3 credentials. ' +
        'Set AWS_ACCESS_KEY and AWS_SECRET_KEY environment variables.'
    );
  }

  log.info(
    `[bucket-provisioner-resolver] Initializing: provider=${provider} endpoint=${endpoint}`
  );

  return {
    provider: (provider as StorageConnectionConfig['provider']) || 'minio',
    region: awsRegion || 'us-east-1',
    accessKeyId: awsAccessKey,
    secretAccessKey: awsSecretKey,
    ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
  };
};

export const createBucketProvisionerConnectionResolver = (
  options?: StorageRuntimeOptions
): (() => StorageConnectionConfig) => {
  if (options) {
    const cached = connectionResolvers.get(options);
    if (cached) return cached;
  }

  let connectionConfig: StorageConnectionConfig | null = null;
  const resolver = () => (connectionConfig ??= resolveConnection(options));
  if (options) connectionResolvers.set(options, resolver);
  return resolver;
};

const defaultConnectionResolver = createBucketProvisionerConnectionResolver();

/**
 * Lazily initialize and return the StorageConnectionConfig for the
 * bucket provisioner plugin.
 *
 * Reads CDN config on first call via getConstructiveEnvOptions() and caches the result.
 * Same CDN config source as presigned-url-resolver.ts.
 */
export function getBucketProvisionerConnection(): StorageConnectionConfig {
  return defaultConnectionResolver();
}
