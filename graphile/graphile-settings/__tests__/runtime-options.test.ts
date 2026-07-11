import { createBucketProvisionerConnectionResolver } from '../src/bucket-provisioner-resolver';
import {
  createBucketNameResolver,
  createPresignedUrlS3ConfigResolver,
  getAllowedOrigins,
} from '../src/presigned-url-resolver';

describe('Graphile storage runtime options', () => {
  const createOptions = (name: string) => ({
    cdn: {
      provider: 'minio' as const,
      bucketName: `${name}-bucket`,
      awsRegion: `${name}-region`,
      awsAccessKey: `${name}-access`,
      awsSecretKey: `${name}-secret`,
      endpoint: `http://${name}-storage`,
      publicUrlPrefix: `https://${name}-cdn`,
    },
    server: { origin: `https://${name}-app` },
    runtime: { nodeEnv: 'test' as const },
  });

  it('captures explicit options and isolates distinct server configurations', () => {
    const first = createOptions('first');
    const second = createOptions('second');

    const firstConnection = createBucketProvisionerConnectionResolver(first);
    const secondConnection = createBucketProvisionerConnectionResolver(second);
    expect(firstConnection()).toMatchObject({
      region: 'first-region',
      endpoint: 'http://first-storage',
      accessKeyId: 'first-access',
    });
    expect(secondConnection()).toMatchObject({
      region: 'second-region',
      endpoint: 'http://second-storage',
      accessKeyId: 'second-access',
    });

    const firstS3 = createPresignedUrlS3ConfigResolver(first);
    const secondS3 = createPresignedUrlS3ConfigResolver(second);
    expect(firstS3()).toMatchObject({
      bucket: 'first-bucket',
      endpoint: 'http://first-storage',
      publicUrlPrefix: 'https://first-cdn',
    });
    expect(secondS3()).toMatchObject({
      bucket: 'second-bucket',
      endpoint: 'http://second-storage',
      publicUrlPrefix: 'https://second-cdn',
    });

    expect(createBucketNameResolver(first)('db-id', 'public')).toBe(
      'first-bucket-public-db-id'
    );
    expect(getAllowedOrigins(second)).toEqual(['https://second-app']);

    expect(createBucketProvisionerConnectionResolver(first)).toBe(
      firstConnection
    );
    expect(createPresignedUrlS3ConfigResolver(first)).toBe(firstS3);
  });
});
