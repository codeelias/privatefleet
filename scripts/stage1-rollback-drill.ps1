$ErrorActionPreference = "Stop"
$psql = "C:\PostgreSQL\16\bin\psql.exe"
$s = Get-Content C:\privatefleet\secrets\secrets.json | ConvertFrom-Json
$db = "privatefleet_stage1_scratch"

$env:PGPASSWORD = $s.super
& $psql -U postgres -h 127.0.0.1 -d postgres -c "DROP DATABASE IF EXISTS $db" | Out-Null
& $psql -U postgres -h 127.0.0.1 -d postgres -c "CREATE DATABASE $db OWNER privatefleet" | Out-Null

$env:PGPASSWORD = $s.owner
$env:PGDATABASE = $db
& $psql -U privatefleet -h 127.0.0.1 -d $db -v ON_ERROR_STOP=1 -c "CREATE TABLE routes (id uuid primary key)" | Out-Null
& $psql -U privatefleet -h 127.0.0.1 -d $db -v ON_ERROR_STOP=1 -c 'ALTER TABLE "routes" ADD COLUMN "waypoints" jsonb; ALTER TABLE "routes" ADD COLUMN "legs" jsonb;' | Out-Null
$cols = & $psql -U privatefleet -h 127.0.0.1 -d $db -At -c "SELECT column_name FROM information_schema.columns WHERE table_name='routes' AND column_name IN ('waypoints','legs') ORDER BY 1"
Write-Host "after-migration: $($cols -join ',')"
& $psql -U privatefleet -h 127.0.0.1 -d $db -v ON_ERROR_STOP=1 -c "ALTER TABLE routes DROP COLUMN IF EXISTS legs; ALTER TABLE routes DROP COLUMN IF EXISTS waypoints;" | Out-Null
$after = & $psql -U privatefleet -h 127.0.0.1 -d $db -At -c "SELECT count(*) FROM information_schema.columns WHERE table_name='routes' AND column_name IN ('waypoints','legs')"
Write-Host "after-rollback-count: $after"

$env:PGPASSWORD = $s.super
& $psql -U postgres -h 127.0.0.1 -d postgres -c "DROP DATABASE $db" | Out-Null
Write-Host "scratch-dropped"
