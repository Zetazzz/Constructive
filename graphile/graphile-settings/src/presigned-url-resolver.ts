/**
 * Presigned URL resolver for the Constructive presigned URL plugin.
 *
 * Reads CDN/S3 configuration from the Constructive env resolver and lazily
 * initializes an S3Client on first use.
 *
 * Also provides a per-database bucket name resolver that derives the
 * S3 bucket name from the database UUID + a configurable prefix.
 *
 * Follows the same lazy-init pattern as upload-resolver.ts.
 */

import { createS3Client } from '@constructive-io/s3-utils';
import { getConstructiveEnvOptions } from '@constructive-io/graphql-env';
import type { ConstructiveOptions } from '@constructive-io/graphql-types';
import { Logger } from '@pgpmjs/logger';
import type {
  S3Config,
  BucketNameResolver,
  EnsureBucketProvisioned,
} from 'graphile-presigned-url-plugin';
import { BucketProvisioner } from '@constructive-io/bucket-provisioner';
import { createBucketProvisionerConnectionResolver } from './bucket-provisioner-resolver';

const log = new Logger('presigned-url-resolver');

type StorageRuntimeOptions = Pick<
  ConstructiveOptions,
  'cdn' | 'server' | 'runtime'
>;
const s3ConfigResolvers = new WeakMap<StorageRuntimeOptions, () => S3Config>();
const ensureBucketResolvers = new WeakMap<
  StorageRuntimeOptions,
  EnsureBucketProvisioned
>();

const resolveOptions = (
  options?: StorageRuntimeOptions
): StorageRuntimeOptions => options ?? getConstructiveEnvOptions();

/**
 * Lazily initialize and return the S3Config for the presigned URL plugin.
 *
 * Reads CDN config on first call via getConstructiveEnvOptions(), creates an S3Client, and caches
 * the result. Same CDN config as upload-resolver.ts.
 *
 * NOTE: The `bucket` field here is the global fallback bucket name
 * (from BUCKET_NAME env var). When `resolveBucketName` is provided,
 * per-database bucket names take precedence for all S3 operations.
 */
export const createPresignedUrlS3ConfigResolver = (
  options?: StorageRuntimeOptions
): (() => S3Config) => {
  if (options) {
    const cached = s3ConfigResolvers.get(options);
    if (cached) return cached;
  }

  let s3Config: S3Config | null = null;

  const resolver = () => {
    if (s3Config) return s3Config;

    const cdn = resolveOptions(options).cdn ?? {};

    const {
      bucketName,
      awsRegion,
      awsAccessKey,
      awsSecretKey,
      endpoint,
      publicUrlPrefix,
    } = cdn;

    if (!awsAccessKey || !awsSecretKey) {
      throw new Error(
        '[presigned-url-resolver] Missing S3 credentials. ' +
          'Set AWS_ACCESS_KEY and AWS_SECRET_KEY environment variables.'
      );
    }

    if (!bucketName) {
      throw new Error(
        '[presigned-url-resolver] Missing CDN bucket name. ' +
          'Set BUCKET_NAME environment variable.'
      );
    }

    log.info(
      `[presigned-url-resolver] Initializing: bucket=${bucketName} endpoint=${endpoint}`
    );

    const client = createS3Client({
      provider: (cdn.provider || 'minio') as any,
      region: awsRegion,
      accessKeyId: awsAccessKey,
      secretAccessKey: awsSecretKey,
      ...(endpoint ? { endpoint } : {}),
    });

    s3Config = {
      client,
      bucket: bucketName,
      region: awsRegion,
      publicUrlPrefix,
      ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
    };

    return s3Config;
  };
  if (options) s3ConfigResolvers.set(options, resolver);
  return resolver;
};

const defaultS3ConfigResolver = createPresignedUrlS3ConfigResolver();

export function getPresignedUrlS3Config(): S3Config {
  return defaultS3ConfigResolver();
}

/**
 * Create a per-(database, bucketKey) bucket name resolver.
 *
 * Uses the BUCKET_NAME env var as a prefix. For each (database, bucketKey)
 * pair, the S3 bucket name becomes `{prefix}-{bucketKey}-{databaseId}`
 * (e.g., "myapp-public-abc123def456").
 *
 * This aligns with the bucket provisioner plugin which creates separate
 * S3 buckets per logical bucket key.
 */
export function createBucketNameResolver(
  options?: StorageRuntimeOptions
): BucketNameResolver {
  const { bucketName } = resolveOptions(options).cdn ?? {};
  const prefix = bucketName || 'test-bucket';

  return (databaseId: string, bucketKey: string): string => {
    return `${prefix}-${bucketKey}-${databaseId}`;
  };
}

/**
 * Resolve CORS allowed origins from the Constructive env system.
 */
export function getAllowedOrigins(options?: StorageRuntimeOptions): string[] {
  const origin = resolveOptions(options).server?.origin;
  return origin ? [origin] : ['*'];
}

/**
 * Create a lazy bucket provisioner callback for the presigned URL plugin.
 *
 * On the first upload to an S3 bucket that doesn't exist yet, this callback
 * uses the BucketProvisioner to create and fully configure the bucket
 * (Block Public Access, CORS, policies, lifecycle rules for temp buckets).
 *
 * Uses the same S3 connection config as the bucket provisioner plugin
 * (getBucketProvisionerConnection) and reads the global CORS fallback from
 * the Constructive aggregate.
 */
export function createEnsureBucketProvisioned(
  options?: StorageRuntimeOptions
): EnsureBucketProvisioned {
  if (options) {
    const cached = ensureBucketResolvers.get(options);
    if (cached) return cached;
  }

  let provisioner: BucketProvisioner | null = null;
  const getConnection = createBucketProvisionerConnectionResolver(options);

  const resolver: EnsureBucketProvisioned = async (
    bucketName: string,
    accessType: 'public' | 'private' | 'temp',
    databaseId: string,
    allowedOrigins: string[] | null
  ): Promise<void> => {
    // Per-database origins from storage_module, falling back to global settings.
    const effectiveOrigins =
      allowedOrigins && allowedOrigins.length > 0
        ? allowedOrigins
        : getAllowedOrigins(options);

    if (!provisioner) {
      provisioner = new BucketProvisioner({
        connection: getConnection(),
        allowedOrigins: effectiveOrigins,
      });
    }

    log.info(
      `[lazy-provision] Provisioning S3 bucket "${bucketName}" ` +
        `(type=${accessType}) for database ${databaseId}`
    );

    await provisioner.provision({
      bucketName,
      accessType,
      versioning: false,
      allowedOrigins: effectiveOrigins,
    });

    log.info(
      `[lazy-provision] S3 bucket "${bucketName}" provisioned successfully`
    );
  };
  if (options) ensureBucketResolvers.set(options, resolver);
  return resolver;
}
