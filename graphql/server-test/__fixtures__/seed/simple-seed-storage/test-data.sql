-- Test data for simple-seed-storage scenario
-- Seeds metaschema, services, storage_module, and bucket data

SET session_replication_role TO replica;

-- =====================================================
-- METASCHEMA DATA
-- =====================================================

-- Database entry (ID matches servicesDatabaseId in test file)
INSERT INTO metaschema_public.database (id, owner_id, name, hash)
VALUES (
  '80a2eaaf-f77e-4bfe-8506-df929ef1b8d9',
  NULL,
  'simple-storage',
  '425a0f10-0170-5760-85df-2a980c378224'
) ON CONFLICT (id) DO NOTHING;

-- Schema entries
INSERT INTO metaschema_public.schema (id, database_id, name, schema_name, description, is_public)
VALUES
  ('6dbae92a-5450-401b-1ed5-d69e7754940d', '80a2eaaf-f77e-4bfe-8506-df929ef1b8d9', 'public', 'simple-storage-public', NULL, true)
ON CONFLICT (id) DO NOTHING;

-- Table entries for storage tables
-- buckets
INSERT INTO metaschema_public.table (id, database_id, schema_id, name, description)
VALUES (
  'b0000001-0000-0000-0000-000000000001',
  '80a2eaaf-f77e-4bfe-8506-df929ef1b8d9',
  '6dbae92a-5450-401b-1ed5-d69e7754940d',
  'app_buckets',
  NULL
) ON CONFLICT (id) DO NOTHING;

-- files
INSERT INTO metaschema_public.table (id, database_id, schema_id, name, description)
VALUES (
  'b0000001-0000-0000-0000-000000000002',
  '80a2eaaf-f77e-4bfe-8506-df929ef1b8d9',
  '6dbae92a-5450-401b-1ed5-d69e7754940d',
  'app_files',
  NULL
) ON CONFLICT (id) DO NOTHING;

-- =====================================================
-- SERVICES DATA
-- =====================================================

INSERT INTO services_public.apis (id, database_id, name, dbname, is_public, role_name, anon_role)
VALUES
  ('6c9997a4-591b-4cb3-9313-4ef45d6f134e', '80a2eaaf-f77e-4bfe-8506-df929ef1b8d9', 'app', current_database(), false, 'authenticated', 'anonymous')
ON CONFLICT (id) DO NOTHING;

INSERT INTO services_public.api_schemas (id, database_id, schema_id, api_id)
VALUES
  ('71181146-890e-4991-9da7-3dddf87d9e01', '80a2eaaf-f77e-4bfe-8506-df929ef1b8d9', '6dbae92a-5450-401b-1ed5-d69e7754940d', '6c9997a4-591b-4cb3-9313-4ef45d6f134e')
ON CONFLICT (id) DO NOTHING;

-- =====================================================
-- STORAGE MODULE CONFIG
-- =====================================================

INSERT INTO metaschema_modules_public.storage_module (
  id,
  database_id,
  schema_id,
  buckets_table_id,
  files_table_id,
  endpoint,
  public_url_prefix,
  provider,
  allowed_origins
)
VALUES (
  'c0000001-0000-0000-0000-000000000001',
  '80a2eaaf-f77e-4bfe-8506-df929ef1b8d9',
  '6dbae92a-5450-401b-1ed5-d69e7754940d',
  'b0000001-0000-0000-0000-000000000001',
  'b0000001-0000-0000-0000-000000000002',
  NULL,  -- use global CDN_ENDPOINT
  NULL,  -- use global CDN_PUBLIC_URL_PREFIX
  'minio',
  ARRAY['*']
) ON CONFLICT (id) DO NOTHING;

-- =====================================================
-- ALICE BUCKET SEED DATA
-- =====================================================

INSERT INTO "simple-storage-public".app_buckets (id, key, type, is_public)
VALUES
  ('d0000001-0000-0000-0000-000000000001', 'public', 'public', true),
  ('d0000001-0000-0000-0000-000000000002', 'private', 'private', false)
ON CONFLICT (id) DO NOTHING;

-- =====================================================
-- ALICE DATABASE SETTINGS (all defaults — presigned uploads enabled)
-- =====================================================

INSERT INTO services_public.database_settings (id, database_id)
VALUES (
  'e0000001-0000-0000-0000-000000000001',
  '80a2eaaf-f77e-4bfe-8506-df929ef1b8d9'
) ON CONFLICT (database_id) DO NOTHING;

-- =====================================================
-- BOB METASCHEMA DATA
-- =====================================================

INSERT INTO metaschema_public.database (id, owner_id, name, hash)
VALUES (
  'a1a1a1a1-b2b2-4c3c-d4d4-e5e5e5e5e5e5',
  NULL,
  'bob-storage',
  '525b1f21-1271-6861-96ef-3b091d482335'
) ON CONFLICT (id) DO NOTHING;

