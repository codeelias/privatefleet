$ErrorActionPreference='Stop'
$psql="C:\PostgreSQL\16\bin\psql.exe"
$dump="C:\PostgreSQL\16\bin\pg_dump.exe"
$s=Get-Content C:\privatefleet\secrets\secrets.json | ConvertFrom-Json
$env:PGPASSWORD=$s.owner
$backupDir="C:\PrivateFleet\backups"
New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
$stamp=Get-Date -Format "yyyyMMdd-HHmmss"
$backup=Join-Path $backupDir "pre-retire-load-$stamp.dump"
& $dump -U privatefleet -h 127.0.0.1 -d privatefleet -Fc -f $backup
if (-not (Test-Path $backup) -or (Get-Item $backup).Length -lt 100000) { throw "Backup failed or too small" }
"backup=$backup bytes=$((Get-Item $backup).Length)"
& $psql -U privatefleet -h 127.0.0.1 -d privatefleet -v ON_ERROR_STOP=1 -P pager=off -c "BEGIN; DELETE FROM tenants WHERE slug='load-8d0a3a98'; COMMIT;"
if ($LASTEXITCODE -ne 0) { throw "Tenant delete failed; transaction rolled back" }
& $psql -U privatefleet -h 127.0.0.1 -d privatefleet -P pager=off -c "SELECT t.slug, count(DISTINCT j.id) jobs, count(DISTINCT r.id) routes FROM tenants t LEFT JOIN jobs j ON j.tenant_id=t.id LEFT JOIN routes r ON r.tenant_id=t.id GROUP BY t.id,t.slug ORDER BY t.slug"
& $psql -U privatefleet -h 127.0.0.1 -d privatefleet -P pager=off -c "SELECT status,count(*) FROM routes GROUP BY status ORDER BY status"
