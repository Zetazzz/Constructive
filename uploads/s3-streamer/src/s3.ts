import { createS3Client } from '@constructive-io/s3-utils';
import type { StorageProvider } from '@constructive-io/s3-utils';
import type { S3Client } from '@aws-sdk/client-s3';

interface S3Options {
  awsAccessKey: string;
  awsSecretKey: string;
  awsRegion: string;
  endpoint?: string;
  provider?: StorageProvider;
}

export default function getS3(opts: S3Options): S3Client {
  return createS3Client({
    provider: opts.provider || 'minio',
    region: opts.awsRegion,
    accessKeyId: opts.awsAccessKey,
    secretAccessKey: opts.awsSecretKey,
    ...(opts.endpoint ? { endpoint: opts.endpoint } : {}),
  });
}
