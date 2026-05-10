/**
 * Upload Integration Tests — end-to-end presigned URL flow
 *
 * Exercises the file-centric upload pipeline:
 *   uploadAppFile mutation → presigned PUT URL → PUT to S3
 *
 * Uses real MinIO (available in CI as minio_cdn service) and lazy bucket
 * provisioning.
 *
 * Includes Alice/Bob tenant isolation tests:
 *   - Feature flag gating via database_settings / api_settings cascade
 *   - Tenant isolation (Alice cannot see Bob's files, Bob cannot see Alice's)
 *   - RLS enforcement (anonymous can only see public-bucket files in Bob's schema)
 *
 * Run tests:
 *   pnpm test -- --testPathPattern=upload.integration
 */

import crypto from 'crypto';
import path from 'path';
import { getConnections, seed } from '../src';
import type supertest from 'supertest';

jest.setTimeout(120000);

const seedRoot = path.join(__dirname, '..', '__fixtures__', 'seed');
const sql = (seedDir: string, file: string) =>
  path.join(seedRoot, seedDir, file);

// Alice's tenant (existing)
const aliceDatabaseId = '80a2eaaf-f77e-4bfe-8506-df929ef1b8d9';
const aliceSchemas = ['simple-storage-public'];

// Bob's tenant (new)
const bobDatabaseId = 'a1a1a1a1-b2b2-4c3c-d4d4-e5e5e5e5e5e5';
const bobSchemas = ['bob-storage-public'];

const metaSchemas = [
  'services_public',
  'metaschema_public',
  'metaschema_modules_public',
];

const seedFiles = [
  // Reuse the shared metaschema / services infrastructure
  sql('simple-seed-services', 'setup.sql'),
  // Storage-specific additions (jwt_private + storage_module table)
  sql('simple-seed-storage', 'setup.sql'),
  sql('simple-seed-storage', 'schema.sql'),
  sql('simple-seed-storage', 'test-data.sql'),
];

// --- GraphQL operations ---

const UPLOAD_APP_FILE = `
  mutation UploadAppFile($input: UploadAppFileInput!) {
    uploadAppFile(input: $input) {
      uploadUrl
      fileId
      key
      deduplicated
      expiresAt
    }
  }
`;

const APP_FILES = `
  query AppFiles {
    appFiles {
      nodes {
        id
        key
        filename
        mimeType
        isPublic
        bucketId
      }
    }
  }
`;

