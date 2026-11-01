-- Post-migration SQL (idempotent): PostGIS columns/indexes + RLS.
-- Applied after drizzle migrations by src/db/apply-post-migration.ts.
-- Secrets/roles are created by scripts/db-setup.sql (superuser).

-- --- PostGIS: generated geometry from lat/lng, spatial indexes -------
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS location geometry(Point, 4326)
  GENERATED ALWAYS AS (
    CASE
      WHEN latitude IS NOT NULL AND longitude IS NOT NULL
      THEN ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)
    END
  ) STORED;

ALTER TABLE job_stops ADD COLUMN IF NOT EXISTS location geometry(Point, 4326)
  GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)) STORED;

CREATE INDEX IF NOT EXISTS vehicles_location_gix ON vehicles USING GIST (location);
CREATE INDEX IF NOT EXISTS job_stops_location_gix ON job_stops USING GIST (location);
CREATE INDEX IF NOT EXISTS vehicles_tenant_status_idx ON vehicles (tenant_id, status);
ALTER TABLE geofences ADD COLUMN IF NOT EXISTS geom geometry(Polygon, 4326)
  GENERATED ALWAYS AS (ST_SetSRID(ST_GeomFromGeoJSON(geojson), 4326)) STORED;
CREATE INDEX IF NOT EXISTS geofences_geom_gix ON geofences USING GIST (geom);

CREATE INDEX IF NOT EXISTS outbox_unpublished_scan_idx ON outbox (created_at) WHERE published_at IS NULL;

-- --- Row Level Security ----------------------------------------------
-- Runtime connects as privatefleet_app (non-owner), so these policies
-- apply; the migrator role owns the tables and is used only for DDL/seed.
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenants_tenant_isolation ON tenants;
CREATE POLICY tenants_tenant_isolation ON tenants
  USING (id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (id = nullif(current_setting('app.tenant_id', true), '')::uuid);

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'users', 'vehicles', 'drivers', 'jobs', 'job_stops', 'job_events',
    'alerts', 'outbox', 'refresh_tokens', 'idempotency_keys', 'demo_scenarios',
    'location_points', 'routes', 'route_stops', 'optimization_runs',
    'proof_policies', 'stop_evidence', 'geofences', 'geofence_states', 'tracking_tokens',
    'dispatch_policies', 'dispatch_policy_overrides', 'driver_work_requests'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_tenant_isolation', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid) WITH CHECK (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid)',
      t || '_tenant_isolation', t
    );
  END LOOP;
END
$$;

-- Default proof policy for every tenant: recipient required; signature/photo
-- optional until the operator configures a stricter policy.
INSERT INTO proof_policies (tenant_id, service_type, require_recipient, require_signature, require_photo, require_failure_photo)
SELECT id, '*', true, false, false, false FROM tenants
ON CONFLICT (tenant_id, service_type) DO NOTHING;
-- --- Grants for the runtime role -------------------------------------
GRANT USAGE ON SCHEMA public TO privatefleet_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO privatefleet_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO privatefleet_app;

CREATE OR REPLACE FUNCTION public_tracking_token_by_hash(p_hash text)
RETURNS TABLE (tenant_id uuid, job_id uuid, expires_at timestamptz, revoked_at timestamptz)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT t.tenant_id, t.job_id, t.expires_at, t.revoked_at
  FROM tracking_tokens t WHERE t.token_hash = p_hash LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public_tracking_token_by_hash(text) TO privatefleet_app;
-- --- Auth bootstrap functions (SECURITY DEFINER) ---------------------
-- Login must resolve a tenant/user before a tenant context exists.
-- These functions expose only the minimum identity surface; every
-- operational table stays behind RLS.
CREATE OR REPLACE FUNCTION auth_tenant_by_slug(p_slug text)
RETURNS TABLE (id uuid, name text, slug text, theme jsonb)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT t.id, t.name, t.slug, t.theme FROM tenants t WHERE t.slug = p_slug LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION auth_user_by_email(p_tenant uuid, p_email text)
RETURNS TABLE (id uuid, tenant_id uuid, email text, password_hash text, role user_role)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT u.id, u.tenant_id, u.email, u.password_hash, u.role
  FROM users u WHERE u.tenant_id = p_tenant AND u.email = p_email LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION auth_user_by_id(p_user uuid)
RETURNS TABLE (id uuid, tenant_id uuid, email text, password_hash text, role user_role)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT u.id, u.tenant_id, u.email, u.password_hash, u.role
  FROM users u WHERE u.id = p_user LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION auth_refresh_lookup(p_hash text)
RETURNS TABLE (id uuid, tenant_id uuid, user_id uuid, expires_at timestamptz, revoked_at timestamptz)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT r.id, r.tenant_id, r.user_id, r.expires_at, r.revoked_at
  FROM refresh_tokens r WHERE r.token_hash = p_hash LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION auth_tenant_by_slug(text) TO privatefleet_app;
GRANT EXECUTE ON FUNCTION auth_user_by_email(uuid, text) TO privatefleet_app;
GRANT EXECUTE ON FUNCTION auth_user_by_id(uuid) TO privatefleet_app;
GRANT EXECUTE ON FUNCTION auth_refresh_lookup(text) TO privatefleet_app;

CREATE OR REPLACE FUNCTION auth_driver_by_id(p_driver uuid)
RETURNS TABLE (id uuid, tenant_id uuid, full_name text, status driver_status, vehicle_id uuid, last_ping_at timestamptz)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT d.id, d.tenant_id, d.full_name, d.status, d.vehicle_id, d.last_ping_at
  FROM drivers d WHERE d.id = p_driver LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION auth_driver_by_id(uuid) TO privatefleet_app;






