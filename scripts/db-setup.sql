-- One-time dev setup, run as a Postgres superuser:
--   psql -d privatefleet_dev -f scripts/db-setup.sql
-- Creates the non-owner runtime role so RLS is enforced for the app.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'privatefleet_app') THEN
    CREATE ROLE privatefleet_app LOGIN PASSWORD 'privatefleet_app_pw';
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO privatefleet_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO privatefleet_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO privatefleet_app;

-- Future tables created by the migrator role are usable by the app role.
ALTER DEFAULT PRIVILEGES FOR ROLE privatefleet IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO privatefleet_app;
