/**
 * Per-Table Storage Middleware Plugin for PostGraphile v5
 *
 * Hooks into PostGraphile's auto-generated CRUD mutations to add S3 operations:
 *
 * 1. Delete middleware — wraps `delete*` mutations on `@storageFiles`-tagged tables
 *    with S3 object cleanup (sync + async GC fallback via AFTER DELETE trigger).
 *
 * 2. Upload fields — adds `requestUploadUrl` and `requestBulkUploadUrls` fields
 *    on `@storageBuckets`-tagged types, so clients upload via the typed bucket API.
 *
 * 3. Mutation entry points — adds per-bucket mutation fields on the root Mutation
 *    type (e.g., `appBucket(key: "public"): AppBucket`), so upload operations
 *    can be accessed as proper GraphQL mutations instead of queries.
 *
 * 4. downloadUrl — handled by download-url-field.ts (separate plugin).
 *
 * Scope resolution uses the codec's schema/table name matched against
 * cached storage module configs.
 */

import { access, context as grafastContext, lambda, object } from 'grafast';
import type { GraphileConfig } from 'graphile-config';
import 'graphile-build';
import { Logger } from '@pgpmjs/logger';

import type { PresignedUrlPluginOptions, S3Config, StorageModuleConfig, BucketConfig } from './types';
import { loadAllStorageModules, resolveStorageConfigFromCodec, getBucketConfig, isS3BucketProvisioned, markS3BucketProvisioned } from './storage-module-cache';
import { generatePresignedPutUrl, deleteS3Object } from './s3-signer';

const log = new Logger('graphile-presigned-url:plugin');

// --- Protocol-level constants (not configurable) ---

const MAX_CONTENT_HASH_LENGTH = 128;
const MAX_CONTENT_TYPE_LENGTH = 255;
const MAX_CUSTOM_KEY_LENGTH = 1024;
const SHA256_HEX_REGEX = /^[a-f0-9]{64}$/;
const CUSTOM_KEY_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9_.\-\/]*$/;

// --- Helpers ---

function isValidSha256(hash: string): boolean {
  return SHA256_HEX_REGEX.test(hash);
}

function buildS3Key(contentHash: string): string {
  return contentHash;
}

function validateCustomKey(key: string): string | null {
  if (key.length === 0 || key.length > MAX_CUSTOM_KEY_LENGTH) {
    return 'INVALID_KEY_LENGTH: must be 1-1024 characters';
  }
  if (key.includes('..')) {
    return 'INVALID_KEY: path traversal (..) not allowed';
  }
  if (key.startsWith('/')) {
    return 'INVALID_KEY: leading slash not allowed';
  }
  if (key.includes('\0')) {
    return 'INVALID_KEY: null bytes not allowed';
  }
  if (!CUSTOM_KEY_REGEX.test(key)) {
    return 'INVALID_KEY: must start with alphanumeric and contain only alphanumeric, dots, hyphens, underscores, and slashes';
  }
  return null;
}

