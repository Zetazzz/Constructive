# @constructive-io/upload-client

<p align="center" width="100%">
  <img height="250" src="https://raw.githubusercontent.com/constructive-io/constructive/refs/heads/main/assets/outline-logo.svg" />
</p>

<p align="center" width="100%">
  <a href="https://github.com/constructive-io/constructive/actions/workflows/run-tests.yaml">
    <img height="20" src="https://github.com/constructive-io/constructive/actions/workflows/run-tests.yaml/badge.svg" />
  </a>
   <a href="https://github.com/constructive-io/constructive/blob/main/LICENSE"><img height="20" src="https://img.shields.io/badge/license-MIT-blue.svg"/></a>
   <a href="https://www.npmjs.com/package/@constructive-io/upload-client"><img height="20" src="https://img.shields.io/github/package-json/v/constructive-io/constructive?filename=packages%2Fupload-client%2Fpackage.json"/></a>
</p>

Client-side presigned URL upload utilities for Constructive.

No Node.js-only dependencies — all APIs use Web standards (fetch, Web Crypto).

## Usage

```typescript
import { uploadFile, hashFile, hashContent, putToPresignedUrl, fetchFromUrl } from '@constructive-io/upload-client';

// Full orchestrated upload
const result = await uploadFile({
  file: selectedFile,
  bucketKey: 'avatars',
  execute: myGraphQLExecutor,
  onProgress: (pct) => console.log(`${pct}%`),
});

// Atomic functions for custom flows
const hash = await hashFile(myFile);
const contentHash = await hashContent('file contents');
await putToPresignedUrl(presignedUrl, content, 'image/png');
const response = await fetchFromUrl(downloadUrl);
```

## API

### `uploadFile(options)`

Orchestrates the full presigned URL upload flow: hash → requestUploadUrl → PUT to S3.

### `hashFile(file)`

Computes SHA-256 hash of a File/Blob using the Web Crypto API.

### `hashFileChunked(file, chunkSize?, onProgress?)`

Computes SHA-256 hash in chunks for large files.

### `hashContent(content)`

Computes SHA-256 hex digest of a plain string using the Web Crypto API.

### `putToPresignedUrl(url, body, contentType, signal?)`

PUT content to a presigned S3 URL. Throws `UploadError` on failure.

### `fetchFromUrl(url, signal?)`

Fetch content from a presigned GET or CDN URL. Throws `UploadError` on failure.
