/**
 * @constructive-io/upload-client
 *
 * Presigned URL upload utilities for Constructive.
 *
 * Provides atomic functions for the presigned URL upload pipeline:
 * - `hashFile` — SHA-256 hash via Web Crypto API (browser / Node 18+)
 * - `hashFileChunked` — chunked SHA-256 for large files
 * - `hashContent` — SHA-256 hash for strings / Buffers (Node.js)
 * - `putToPresignedUrl` — PUT bytes to a presigned S3 URL
 * - `fetchFromUrl` — GET from a presigned or CDN URL
 * - `uploadFile` — full upload orchestrator (hash → request → PUT)
 *
 * Works in both browser and Node.js 18+ environments.
 *
 * @example
 * ```typescript
 * import { uploadFile, hashFile, hashContent, putToPresignedUrl } from '@constructive-io/upload-client';
 *
 * // Full orchestrated upload (browser)
 * const result = await uploadFile({
 *   file: selectedFile,
 *   bucketKey: 'avatars',
 *   execute: myGraphQLExecutor,
 * });
 *
 * // Atomic functions for custom flows
 * const hash = hashContent('file contents');
 * await putToPresignedUrl(presignedUrl, content, 'image/png');
 * ```
 */

// Hashing
export { hashFile, hashFileChunked } from './hash';
export { hashContent } from './hash-content';

// Presigned URL helpers
export { putToPresignedUrl, fetchFromUrl } from './put';

// Orchestrator
export { uploadFile } from './upload';

// GraphQL query builders (for custom integrations)
export { buildRequestUploadUrlQuery, REQUEST_UPLOAD_URL_QUERY, REQUEST_UPLOAD_URL_MUTATION, DEFAULT_BUCKET_QUERY_FIELD } from './queries';

// Types
export type {
  FileInput,
  GraphQLExecutor,
  UploadFileOptions,
  UploadResult,
  RequestUploadUrlInput,
  RequestUploadUrlPayload,
  UploadErrorCode,
} from './types';

export { UploadError } from './types';
