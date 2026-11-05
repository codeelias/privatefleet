-- Phase 0 (docs/53): route version guards.
CREATE UNIQUE INDEX IF NOT EXISTS "routes_tenant_vehicle_version_uq"
  ON "routes" ("tenant_id", "vehicle_id", "version");
CREATE INDEX IF NOT EXISTS "routes_driver_status_version_idx"
  ON "routes" ("driver_id", "status", "version" DESC);