INSERT INTO metaschema_public.schema (id, database_id, name, schema_name, description, is_public)
VALUES
  ('a2a2a2a2-b3b3-4c4c-d5d5-e6e6e6e6e6e6', 'a1a1a1a1-b2b2-4c3c-d4d4-e5e5e5e5e5e5', 'public', 'bob-storage-public', NULL, true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO metaschema_public.table (id, database_id, schema_id, name, description)
VALUES
  ('b1b1b1b1-0000-0000-0000-000000000001', 'a1a1a1a1-b2b2-4c3c-d4d4-e5e5e5e5e5e5', 'a2a2a2a2-b3b3-4c4c-d5d5-e6e6e6e6e6e6', 'app_buckets', NULL),
  ('b1b1b1b1-0000-0000-0000-000000000002', 'a1a1a1a1-b2b2-4c3c-d4d4-e5e5e5e5e5e5', 'a2a2a2a2-b3b3-4c4c-d5d5-e6e6e6e6e6e6', 'app_files', NULL)
ON CONFLICT (id) DO NOTHING;

-- =====================================================
-- BOB SERVICES DATA
-- =====================================================

-- Bob's primary API (presigned uploads enabled via database_settings defaults)
INSERT INTO services_public.apis (id, database_id, name, dbname, is_public, role_name, anon_role)
VALUES
  ('a3a3a3a3-b4b4-4c5c-d6d6-e7e7e7e7e7e7', 'a1a1a1a1-b2b2-4c3c-d4d4-e5e5e5e5e5e5', 'bob-app', current_database(), false, 'authenticated', 'anonymous')
ON CONFLICT (id) DO NOTHING;

-- Bob's restricted API (api_settings will disable presigned uploads)
INSERT INTO services_public.apis (id, database_id, name, dbname, is_public, role_name, anon_role)
VALUES
  ('a4a4a4a4-b5b5-4c6c-d7d7-e8e8e8e8e8e8', 'a1a1a1a1-b2b2-4c3c-d4d4-e5e5e5e5e5e5', 'bob-restricted', current_database(), false, 'authenticated', 'anonymous')
ON CONFLICT (id) DO NOTHING;

INSERT INTO services_public.api_schemas (id, database_id, schema_id, api_id)
VALUES
  ('a5a5a5a5-0000-0000-0000-000000000001', 'a1a1a1a1-b2b2-4c3c-d4d4-e5e5e5e5e5e5', 'a2a2a2a2-b3b3-4c4c-d5d5-e6e6e6e6e6e6', 'a3a3a3a3-b4b4-4c5c-d6d6-e7e7e7e7e7e7'),
  ('a5a5a5a5-0000-0000-0000-000000000002', 'a1a1a1a1-b2b2-4c3c-d4d4-e5e5e5e5e5e5', 'a2a2a2a2-b3b3-4c4c-d5d5-e6e6e6e6e6e6', 'a4a4a4a4-b5b5-4c6c-d7d7-e8e8e8e8e8e8')
ON CONFLICT (id) DO NOTHING;

-- =====================================================
-- BOB STORAGE MODULE CONFIG
-- =====================================================

INSERT INTO metaschema_modules_public.storage_module (
  id,
  database_id,
  schema_id,
  buckets_table_id,
  files_table_id,
  endpoint,
  public_url_prefix,
  provider,
  allowed_origins
)
VALUES (
  'c1c1c1c1-0000-0000-0000-000000000001',
  'a1a1a1a1-b2b2-4c3c-d4d4-e5e5e5e5e5e5',
  'a2a2a2a2-b3b3-4c4c-d5d5-e6e6e6e6e6e6',
  'b1b1b1b1-0000-0000-0000-000000000001',
  'b1b1b1b1-0000-0000-0000-000000000002',
  NULL,
  NULL,
  'minio',
  ARRAY['*']
) ON CONFLICT (id) DO NOTHING;

-- =====================================================
-- BOB BUCKET SEED DATA
-- =====================================================

INSERT INTO "bob-storage-public".app_buckets (id, key, type, is_public)
VALUES
  ('d2d2d2d2-0000-0000-0000-000000000001', 'public', 'public', true),
  ('d2d2d2d2-0000-0000-0000-000000000002', 'private', 'private', false)
ON CONFLICT (id) DO NOTHING;

-- Pre-seed a file in Bob's private bucket for RLS testing
INSERT INTO "bob-storage-public".app_files (id, bucket_id, key, content_hash, mime_type, size, filename, is_public)
VALUES (
  'd3d3d3d3-0000-0000-0000-000000000001',
  'd2d2d2d2-0000-0000-0000-000000000002',
  'seeded-private-hash',
  'seeded-private-hash',
  'text/plain',
  42,
  'bob-seeded-private.txt',
  false
) ON CONFLICT (id) DO NOTHING;

-- =====================================================
-- BOB DATABASE SETTINGS (all defaults — presigned uploads enabled)
-- =====================================================

INSERT INTO services_public.database_settings (id, database_id)
VALUES (
  'e0000001-0000-0000-0000-000000000002',
  'a1a1a1a1-b2b2-4c3c-d4d4-e5e5e5e5e5e5'
) ON CONFLICT (database_id) DO NOTHING;

-- =====================================================
-- BOB API SETTINGS (restricted API disables presigned uploads)
-- =====================================================

INSERT INTO services_public.api_settings (id, database_id, api_id, enable_presigned_uploads)
VALUES (
  'f0000001-0000-0000-0000-000000000001',
  'a1a1a1a1-b2b2-4c3c-d4d4-e5e5e5e5e5e5',
  'a4a4a4a4-b5b5-4c6c-d7d7-e8e8e8e8e8e8',
  false
) ON CONFLICT (api_id) DO NOTHING;

SET session_replication_role TO DEFAULT;
