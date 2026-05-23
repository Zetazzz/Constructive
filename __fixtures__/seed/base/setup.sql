-- Shared fixture: minimal base setup
--
-- Creates extensions and the stamps schema needed by all test scenarios.
-- Roles (administrator, authenticated, anonymous) are created upstream by
-- pgsql-test's createUserRole() — do NOT recreate them here.
--
-- This is the smallest common denominator — tests that also need
-- metaschema / services should load services/setup.sql instead
-- (which is self-contained and includes everything here).
--
-- Usage:
--   seed.sqlfile([
--     shared('base', 'setup.sql'),
--     // ... then your app-specific schema + data
--   ])

-- =====================================================
-- EXTENSIONS
-- =====================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =====================================================
-- STAMPS (timestamp triggers)
-- =====================================================

CREATE SCHEMA IF NOT EXISTS stamps;

CREATE OR REPLACE FUNCTION stamps.timestamps()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.created_at = COALESCE(NEW.created_at, now());
  END IF;
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