const INTROSPECT_UPLOAD_MUTATION = `
  query IntrospectUpload {
    __type(name: "Mutation") {
      fields {
        name
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

describe('Upload integration (file-centric upload mutations)', () => {
  let request: supertest.Agent;
  let teardown: () => Promise<void>;

  /**
   * Posts a GraphQL query using X-Schemata header (admin structure, no
   * database_settings resolution — used by original upload tests).
   */
  const postGraphQL = (payload: {
    query: string;
    variables?: Record<string, unknown>;
  }) => {
    return request
      .post('/graphql')
      .set('X-Database-Id', aliceDatabaseId)
      .set('X-Schemata', aliceSchemas.join(','))
      .send(payload);
  };

  /**
   * Posts a GraphQL query using X-Api-Name header, which triggers
   * api-name resolution and loads database_settings + api_settings.
   */
  const postGraphQLViaApi = (
    databaseId: string,
    apiName: string,
    payload: {
      query: string;
      variables?: Record<string, unknown>;
    },
  ) => {
    return request
      .post('/graphql')
      .set('X-Database-Id', databaseId)
      .set('X-Api-Name', apiName)
      .send(payload);
  };

  beforeAll(async () => {
    ({ request, teardown } = await getConnections(
      {
        schemas: [...aliceSchemas, ...bobSchemas],
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

  // ==========================================================================
  // Original upload tests (Alice's tenant, schemata-header mode)
  // ==========================================================================

  describe('Public file upload via uploadAppFile mutation', () => {
    const fileContent = 'Hello, public world!';
    const contentType = 'text/plain';
    const contentHash = sha256(fileContent);
    let uploadUrl: string;

    it('should return a presigned PUT URL via uploadAppFile', async () => {
      const res = await postGraphQL({
        query: UPLOAD_APP_FILE,
        variables: {
          input: {
            bucketKey: 'public',
            contentHash,
            contentType,
            size: Buffer.byteLength(fileContent),
            filename: 'hello-public.txt',
          },
        },
      });

      expect(res.status).toBe(200);
      expect(res.body.errors).toBeUndefined();

      const payload = res.body.data.uploadAppFile;
      expect(payload.uploadUrl).toBeTruthy();
      expect(payload.fileId).toBeTruthy();
      expect(payload.key).toBe(contentHash);
      expect(payload.deduplicated).toBe(false);
      expect(payload.expiresAt).toBeTruthy();

      uploadUrl = payload.uploadUrl;
    });

    it('should accept a PUT to the presigned URL', async () => {
      const putRes = await putToPresignedUrl(uploadUrl, fileContent, contentType);
      expect(putRes.ok).toBe(true);
    });
  });

  describe('Private file upload via uploadAppFile mutation', () => {
    const fileContent = 'Hello, private world!';
    const contentType = 'text/plain';
    const contentHash = sha256(fileContent);
    let uploadUrl: string;

    it('should return a presigned PUT URL via uploadAppFile', async () => {
      const res = await postGraphQL({
        query: UPLOAD_APP_FILE,
        variables: {
          input: {
            bucketKey: 'private',
            contentHash,
            contentType,
            size: Buffer.byteLength(fileContent),
            filename: 'hello-private.txt',
          },
        },
      });

      expect(res.status).toBe(200);
      expect(res.body.errors).toBeUndefined();

      const payload = res.body.data.uploadAppFile;
      expect(payload.uploadUrl).toBeTruthy();
      expect(payload.fileId).toBeTruthy();
      expect(payload.key).toBe(contentHash);
      expect(payload.deduplicated).toBe(false);
      expect(payload.expiresAt).toBeTruthy();

      uploadUrl = payload.uploadUrl;
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
        query: UPLOAD_APP_FILE,
        variables: {
          input: {
            bucketKey: 'public',
            contentHash,
            contentType: 'text/plain',
            size: Buffer.byteLength(fileContent),
            filename: 'hello-public-copy.txt',
          },
        },
      });

      expect(res.status).toBe(200);
      expect(res.body.errors).toBeUndefined();

      const payload = res.body.data.uploadAppFile;
      expect(payload.deduplicated).toBe(true);
      expect(payload.uploadUrl).toBeNull();
      expect(payload.expiresAt).toBeNull();
      expect(payload.fileId).toBeTruthy();
    });
  });

  // ==========================================================================
  // Alice/Bob tenant isolation and feature flag tests
  // Uses X-Api-Name resolution which loads database_settings + api_settings
  // ==========================================================================

  describe('Feature flag gating via database_settings / api_settings', () => {
    it('should expose uploadAppFile mutation when presigned uploads are enabled (Alice)', async () => {
      const res = await postGraphQLViaApi(aliceDatabaseId, 'app', {
        query: INTROSPECT_UPLOAD_MUTATION,
      });

      expect(res.status).toBe(200);
      expect(res.body.errors).toBeUndefined();

      const mutationFields: { name: string }[] =
        res.body.data.__type?.fields ?? [];
      const fieldNames = mutationFields.map((f) => f.name);
      expect(fieldNames).toContain('uploadAppFile');
    });

    it('should expose uploadAppFile mutation on Bob primary API (presigned uploads enabled by default)', async () => {
      const res = await postGraphQLViaApi(bobDatabaseId, 'bob-app', {
        query: INTROSPECT_UPLOAD_MUTATION,
      });

      expect(res.status).toBe(200);
      expect(res.body.errors).toBeUndefined();

      const mutationFields: { name: string }[] =
        res.body.data.__type?.fields ?? [];
      const fieldNames = mutationFields.map((f) => f.name);
      expect(fieldNames).toContain('uploadAppFile');
    });

    it('should NOT expose uploadAppFile on Bob restricted API (api_settings disables presigned uploads)', async () => {
      const res = await postGraphQLViaApi(bobDatabaseId, 'bob-restricted', {
        query: INTROSPECT_UPLOAD_MUTATION,
      });

      expect(res.status).toBe(200);
      expect(res.body.errors).toBeUndefined();

      const mutationFields: { name: string }[] =
        res.body.data.__type?.fields ?? [];
      const fieldNames = mutationFields.map((f) => f.name);
      expect(fieldNames).not.toContain('uploadAppFile');
    });
  });

  describe('Tenant isolation — Alice and Bob cannot see each other\'s files', () => {
    it('should allow Bob to upload a file via his primary API', async () => {
      const fileContent = 'Bob secret data';
      const contentHash = sha256(fileContent);

      const res = await postGraphQLViaApi(bobDatabaseId, 'bob-app', {
        query: UPLOAD_APP_FILE,
        variables: {
          input: {
            bucketKey: 'public',
            contentHash,
            contentType: 'text/plain',
            size: Buffer.byteLength(fileContent),
            filename: 'bob-file.txt',
          },
        },
      });

      expect(res.status).toBe(200);
      expect(res.body.errors).toBeUndefined();

      const payload = res.body.data.uploadAppFile;
      expect(payload.fileId).toBeTruthy();
      expect(payload.uploadUrl).toBeTruthy();

      const putRes = await putToPresignedUrl(
        payload.uploadUrl,
        fileContent,
        'text/plain',
      );
      expect(putRes.ok).toBe(true);
    });

    it('should show Bob his own files via his API', async () => {
      const res = await postGraphQLViaApi(bobDatabaseId, 'bob-app', {
        query: APP_FILES,
      });

      expect(res.status).toBe(200);
      expect(res.body.errors).toBeUndefined();

      const files = res.body.data.appFiles.nodes;
      expect(files.length).toBeGreaterThanOrEqual(1);
      expect(files.some((f: { filename: string }) => f.filename === 'bob-file.txt')).toBe(true);
    });

    it('should NOT show Bob\'s files when querying via Alice\'s API', async () => {
      const res = await postGraphQLViaApi(aliceDatabaseId, 'app', {
        query: APP_FILES,
      });

      expect(res.status).toBe(200);
      expect(res.body.errors).toBeUndefined();

      const files = res.body.data.appFiles.nodes;
      const bobFiles = files.filter(
        (f: { filename: string }) => f.filename === 'bob-file.txt',
      );
      expect(bobFiles).toHaveLength(0);
    });

    it('should NOT show Alice\'s files when querying via Bob\'s API', async () => {
      const res = await postGraphQLViaApi(bobDatabaseId, 'bob-app', {
        query: APP_FILES,
      });

      expect(res.status).toBe(200);
      expect(res.body.errors).toBeUndefined();

      const files = res.body.data.appFiles.nodes;
      const aliceFiles = files.filter(
        (f: { filename: string }) =>
          f.filename === 'hello-public.txt' || f.filename === 'hello-private.txt',
      );
      expect(aliceFiles).toHaveLength(0);
    });
  });

  describe('RLS enforcement on Bob\'s schema', () => {
    it('should only return public-bucket files for anonymous role (RLS)', async () => {
      const res = await postGraphQLViaApi(bobDatabaseId, 'bob-app', {
        query: APP_FILES,
      });

      expect(res.status).toBe(200);
      expect(res.body.errors).toBeUndefined();

      const files: { filename: string; bucketId: string }[] =
        res.body.data.appFiles.nodes;

      const publicBucketId = 'd2d2d2d2-0000-0000-0000-000000000001';
      const privateBucketId = 'd2d2d2d2-0000-0000-0000-000000000002';

      const publicFiles = files.filter((f) => f.bucketId === publicBucketId);
      const privateFiles = files.filter((f) => f.bucketId === privateBucketId);

      expect(publicFiles.length).toBeGreaterThanOrEqual(1);
      expect(privateFiles).toHaveLength(0);
    });
  });
});

