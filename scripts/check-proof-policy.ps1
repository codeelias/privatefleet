$ErrorActionPreference = "Stop"
$psql = "C:\PostgreSQL\16\bin\psql.exe"
$s = Get-Content C:\privatefleet\secrets\secrets.json | ConvertFrom-Json
$env:PGPASSWORD = $s.owner
$q = @"
SELECT p.service_type, p.require_recipient, p.require_signature, p.require_photo, p.require_failure_photo
FROM proof_policies p JOIN tenants t ON t.id=p.tenant_id
WHERE t.slug='northstar-couriers-b67e10' ORDER BY p.service_type;
"@
& $psql -U privatefleet -h 127.0.0.1 -d privatefleet -At -F '|' -c $q
Write-Host "--- recent evidence ---"
$q2 = @"
SELECT e.kind, e.stop_id, e.created_at, js.address
FROM stop_evidence e JOIN job_stops js ON js.id=e.stop_id
ORDER BY e.created_at DESC LIMIT 5;
"@
& $psql -U privatefleet -h 127.0.0.1 -d privatefleet -At -F '|' -c $q2
