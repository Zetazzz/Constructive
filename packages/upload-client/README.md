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

Presigned URL upload utilities for Constructive.

One package for all upload workflows — browser and Node.js.

## Usage

```typescript
import { uploadFile, hashFile, hashContent, putToPresignedUrl, fetchFromUrl } from '@constructive-io/upload-client';

// Full orchestrated upload (browser)
const result = await uploadFile({
  file: selectedFile,
  bucketKey: 'avatars',
  execute: myGraphQLExecutor,
  onProgress: (pct) => console.log(`${pct}%`),
});

// Atomic functions for custom flows (Node.js / tests / scripts)
const hash = hashContent('file contents');
await putToPresignedUrl(presignedUrl, content, 'image/png');
const response = await fetchFromUrl(downloadUrl);
```

## API

### `uploadFile(options)`

Orchestrates the full presigned URL upload flow: hash → requestUploadUrl → PUT to S3.

### `hashFile(file)`

Computes SHA-256 hash using the Web Crypto API (browser / Node 18+).

### `hashFileChunked(file, chunkSize?, onProgress?)`

Computes SHA-256 hash in chunks for large files.

### `hashContent(content)`

Computes SHA-256 hex digest of a string or Buffer (Node.js).

### `putToPresignedUrl(url, body, contentType, signal?)`

PUT content to a presigned S3 URL. Throws `UploadError` on failure.

### `fetchFromUrl(url, signal?)`

Fetch content from a presigned GET or CDN URL. Throws `UploadError` on failure.