function derivePathFromKey(key: string): string | null {
  const lastSlash = key.lastIndexOf('/');
  if (lastSlash <= 0) return null;
  const dir = key.substring(0, lastSlash);
  return dir.replace(/\//g, '.');
}

async function resolveDatabaseId(pgClient: any): Promise<string | null> {
  const result = await pgClient.query({
    text: `SELECT jwt_private.current_database_id() AS id`,
  });
  return result.rows[0]?.id ?? null;
}

function resolveS3(options: PresignedUrlPluginOptions): S3Config {
  if (typeof options.s3 === 'function') {
    const resolved = options.s3();
    options.s3 = resolved;
    return resolved;
  }
  return options.s3;
}

function resolveS3ForDatabase(
  options: PresignedUrlPluginOptions,
  storageConfig: StorageModuleConfig,
  databaseId: string,
): S3Config {
  const globalS3 = resolveS3(options);
  const bucket = options.resolveBucketName
    ? options.resolveBucketName(databaseId)
    : globalS3.bucket;
  const publicUrlPrefix = storageConfig.publicUrlPrefix ?? globalS3.publicUrlPrefix;

  if (bucket === globalS3.bucket && publicUrlPrefix === globalS3.publicUrlPrefix) {
    return globalS3;
  }

  return {
    ...globalS3,
    bucket,
    ...(publicUrlPrefix != null ? { publicUrlPrefix } : {}),
  };
}

async function ensureS3BucketExists(
  options: PresignedUrlPluginOptions,
  s3BucketName: string,
  bucket: BucketConfig,
  databaseId: string,
  allowedOrigins: string[] | null,
): Promise<void> {
  if (!options.ensureBucketProvisioned) return;
  if (isS3BucketProvisioned(s3BucketName)) return;

  log.info(`Lazy-provisioning S3 bucket "${s3BucketName}" for database ${databaseId}`);
  await options.ensureBucketProvisioned(s3BucketName, bucket.type, databaseId, allowedOrigins);
  markS3BucketProvisioned(s3BucketName);
  log.info(`Lazy-provisioned S3 bucket "${s3BucketName}" successfully`);
}

// --- Plugin factory ---

export function createPresignedUrlPlugin(
  options: PresignedUrlPluginOptions,
): GraphileConfig.Plugin {

  return {
    name: 'PresignedUrlPlugin',
    version: '1.0.0',
    description: 'Per-table S3 storage middleware: upload fields on @storageBuckets, delete middleware on @storageFiles',

    after: ['PgAttributesPlugin', 'PgMutationCreatePlugin', 'PgMutationUpdateDeletePlugin'],

    schema: {
      hooks: {
        /**
         * Add requestUploadUrl and requestBulkUploadUrls fields on @storageBuckets types.
         */
        GraphQLObjectType_fields(fields, build, context) {
          const {
            scope: { pgCodec, isPgClassType, isRootMutation },
          } = context as any;

          // --- Path 1: Add per-bucket mutation entry points on root Mutation ---
          if (isRootMutation) {
            const {
              graphql: { GraphQLString, GraphQLNonNull },
            } = build;

            const bucketCodecs = Object.values((build.input as any).pgRegistry.pgCodecs).filter(
              (codec: any) => codec.attributes && (codec.extensions as any)?.tags?.storageBuckets,
            );

            if (bucketCodecs.length === 0) return fields;

            const newFields: Record<string, any> = {};
            for (const codec of bucketCodecs as any[]) {
              const typeName = (build.inflection as any).tableType(codec);
              const bucketType = build.getTypeByName(typeName);
              if (!bucketType) {
                log.debug(`Skipping mutation entry point for ${codec.name}: type ${typeName} not found`);
                continue;
              }

              const fieldName = typeName.charAt(0).toLowerCase() + typeName.slice(1);
              const hasOwnerId = !!codec.attributes.owner_id;

              // Find the PgResource for this codec so we can return a proper PgSelectSingleStep
              const bucketResource = Object.values((build.input as any).pgRegistry.pgResources).find(
                (r: any) => r.codec === codec && !r.isUnique && !r.isVirtual && !r.parameters,
              ) as any;
              if (!bucketResource) {
                log.debug(`Skipping mutation entry point for ${codec.name}: no PgResource found`);
                continue;
              }

              log.debug(`Adding mutation entry point "${fieldName}" for bucket type ${typeName} (entity-scoped=${hasOwnerId})`);

              newFields[fieldName] = context.fieldWithHooks(
                { fieldName } as any,
                {
                  description: `Look up a ${typeName} by key for mutation operations (upload, etc.).`,
                  type: bucketType,
                  args: {
                    key: { type: new GraphQLNonNull(GraphQLString), description: 'Bucket key (e.g., "public", "private")' },
                    ...(hasOwnerId
                      ? { ownerId: { type: new GraphQLNonNull(GraphQLString), description: 'Owner entity ID (required for entity-scoped buckets)' } }
                      : {}),
                  },
                  plan(_$mutation: any, fieldArgs: any) {
                    const spec: Record<string, any> = {
                      key: fieldArgs.getRaw('key'),
                    };
                    if (hasOwnerId) {
                      spec.owner_id = fieldArgs.getRaw('ownerId');
                    }
                    return bucketResource.find(spec).single();
                  },
                },
              );
            }

            return build.extend(
              fields,
              newFields,
              'PresignedUrlPlugin adding per-bucket mutation entry points',
            );
          }

          // --- Path 2: Add upload fields on @storageBuckets types ---
          if (!isPgClassType || !pgCodec || !pgCodec.attributes) {
            return fields;
          }

          const tags = (pgCodec.extensions as any)?.tags;
          if (!tags?.storageBuckets) {
            return fields;
          }

          log.debug(`Adding upload fields to bucket type: ${pgCodec.name} (has @storageBuckets tag)`);

          const {
            graphql: {
              GraphQLString,
              GraphQLNonNull,
              GraphQLInt,
              GraphQLBoolean,
              GraphQLObjectType,
              GraphQLList,
              GraphQLInputObjectType,
            },
          } = build;

          // --- Shared output types ---

          const UploadUrlPayloadType = new GraphQLObjectType({
            name: `${build.inflection.upperCamelCase(pgCodec.name)}RequestUploadUrlPayload`,
            fields: {
              uploadUrl: { type: GraphQLString, description: 'Presigned PUT URL (null if deduplicated)' },
              fileId: { type: new GraphQLNonNull(GraphQLString), description: 'The file ID' },
              key: { type: new GraphQLNonNull(GraphQLString), description: 'The S3 object key' },
              deduplicated: { type: new GraphQLNonNull(GraphQLBoolean), description: 'Whether this file was deduplicated' },
              expiresAt: { type: GraphQLString, description: 'Presigned URL expiry time (null if deduplicated)' },
              previousVersionId: { type: GraphQLString, description: 'ID of the previous version' },
            },
          });

          const BulkUploadFilePayloadType = new GraphQLObjectType({
            name: `${build.inflection.upperCamelCase(pgCodec.name)}BulkUploadFilePayload`,
            fields: {
              uploadUrl: { type: GraphQLString },
              fileId: { type: new GraphQLNonNull(GraphQLString) },
              key: { type: new GraphQLNonNull(GraphQLString) },
              deduplicated: { type: new GraphQLNonNull(GraphQLBoolean) },
              expiresAt: { type: GraphQLString },
              previousVersionId: { type: GraphQLString },
              index: { type: new GraphQLNonNull(GraphQLInt), description: 'Index in the input array' },
            },
          });

          const BulkUploadUrlsPayloadType = new GraphQLObjectType({
            name: `${build.inflection.upperCamelCase(pgCodec.name)}RequestBulkUploadUrlsPayload`,
            fields: {
              files: { type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(BulkUploadFilePayloadType))) },
            },
          });

          const BulkUploadFileInputType = new GraphQLInputObjectType({
            name: `${build.inflection.upperCamelCase(pgCodec.name)}BulkUploadFileInput`,
            fields: {
              contentHash: { type: new GraphQLNonNull(GraphQLString) },
              contentType: { type: new GraphQLNonNull(GraphQLString) },
              size: { type: new GraphQLNonNull(GraphQLInt) },
              filename: { type: GraphQLString },
              key: { type: GraphQLString },
            },
          });

          // Capture codec for closure
          const capturedCodec = pgCodec;

          return build.extend(
            fields,
            {
              requestUploadUrl: context.fieldWithHooks(
                { fieldName: 'requestUploadUrl' } as any,
                {
                  description: 'Request a presigned URL for uploading a file to this bucket.',
                  type: UploadUrlPayloadType,
                  args: {
                    contentHash: { type: new GraphQLNonNull(GraphQLString), description: 'SHA-256 content hash (hex-encoded, 64 chars)' },
                    contentType: { type: new GraphQLNonNull(GraphQLString), description: 'MIME type of the file' },
                    size: { type: new GraphQLNonNull(GraphQLInt), description: 'File size in bytes' },
                    filename: { type: GraphQLString, description: 'Original filename (optional)' },
                    key: { type: GraphQLString, description: 'Custom S3 key (only when bucket has allow_custom_keys=true)' },
                  },
                  plan($parent: any, fieldArgs: any) {
                    const $bucketId = $parent.get('id');
                    const $bucketKey = $parent.get('key');
                    const $bucketType = $parent.get('type');
                    const $bucketIsPublic = $parent.get('is_public');
                    const $bucketAllowCustomKeys = $parent.get('allow_custom_keys');
                    const $bucketAllowedMimeTypes = $parent.get('allowed_mime_types');
                    const $bucketMaxFileSize = $parent.get('max_file_size');
                    const $bucketOwnerId = capturedCodec.attributes.owner_id ? $parent.get('owner_id') : lambda(null, (): null => null);

                    const $contentHash = fieldArgs.getRaw('contentHash');
                    const $contentType = fieldArgs.getRaw('contentType');
                    const $size = fieldArgs.getRaw('size');
                    const $filename = fieldArgs.getRaw('filename');
                    const $customKey = fieldArgs.getRaw('key');

                    const $withPgClient = (grafastContext() as any).get('withPgClient');
                    const $pgSettings = (grafastContext() as any).get('pgSettings');

                    const $combined = object({
                      bucketId: $bucketId,
                      bucketKey: $bucketKey,
                      bucketType: $bucketType,
                      bucketIsPublic: $bucketIsPublic,
                      bucketAllowCustomKeys: $bucketAllowCustomKeys,
                      bucketAllowedMimeTypes: $bucketAllowedMimeTypes,
                      bucketMaxFileSize: $bucketMaxFileSize,
                      bucketOwnerId: $bucketOwnerId,
                      contentHash: $contentHash,
                      contentType: $contentType,
                      size: $size,
                      filename: $filename,
                      customKey: $customKey,
                      withPgClient: $withPgClient,
                      pgSettings: $pgSettings,
                    });

                    return lambda($combined, async (vals: any) => {
                      return vals.withPgClient(vals.pgSettings, async (pgClient: any) => {
                        return pgClient.withTransaction(async (txClient: any) => {
                          const databaseId = await resolveDatabaseId(txClient);
                          if (!databaseId) throw new Error('DATABASE_NOT_FOUND');

                          const allConfigs = await loadAllStorageModules(txClient, databaseId);
                          const storageConfig = resolveStorageConfigFromCodec(capturedCodec, allConfigs);
                          if (!storageConfig) throw new Error('STORAGE_MODULE_NOT_FOUND');

                          const bucket: BucketConfig = {
                            id: vals.bucketId,
                            key: vals.bucketKey,
                            type: vals.bucketType,
                            is_public: vals.bucketIsPublic,
                            owner_id: vals.bucketOwnerId,
                            allowed_mime_types: vals.bucketAllowedMimeTypes,
                            max_file_size: vals.bucketMaxFileSize,
                            allow_custom_keys: vals.bucketAllowCustomKeys ?? false,
                          };

                          const s3ForDb = resolveS3ForDatabase(options, storageConfig, databaseId);
                          await ensureS3BucketExists(options, s3ForDb.bucket, bucket, databaseId, storageConfig.allowedOrigins);

                          return processSingleFile(
                            options, txClient, storageConfig, databaseId, bucket, s3ForDb, {
                              contentHash: vals.contentHash,
                              contentType: vals.contentType,
                              size: vals.size,
                              filename: vals.filename,
                              key: vals.customKey,
                            },
                          );
                        });
                      });
                    });
                  },
                },
              ),
              requestBulkUploadUrls: context.fieldWithHooks(
                { fieldName: 'requestBulkUploadUrls' } as any,
                {
                  description: 'Request presigned URLs for uploading multiple files to this bucket.',
                  type: BulkUploadUrlsPayloadType,
                  args: {
                    files: {
                      type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(BulkUploadFileInputType))),
                      description: 'Array of files to upload',
                    },
                  },
                  plan($parent: any, fieldArgs: any) {
                    const $bucketId = $parent.get('id');
                    const $bucketKey = $parent.get('key');
                    const $bucketType = $parent.get('type');
                    const $bucketIsPublic = $parent.get('is_public');
                    const $bucketAllowCustomKeys = $parent.get('allow_custom_keys');
                    const $bucketAllowedMimeTypes = $parent.get('allowed_mime_types');
                    const $bucketMaxFileSize = $parent.get('max_file_size');
                    const $bucketOwnerId = capturedCodec.attributes.owner_id ? $parent.get('owner_id') : lambda(null, (): null => null);

                    const $files = fieldArgs.getRaw('files');
                    const $withPgClient = (grafastContext() as any).get('withPgClient');
                    const $pgSettings = (grafastContext() as any).get('pgSettings');

                    const $combined = object({
                      bucketId: $bucketId,
                      bucketKey: $bucketKey,
                      bucketType: $bucketType,
                      bucketIsPublic: $bucketIsPublic,
                      bucketAllowCustomKeys: $bucketAllowCustomKeys,
                      bucketAllowedMimeTypes: $bucketAllowedMimeTypes,
                      bucketMaxFileSize: $bucketMaxFileSize,
                      bucketOwnerId: $bucketOwnerId,
                      files: $files,
                      withPgClient: $withPgClient,
                      pgSettings: $pgSettings,
                    });

                    return lambda($combined, async (vals: any) => {
                      const { files } = vals;
                      if (!Array.isArray(files) || files.length === 0) {
                        throw new Error('INVALID_FILES: must provide at least one file');
                      }

                      return vals.withPgClient(vals.pgSettings, async (pgClient: any) => {
                        return pgClient.withTransaction(async (txClient: any) => {
                          const databaseId = await resolveDatabaseId(txClient);
                          if (!databaseId) throw new Error('DATABASE_NOT_FOUND');

                          const allConfigs = await loadAllStorageModules(txClient, databaseId);
                          const storageConfig = resolveStorageConfigFromCodec(capturedCodec, allConfigs);
                          if (!storageConfig) throw new Error('STORAGE_MODULE_NOT_FOUND');

                          if (files.length > storageConfig.maxBulkFiles) {
                            throw new Error(`BULK_LIMIT_EXCEEDED: max ${storageConfig.maxBulkFiles} files per batch`);
                          }
                          const totalSize = files.reduce((sum: number, f: any) => sum + (f.size || 0), 0);
                          if (totalSize > storageConfig.maxBulkTotalSize) {
                            throw new Error(`BULK_SIZE_EXCEEDED: total size ${totalSize} exceeds max ${storageConfig.maxBulkTotalSize} bytes`);
                          }

                          const bucket: BucketConfig = {
                            id: vals.bucketId,
                            key: vals.bucketKey,
                            type: vals.bucketType,
                            is_public: vals.bucketIsPublic,
                            owner_id: vals.bucketOwnerId,
                            allowed_mime_types: vals.bucketAllowedMimeTypes,
                            max_file_size: vals.bucketMaxFileSize,
                            allow_custom_keys: vals.bucketAllowCustomKeys ?? false,
                          };

                          const s3ForDb = resolveS3ForDatabase(options, storageConfig, databaseId);
                          await ensureS3BucketExists(options, s3ForDb.bucket, bucket, databaseId, storageConfig.allowedOrigins);

                          const results = [];
                          for (let i = 0; i < files.length; i++) {
                            const result = await processSingleFile(
                              options, txClient, storageConfig, databaseId, bucket, s3ForDb, files[i],
                            );
                            results.push({ ...result, index: i });
                          }

                          return { files: results };
                        });
                      });
                    });
                  },
                },
              ),
            },
            `PresignedUrlPlugin adding upload fields to ${pgCodec.name}`,
          );
        },

        /**
         * Wrap delete* mutations on @storageFiles-tagged tables with S3 cleanup.
         *
         * Pattern: identical to graphile-bucket-provisioner-plugin's create/update hooks.
         * 1. Read the file row BEFORE delete (need key + bucket_id for S3 cleanup)
         * 2. Call PostGraphile's generated delete (RLS enforced)
         * 3. If delete succeeded, check refcount and attempt sync S3 delete
         * 4. AFTER DELETE trigger (constructive-db) enqueues async GC job as fallback
         */
        GraphQLObjectType_fields_field(field: any, build: any, context: any) {
          const {
            scope: { isRootMutation, fieldName, pgCodec },
          } = context;

          if (!isRootMutation || !pgCodec || !pgCodec.attributes) {
            return field;
          }

          const tags = pgCodec.extensions?.tags;
          if (!tags?.storageFiles) {
            return field;
          }

          if (!fieldName.startsWith('delete')) {
            return field;
          }

          log.debug(`Wrapping delete mutation "${fieldName}" with S3 cleanup (codec: ${pgCodec.name})`);

          const defaultResolver = (obj: any) => obj[fieldName];
          const { resolve: oldResolve = defaultResolver, ...rest } = field;
          const capturedCodec = pgCodec;

          return {
            ...rest,
            async resolve(source: any, args: any, graphqlContext: any, info: any) {
              // Extract the file ID from the mutation input
              const inputKey = Object.keys(args.input || {}).find(
                (k) => k !== 'clientMutationId',
              );
              const fileInput = inputKey ? args.input[inputKey] : null;

              let fileRow: { key: string; bucket_id: string } | null = null;

              if (fileInput) {
                // Read the file row BEFORE delete to get the S3 key + bucket_id
                const withPgClient = graphqlContext.withPgClient;
                const pgSettings = graphqlContext.pgSettings;

                if (withPgClient) {
                  try {
                    await withPgClient(pgSettings, async (pgClient: any) => {
                      const databaseId = await resolveDatabaseId(pgClient);
                      if (!databaseId) return;

                      const allConfigs = await loadAllStorageModules(pgClient, databaseId);
                      const storageConfig = resolveStorageConfigFromCodec(capturedCodec, allConfigs);
                      if (!storageConfig) return;

                      // Read the file row (RLS enforced)
                      const result = await pgClient.query({
                        text: `SELECT key, bucket_id FROM ${storageConfig.filesQualifiedName} WHERE id = $1 LIMIT 1`,
                        values: [fileInput],
                      });
                      if (result.rows.length > 0) {
                        fileRow = result.rows[0] as { key: string; bucket_id: string };
                      }
                    });
                  } catch (err: any) {
                    log.warn(`Pre-delete file lookup failed: ${err.message}`);
                  }
                }
              }

              // Call PostGraphile's generated delete (RLS enforced)
              const result = await oldResolve(source, args, graphqlContext, info);

              // Attempt sync S3 cleanup if we have the file row
              if (fileRow) {
                const withPgClient = graphqlContext.withPgClient;
                const pgSettings = graphqlContext.pgSettings;

                if (withPgClient) {
                  try {
                    await withPgClient(pgSettings, async (pgClient: any) => {
                      const databaseId = await resolveDatabaseId(pgClient);
                      if (!databaseId) return;

                      const allConfigs = await loadAllStorageModules(pgClient, databaseId);
                      const storageConfig = resolveStorageConfigFromCodec(capturedCodec, allConfigs);
                      if (!storageConfig) return;

                      // Check refcount: any other file with the same key in this bucket?
                      const refResult = await pgClient.query({
                        text: `SELECT COUNT(*)::int AS ref_count FROM ${storageConfig.filesQualifiedName} WHERE key = $1 AND bucket_id = $2`,
                        values: [fileRow!.key, fileRow!.bucket_id],
                      });
                      const refCount = refResult.rows[0]?.ref_count ?? 0;

                      if (refCount > 0) {
                        log.info(`File deleted from DB; S3 key ${fileRow!.key} still referenced by ${refCount} file(s)`);
                        return;
                      }

                      // No other references — attempt sync S3 delete
                      const s3ForDb = resolveS3ForDatabase(options, storageConfig, databaseId);
                      await deleteS3Object(s3ForDb, fileRow!.key);
                      log.info(`Sync S3 delete succeeded for key=${fileRow!.key}`);
                    });
                  } catch (err: any) {
                    // Sync S3 delete failed — the AFTER DELETE trigger has enqueued an async GC job
                    log.warn(`Sync S3 delete failed for key=${fileRow.key}; async GC job will retry: ${err.message}`);
                  }
                }
              }

              return result;
            },
          };
        },
      },
    },
  };
}

