-- ============================================================================
-- Least-privilege application role for Row Level Security.
--
-- Companion to `tenant-isolation.sql`, which creates the 51 policies. This
-- file creates the role those policies can actually filter for.
--
-- STATUS: NOT YET APPLIED to production. Applying it is a two-step, deliberate
-- change, sequenced so the application never drops below one working
-- configuration:
--
--   1. Create the role and grant it (this file). Nothing changes yet: the app
--      still connects as `neondb_owner`, which keeps bypassing RLS.
--   2. Point DATABASE_URL at the new role. THIS is the step that makes RLS
--      load-bearing, and it is blocked until the GUC is set per unit of work --
--      see the NAMED FOLLOW-UP in tenant-isolation.sql. The stateless Neon HTTP
--      driver cannot hang `app.current_tenant_id` on a session, so until a
--      stateful driver or the per-transaction `set_config` wrapper is in place,
--      every read with this role returns zero rows.
--
-- DO NOT perform step 2 from this file. It is a deliberate, separately
-- verified change, and this comment is the record of why.
--
-- Apply with psql (the password is passed, never stored here):
--   psql "$DATABASE_URL" -v app_password="$NOVASTAR_APP_PASSWORD" -f 00-app-role.sql
--
-- Re-running is idempotent.
-- ============================================================================

-- The role. NOBYPASSRLS is the PostgreSQL default and is stated explicitly so a
-- later ALTER that wants to re-enable bypass has to say so out loud.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'novastar_app') THEN
    CREATE ROLE novastar_app LOGIN PASSWORD :'app_password';
  ELSE
    ALTER ROLE novastar_app NOBYPASSRLS;
  END IF;
END
$$;

ALTER ROLE novastar_app
  NOBYPASSRLS
  NOSUPERUSER
  NOCREATEDB
  NOCREATEROLE
  NOINHERIT;

-- Connection and schema usage only. No CREATE on the public schema: the
-- schema is owned by Prisma migrations, not by the application.
GRANT CONNECT ON DATABASE current_database() TO novastar_app;
GRANT USAGE ON SCHEMA public TO novastar_app;
REVOKE CREATE ON SCHEMA public FROM novastar_app;

-- Data-plane rights on what exists now, plus defaults so tables and sequences
-- created by later migrations are covered without re-running this file.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO novastar_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO novastar_app;

-- The migration ledger is history, not data: the app never writes it, and a
-- SQL-injection foothold that can DELETE it could erase the record of what
-- schema the database is actually in. Read-only to the application role.
REVOKE INSERT, UPDATE, DELETE ON TABLE _prisma_migrations FROM novastar_app;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO novastar_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO novastar_app;

-- The policies in tenant-isolation.sql are FOR ALL TO public, so the role is
-- already a policy subject. Restating the grant set here would be a lie about
-- who can do what; the point of this role is that it can do *less*.
