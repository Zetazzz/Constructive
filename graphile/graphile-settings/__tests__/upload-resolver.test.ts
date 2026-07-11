import { Readable } from 'stream';

interface MockUploadResult {
  upload: { Location: string };
  contentType: string;
}

async function loadUploadResolverModule(opts: {
  detectedContentType: string;
  uploadResultContentType?: string;
}) {
  jest.resetModules();

  const mockDetectContentType = jest.fn().mockResolvedValue({
    stream: Readable.from([Buffer.alloc(16)]),
    magic: { type: opts.detectedContentType, charset: 'binary' },
    contentType: opts.detectedContentType,
  });

  const mockUploadWithContentType = jest.fn().mockResolvedValue({
    upload: { Location: 'https://cdn.example.com/uploaded-file' },
    contentType: opts.uploadResultContentType ?? opts.detectedContentType,
  } as MockUploadResult);

  const mockUpload = jest.fn().mockResolvedValue({
    upload: { Location: 'https://cdn.example.com/storage-upload' },
    contentType: 'application/octet-stream',
  } as MockUploadResult);
  const mockStreamer = jest.fn().mockImplementation(() => ({
    upload: mockUpload,
    uploadWithContentType: mockUploadWithContentType,
    detectContentType: mockDetectContentType,
  }));

  jest.doMock('@constructive-io/graphql-env', () => ({
    getConstructiveEnvOptions: jest.fn(() => ({
      cdn: {
        provider: 'minio',
        bucketName: 'test-bucket',
        awsRegion: 'us-east-1',
        awsAccessKey: 'test',
        awsSecretKey: 'test',
        endpoint: 'http://localhost:9000',
      },
    })),
  }));

  jest.doMock('@constructive-io/s3-streamer', () => {
    return {
      __esModule: true,
      default: mockStreamer,
    };
  });

  const mod = await import('../src/upload-resolver');

  return {
    ...mod,
    mockDetectContentType,
    mockUploadWithContentType,
    mockUpload,
    mockStreamer,
  };
}

function makeFakeUpload(filename: string) {
  return {
    filename,
    createReadStream: jest.fn(() => Readable.from([Buffer.alloc(16)])),
  };
}

describe('uploadResolver MIME validation', () => {
  it('rejects disallowed MIME before uploading to storage', async () => {
    const {
      constructiveUploadFieldDefinitions,
      mockDetectContentType,
      mockUploadWithContentType,
    } = await loadUploadResolverModule({
      detectedContentType: 'application/pdf',
    });

    const imageDef = constructiveUploadFieldDefinitions.find(
      (def) => 'name' in def && def.name === 'image'
    );
    if (!imageDef) {
      throw new Error('Missing image upload field definition');
    }

    const fakeUpload = makeFakeUpload('document.pdf');

    await expect(
      imageDef.resolve(
        fakeUpload as any,
        {},
        {},
        { uploadPlugin: { tags: {}, type: 'image' } }
      )
    ).rejects.toThrow('UPLOAD_MIMETYPE');

    expect(mockDetectContentType).toHaveBeenCalledTimes(1);
    expect(mockUploadWithContentType).not.toHaveBeenCalled();
  });

  it('uploads and returns image metadata when MIME is allowed', async () => {
    const {
      constructiveUploadFieldDefinitions,
      mockDetectContentType,
      mockUploadWithContentType,
    } = await loadUploadResolverModule({
      detectedContentType: 'image/png',
      uploadResultContentType: 'image/png',
    });

    const imageDef = constructiveUploadFieldDefinitions.find(
      (def) => 'name' in def && def.name === 'image'
    );
    if (!imageDef) {
      throw new Error('Missing image upload field definition');
    }

    const fakeUpload = makeFakeUpload('photo.png');

    const result = await imageDef.resolve(
      fakeUpload as any,
      {},
      {},
      { uploadPlugin: { tags: {}, type: 'image' } }
    );

    expect(result).toEqual({
      filename: 'photo.png',
      mime: 'image/png',
      url: 'https://cdn.example.com/uploaded-file',
    });
    expect(mockDetectContentType).toHaveBeenCalledTimes(1);
    expect(mockUploadWithContentType).toHaveBeenCalledTimes(1);
    expect(mockUploadWithContentType).toHaveBeenCalledWith(
      expect.objectContaining({
        contentType: 'image/png',
      })
    );
  });

  it('uses each explicit runtime storage override without reusing another config', async () => {
    const { createConstructiveUploadFieldDefinitions, mockStreamer } =
      await loadUploadResolverModule({ detectedContentType: 'image/png' });

    const firstOptions = {
      cdn: {
        provider: 'minio' as const,
        bucketName: 'first-bucket',
        awsRegion: 'first-region',
        awsAccessKey: 'first-access',
        awsSecretKey: 'first-secret',
        endpoint: 'http://first-storage',
      },
      runtime: { nodeEnv: 'test' as const },
    };
    const secondOptions = {
      cdn: {
        provider: 's3' as const,
        bucketName: 'second-bucket',
        awsRegion: 'second-region',
        awsAccessKey: 'second-access',
        awsSecretKey: 'second-secret',
        endpoint: 'http://second-storage',
      },
      runtime: { nodeEnv: 'test' as const },
    };

    for (const options of [firstOptions, secondOptions]) {
      const definition = createConstructiveUploadFieldDefinitions(options)[0];
      await definition.resolve(
        makeFakeUpload('photo.png') as any,
        {},
        {},
        { uploadPlugin: { tags: {}, type: 'image' } }
      );
    }

    expect(mockStreamer).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        defaultBucket: 'first-bucket',
        endpoint: 'http://first-storage',
      })
    );
    expect(mockStreamer).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        defaultBucket: 'second-bucket',
        endpoint: 'http://second-storage',
      })
    );
  });
});
