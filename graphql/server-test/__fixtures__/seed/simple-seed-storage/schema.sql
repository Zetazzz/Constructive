-- Schema creation for simple-seed-storage test scenario
-- Creates the app schema with storage tables (buckets, files)

-- Create app schemas
CREATE SCHEMA IF NOT EXISTS "simple-storage-public";

-- Grant schema usage
GRANT USAGE ON SCHEMA "simple-storage-public" TO administrator, authenticated, anonymous;

-- Set default privileges
ALTER DEFAULT PRIVILEGES IN SCHEMA "simple-storage-public"
  GRANT ALL ON TABLES TO administrator;
ALTER DEFAULT PRIVILEGES IN SCHEMA "simple-storage-public"
  GRANT USAGE ON SEQUENCES TO administrator, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA "simple-storage-public"
  GRANT ALL ON FUNCTIONS TO administrator, authenticated, anonymous;

-- =====================================================
-- STORAGE TABLES (mirroring what the storage module generator creates)
-- =====================================================

-- Buckets table
CREATE TABLE IF NOT EXISTS "simple-storage-public".app_buckets (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  key text NOT NULL,
  type text NOT NULL DEFAULT 'private',
  is_public boolean NOT NULL DEFAULT false,
  allowed_mime_types text[] NULL,
  max_file_size bigint NULL,
  allow_custom_keys boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (key)
);

COMMENT ON TABLE "simple-storage-public".app_buckets IS E'@storageBuckets\nStorage buckets table';

-- Files table
CREATE TABLE IF NOT EXISTS "simple-storage-public".app_files (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  bucket_id uuid NOT NULL REFERENCES "simple-storage-public".app_buckets(id),
  key text NOT NULL,
  content_hash text NOT NULL,
  mime_type text NOT NULL,
  size bigint,
  filename text,
  owner_id uuid,
  is_public boolean NOT NULL DEFAULT false,
  previous_version_id uuid REFERENCES "simple-storage-public".app_files(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (bucket_id, key)
);

COMMENT ON TABLE "simple-storage-public".app_files IS E'@storageFiles\nStorage files table';

-- Grant table permissions (allow anonymous to do CRUD for tests — no RLS)
GRANT SELECT, INSERT, UPDATE, DELETE ON "simple-storage-public".app_buckets TO administrator, authenticated, anonymous;
GRANT SELECT, INSERT, UPDATE, DELETE ON "simple-storage-public".app_files TO administrator, authenticated, anonymous;

-- =====================================================
-- BOB'S STORAGE SCHEMA (separate tenant with RLS)
-- =====================================================

CREATE SCHEMA IF NOT EXISTS "bob-storage-public";

GRANT USAGE ON SCHEMA "bob-storage-public" TO administrator, authenticated, anonymous;

ALTER DEFAULT PRIVILEGES IN SCHEMA "bob-storage-public"
  GRANT ALL ON TABLES TO administrator;
ALTER DEFAULT PRIVILEGES IN SCHEMA "bob-storage-public"
  GRANT USAGE ON SEQUENCES TO administrator, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA "bob-storage-public"
  GRANT ALL ON FUNCTIONS TO administrator, authenticated, anonymous;

-- Buckets table (same structure as Alice)
CREATE TABLE IF NOT EXISTS "bob-storage-public".app_buckets (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  key text NOT NULL,
  type text NOT NULL DEFAULT 'private',
  is_public boolean NOT NULL DEFAULT false,
  allowed_mime_types text[] NULL,
  max_file_size bigint NULL,
  allow_custom_keys boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (key)
);

COMMENT ON TABLE "bob-storage-public".app_buckets IS E'@storageBuckets\nStorage buckets table';

-- Files table (same structure as Alice)
CREATE TABLE IF NOT EXISTS "bob-storage-public".app_files (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  bucket_id uuid NOT NULL REFERENCES "bob-storage-public".app_buckets(id),
  key text NOT NULL,
  content_hash text NOT NULL,
  mime_type text NOT NULL,
  size bigint,
  filename text,
  owner_id uuid,
  is_public boolean NOT NULL DEFAULT false,
  previous_version_id uuid REFERENCES "bob-storage-public".app_files(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (bucket_id, key)
);

COMMENT ON TABLE "bob-storage-public".app_files IS E'@storageFiles\nStorage files table';

-- Grant table permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON "bob-storage-public".app_buckets TO administrator, authenticated, anonymous;
GRANT SELECT, INSERT, UPDATE, DELETE ON "bob-storage-public".app_files TO administrator, authenticated, anonymous;

-- Enable RLS on Bob's files table
ALTER TABLE "bob-storage-public".app_files ENABLE ROW LEVEL SECURITY;

-- RLS policy: anonymous can only see files in public buckets
CREATE POLICY anon_read_public_files ON "bob-storage-public".app_files
  FOR SELECT TO anonymous
  USING (
    bucket_id IN (
      SELECT id FROM "bob-storage-public".app_buckets WHERE is_public = true
    )
  );

-- RLS policy: anonymous can insert into any bucket (for upload testing)
CREATE POLICY anon_insert_files ON "bob-storage-public".app_files
  FOR INSERT TO anonymous
  WITH CHECK (true);

-- RLS policy: administrator bypasses RLS
CREATE POLICY admin_all_files ON "bob-storage-public".app_files
  FOR ALL TO administrator
  USING (true)
  WITH CHECK (true);
