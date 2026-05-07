/**
 * Upload Integration Tests — end-to-end presigned URL flow
 *
 * Exercises the per-table upload pipeline:
 *   query bucket → requestUploadUrl field → PUT to presigned URL → downloadUrl
 *
 * Uses real MinIO (available in CI as minio_cdn service) and lazy bucket
 * provisioning. No RLS — that will be tested in constructive-db.
 *
 * Run tests:
 *   pnpm test -- --testPathPattern=upload.integration
 */

import crypto from 'crypto';
import path from 'path';
import { getConnections, seed } from '../src';
import type supertest from 'supertest';

jest.setTimeout(60000);

const seedRoot = path.join(__dirname, '..', '__fixtures__', 'seed');
const sql = (seedDir: string, file: string) =>
  path.join(seedRoot, seedDir, file);

const servicesDatabaseId = '80a2eaaf-f77e-4bfe-8506-df929ef1b8d9';
const metaSchemas = [
  'services_public',
  'metaschema_public',
  'metaschema_modules_public',
];
const schemas = ['simple-storage-public'];

const seedFiles = [
  // Reuse the shared metaschema / services infrastructure
  sql('simple-seed-services', 'setup.sql'),
  // Storage-specific additions (jwt_private + storage_module table)
  sql('simple-seed-storage', 'setup.sql'),
  sql('simple-seed-storage', 'schema.sql'),
  sql('simple-seed-storage', 'test-data.sql'),
];

// --- GraphQL operations ---

const REQUEST_UPLOAD_URL = `
  query RequestUploadUrl($key: String!, $contentHash: String!, $contentType: String!, $size: Int!, $filename: String) {
    buckets(where: { key: { equalTo: $key } }) {
      nodes {
        id
        requestUploadUrl(
          contentHash: $contentHash
          contentType: $contentType
          size: $size
          filename: $filename
        ) {
          uploadUrl
          fileId
          key
          deduplicated
          expiresAt
        }
      }
    }
  }
`;

// --- Helpers ---

function sha256(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

async function putToPresignedUrl(
  url: string,
  content: string,
  contentType: string,
): Promise<Response> {
  return fetch(url, {
    method: 'PUT',
    headers: {
      'Content-Type': contentType,
      'Content-Length': Buffer.byteLength(content).toString(),
    },
    body: content,
  });
}

// --- Tests ---

describe('Upload integration (per-table presigned URL flow)', () => {
  let request: supertest.Agent;
  let teardown: () => Promise<void>;

  const postGraphQL = (payload: {
    query: string;
    variables?: Record<string, unknown>;
  }) => {
    return request
      .post('/graphql')
      .set('X-Database-Id', servicesDatabaseId)
      .set('X-Schemata', schemas.join(','))
      .send(payload);
  };

  beforeAll(async () => {
    ({ request, teardown } = await getConnections(
      {
        schemas,
        authRole: 'anonymous',
        server: {
          api: {
            enableServicesApi: true,
            isPublic: false,
            metaSchemas,
          },
        },
      },
      [seed.sqlfile(seedFiles)],
    ));
  });

  afterAll(async () => {
    if (teardown) await teardown();
  });

  describe('Public file upload via bucket field', () => {
    const fileContent = 'Hello, public world!';
    const contentType = 'text/plain';
    const contentHash = sha256(fileContent);
    let uploadUrl: string;
    let fileId: string;

    it('should return a presigned PUT URL via bucket.requestUploadUrl', async () => {
      const res = await postGraphQL({
        query: REQUEST_UPLOAD_URL,
        variables: {
          key: 'public',
          contentHash,
          contentType,
          size: Buffer.byteLength(fileContent),
          filename: 'hello-public.txt',
        },
      });

      expect(res.status).toBe(200);
      expect(res.body.errors).toBeUndefined();

      const bucket = res.body.data.buckets.nodes[0];
      expect(bucket).toBeTruthy();
      expect(bucket.id).toBeTruthy();

      const payload = bucket.requestUploadUrl;
      expect(payload.uploadUrl).toBeTruthy();
      expect(payload.fileId).toBeTruthy();
      expect(payload.key).toBe(contentHash);
      expect(payload.deduplicated).toBe(false);
      expect(payload.expiresAt).toBeTruthy();

      uploadUrl = payload.uploadUrl;
      fileId = payload.fileId;
    });

    it('should accept a PUT to the presigned URL', async () => {
      const putRes = await putToPresignedUrl(uploadUrl, fileContent, contentType);
      expect(putRes.ok).toBe(true);
    });
  });

  describe('Private file upload via bucket field', () => {
    const fileContent = 'Hello, private world!';
    const contentType = 'text/plain';
    const contentHash = sha256(fileContent);
    let uploadUrl: string;
    let fileId: string;

    it('should return a presigned PUT URL via bucket.requestUploadUrl', async () => {
      const res = await postGraphQL({
        query: REQUEST_UPLOAD_URL,
        variables: {
          key: 'private',
          contentHash,
          contentType,
          size: Buffer.byteLength(fileContent),
          filename: 'hello-private.txt',
        },
      });

      expect(res.status).toBe(200);
      expect(res.body.errors).toBeUndefined();

      const bucket = res.body.data.buckets.nodes[0];
      expect(bucket).toBeTruthy();

      const payload = bucket.requestUploadUrl;
      expect(payload.uploadUrl).toBeTruthy();
      expect(payload.fileId).toBeTruthy();
      expect(payload.key).toBe(contentHash);
      expect(payload.deduplicated).toBe(false);
      expect(payload.expiresAt).toBeTruthy();

      uploadUrl = payload.uploadUrl;
      fileId = payload.fileId;
    });

    it('should accept a PUT to the presigned URL', async () => {
      const putRes = await putToPresignedUrl(uploadUrl, fileContent, contentType);
      expect(putRes.ok).toBe(true);
    });
  });

  describe('Deduplication', () => {
    it('should return deduplicated=true for a file with an existing content hash', async () => {
      const fileContent = 'Hello, public world!';
      const contentHash = sha256(fileContent);

      const res = await postGraphQL({
        query: REQUEST_UPLOAD_URL,
        variables: {
          key: 'public',
          contentHash,
          contentType: 'text/plain',
          size: Buffer.byteLength(fileContent),
          filename: 'hello-public-copy.txt',
        },
      });

      expect(res.status).toBe(200);
      expect(res.body.errors).toBeUndefined();

      const payload = res.body.data.buckets.nodes[0].requestUploadUrl;
      expect(payload.deduplicated).toBe(true);
      expect(payload.uploadUrl).toBeNull();
      expect(payload.expiresAt).toBeNull();
      expect(payload.fileId).toBeTruthy();
    });
  });
});
