/**
 * Presigned URL Plugin for PostGraphile v5
 *
 * Provides per-table S3 storage middleware for PostGraphile v5:
 * - Upload fields on @storageBuckets types (requestUploadUrl, requestBulkUploadUrls)
 * - Delete middleware on @storageFiles tables (S3 cleanup on delete)
 * - downloadUrl computed field on @storageFiles types
 *
 * @example
 * ```typescript
 * import { PresignedUrlPreset } from 'graphile-presigned-url-plugin';
 * import { S3Client } from '@aws-sdk/client-s3';
 *
 * const s3Client = new S3Client({ region: 'us-east-1' });
 *
 * const preset = {
 *   extends: [
 *     PresignedUrlPreset({
 *       s3: {
 *         client: s3Client,
 *         bucket: 'my-uploads',
 *         publicUrlPrefix: 'https://cdn.example.com',
 *       },
 *     }),
 *   ],
 * };
 * ```
 */

export { PresignedUrlPlugin, createPresignedUrlPlugin } from './plugin';
export { createDownloadUrlPlugin } from './download-url-field';
export { PresignedUrlPreset } from './preset';
export { getStorageModuleConfig, getStorageModuleConfigForOwner, getBucketConfig, resolveStorageModuleByFileId, loadAllStorageModules, resolveStorageConfigFromCodec, clearStorageModuleCache, clearBucketCache, isS3BucketProvisioned, markS3BucketProvisioned } from './storage-module-cache';
export { generatePresignedPutUrl, generatePresignedGetUrl, deleteS3Object, headObject } from './s3-signer';
export type {
  BucketConfig,
  StorageModuleConfig,
  RequestUploadUrlInput,
  RequestUploadUrlPayload,
  S3Config,
  S3ConfigOrGetter,
  PresignedUrlPluginOptions,
  BucketNameResolver,
  EnsureBucketProvisioned,
} from './types';