// --- Shared upload logic ---

async function processSingleFile(
  options: PresignedUrlPluginOptions,
  txClient: any,
  storageConfig: StorageModuleConfig,
  databaseId: string,
  bucket: BucketConfig,
  s3ForDb: S3Config,
  input: any,
) {
  const { contentHash, contentType, size, filename, key: customKey } = input;

  if (!contentHash || typeof contentHash !== 'string' || contentHash.length > MAX_CONTENT_HASH_LENGTH) {
    throw new Error('INVALID_CONTENT_HASH');
  }
  if (!isValidSha256(contentHash)) {
    throw new Error('INVALID_CONTENT_HASH_FORMAT: must be a 64-char lowercase hex SHA-256');
  }
  if (!contentType || typeof contentType !== 'string' || contentType.length > MAX_CONTENT_TYPE_LENGTH) {
    throw new Error('INVALID_CONTENT_TYPE');
  }
  if (typeof size !== 'number' || size <= 0 || size > storageConfig.defaultMaxFileSize) {
    throw new Error(`INVALID_FILE_SIZE: must be between 1 and ${storageConfig.defaultMaxFileSize} bytes`);
  }
  if (filename !== undefined && filename !== null) {
    if (typeof filename !== 'string' || filename.length > storageConfig.maxFilenameLength) {
      throw new Error('INVALID_FILENAME');
    }
  }

  // Validate content type against bucket's allowed_mime_types
  if (bucket.allowed_mime_types && bucket.allowed_mime_types.length > 0) {
    const allowed = bucket.allowed_mime_types as string[];
    const isAllowed = allowed.some((pattern: string) => {
      if (pattern === '*/*') return true;
      if (pattern.endsWith('/*')) {
        const prefix = pattern.slice(0, -1);
        return contentType.startsWith(prefix);
      }
      return contentType === pattern;
    });
    if (!isAllowed) {
      throw new Error(`CONTENT_TYPE_NOT_ALLOWED: ${contentType} not in bucket allowed types`);
    }
  }

  // Validate size against bucket's max_file_size
  if (bucket.max_file_size && size > bucket.max_file_size) {
    throw new Error(`FILE_TOO_LARGE: exceeds bucket max of ${bucket.max_file_size} bytes`);
  }

  // Determine S3 key
  let s3Key: string;
  let isCustomKey = false;
  if (customKey) {
    if (!bucket.allow_custom_keys) {
      throw new Error('CUSTOM_KEY_NOT_ALLOWED: bucket does not allow custom keys');
    }
    const keyError = validateCustomKey(customKey);
    if (keyError) {
      throw new Error(keyError);
    }
    s3Key = customKey;
    isCustomKey = true;
  } else {
    s3Key = buildS3Key(contentHash);
  }

  // Dedup / versioning check
  let previousVersionId: string | null = null;

  if (isCustomKey) {
    const existingResult = await txClient.query({
      text: `SELECT id, content_hash
       FROM ${storageConfig.filesQualifiedName}
       WHERE key = $1
         AND bucket_id = $2
       ORDER BY created_at DESC
       LIMIT 1`,
      values: [s3Key, bucket.id],
    });

    if (existingResult.rows.length > 0) {
      const existing = existingResult.rows[0];
      if (existing.content_hash === contentHash) {
        log.info(`Dedup hit (custom key): file ${existing.id} for key ${s3Key}`);
        return {
          uploadUrl: null as string | null,
          fileId: existing.id as string,
          key: s3Key,
          deduplicated: true,
          expiresAt: null as string | null,
          previousVersionId: null as string | null,
        };
      }
      previousVersionId = existing.id;
      log.info(`Versioning: new version of key ${s3Key}, previous=${previousVersionId}`);
    }
  } else {
    const dedupResult = await txClient.query({
      text: `SELECT id
       FROM ${storageConfig.filesQualifiedName}
       WHERE content_hash = $1
         AND bucket_id = $2
       LIMIT 1`,
      values: [contentHash, bucket.id],
    });

    if (dedupResult.rows.length > 0) {
      const existingFile = dedupResult.rows[0];
      log.info(`Dedup hit: file ${existingFile.id} for hash ${contentHash}`);

      return {
        uploadUrl: null as string | null,
        fileId: existingFile.id as string,
        key: s3Key,
        deduplicated: true,
        expiresAt: null as string | null,
        previousVersionId: null as string | null,
      };
    }
  }

  // Auto-derive ltree path from custom key directory (only when has_path_shares)
  const derivedPath = isCustomKey && storageConfig.hasPathShares ? derivePathFromKey(s3Key) : null;

  // Create file record
  const hasOwnerColumn = storageConfig.membershipType !== null;
  const columns = ['bucket_id', 'key', 'content_hash', 'mime_type', 'size', 'filename', 'is_public'];
  const values: any[] = [bucket.id, s3Key, contentHash, contentType, size, filename || null, bucket.is_public];

  if (hasOwnerColumn) {
    columns.push('owner_id');
    values.push(bucket.owner_id);
  }
  if (previousVersionId) {
    columns.push('previous_version_id');
    values.push(previousVersionId);
  }
  if (derivedPath) {
    columns.push('path');
    values.push(derivedPath);
  }

  const placeholders = values.map((_: any, i: number) => `$${i + 1}`).join(', ');
  const fileResult = await txClient.query({
    text: `INSERT INTO ${storageConfig.filesQualifiedName}
           (${columns.join(', ')})
           VALUES (${placeholders})
           RETURNING id`,
    values,
  });

  const fileId = fileResult.rows[0].id;

  // Generate presigned PUT URL
  const uploadUrl = await generatePresignedPutUrl(
    s3ForDb,
    s3Key,
    contentType,
    size,
    storageConfig.uploadUrlExpirySeconds,
  );

  const expiresAt = new Date(Date.now() + storageConfig.uploadUrlExpirySeconds * 1000).toISOString();

  return {
    uploadUrl,
    fileId,
    key: s3Key,
    deduplicated: false,
    expiresAt,
    previousVersionId,
  };
}

export const PresignedUrlPlugin = createPresignedUrlPlugin;
export default PresignedUrlPlugin;
