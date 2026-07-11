/**
 * Unified S3 client factory.
 *
 * Provides a single, canonical way to create an S3Client across the
 * Constructive ecosystem. Consumers import from @constructive-io/s3-utils
 * instead of wiring up @aws-sdk/client-s3 directly.
 *
 * Handles provider-specific defaults:
 * - minio: forces path-style URLs, requires endpoint
 * - r2: forces path-style URLs, requires endpoint
 * - gcs: forces path-style URLs, requires endpoint
 * - s3: virtual-hosted style (AWS default)
 * - spaces: virtual-hosted style (DigitalOcean default)
 *
 * @example
 * ```typescript
 * import { createS3Client } from '@constructive-io/s3-utils';
 *
 * const client = createS3Client({
 *   provider: 'minio',
 *   region: 'us-east-1',
 *   endpoint: 'http://minio:9000',
 *   accessKeyId: 'minioadmin',
 *   secretAccessKey: 'minioadmin',
 * });
 * ```
 */

import { S3Client } from '@aws-sdk/client-s3';
import type { StorageConnectionConfig } from '@constructive-io/graphql-types';

// --- Types ---

export type {
  StorageConnectionConfig,
  StorageProvider
} from '@constructive-io/graphql-types';

// --- Error ---

/**
 * Structured error for S3 client configuration issues.
 */
export class S3ConfigError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'S3ConfigError';
    this.code = code;
  }
}

// --- Factory ---

/**
 * Create an S3Client from a storage connection config.
 *
 * Provider-specific defaults:
 * - `minio`: forces path-style URLs (required by MinIO)
 * - `r2`: forces path-style URLs (required by Cloudflare R2)
 * - `s3`: uses virtual-hosted style (AWS default)
 * - `gcs`: forces path-style URLs (GCS S3-compatible API)
 * - `spaces`: uses virtual-hosted style (DigitalOcean default)
 */
export function createS3Client(config: StorageConnectionConfig): S3Client {
  if (!config.accessKeyId || !config.secretAccessKey) {
    throw new S3ConfigError(
      'INVALID_CONFIG',
      'accessKeyId and secretAccessKey are required',
    );
  }

  if (!config.region) {
    throw new S3ConfigError(
      'INVALID_CONFIG',
      'region is required',
    );
  }

  // Providers that require path-style URLs
  const pathStyleProviders = new Set(['minio', 'r2', 'gcs']);
  const forcePathStyle = config.forcePathStyle ?? pathStyleProviders.has(config.provider);

  // Non-AWS providers require an endpoint
  if (config.provider !== 's3' && !config.endpoint) {
    throw new S3ConfigError(
      'INVALID_CONFIG',
      `endpoint is required for provider '${config.provider}'`,
    );
  }

  return new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    forcePathStyle,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
}
