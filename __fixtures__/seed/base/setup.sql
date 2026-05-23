-- Shared fixture: minimal base setup
--
-- Creates extensions, roles, and the stamps schema needed by all test
-- scenarios.  This is the smallest common denominator — tests that also
-- need metaschema / services should load services/setup.sql instead
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
-- ROLES
-- =====================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'administrator') THEN
    CREATE ROLE administrator;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anonymous') THEN
    CREATE ROLE anonymous;
  END IF;
END
$$;

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
