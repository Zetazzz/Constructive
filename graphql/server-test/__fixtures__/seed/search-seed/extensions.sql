-- Search-specific extensions (loaded after base/setup.sql)
--
-- Adds pg_trgm for fuzzy matching and optionally pgvector for similarity search.

CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- pgvector may not be available in all environments
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS "vector";
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pgvector extension not available, skipping';
END
$$;
