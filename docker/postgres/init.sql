-- AMS Database Initialization
-- Creates required extensions and database roles

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";   -- for fuzzy text search
CREATE EXTENSION IF NOT EXISTS "btree_gin"; -- for composite indexes

-- Application role for RLS (lower-privilege)
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'ams_app') THEN
    CREATE ROLE ams_app LOGIN PASSWORD 'ams_app_password';
  END IF;
END
$$;

GRANT CONNECT ON DATABASE ams_db TO ams_app;
GRANT USAGE ON SCHEMA public TO ams_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ams_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ams_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ams_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ams_app;

-- GUC parameter for current tenant (used by RLS policies)
ALTER DATABASE ams_db SET app.current_tenant_id TO '';
ALTER DATABASE ams_db SET app.bypass_rls TO 'false';
