$ErrorActionPreference = "Continue"
$psql = "C:\PostgreSQL\16\bin\psql.exe"
$s = Get-Content C:\privatefleet\secrets\secrets.json | ConvertFrom-Json
$env:PGPASSWORD = $s.owner
Write-Host "== policy =="
& $psql -U privatefleet -h 127.0.0.1 -d privatefleet -At -F '|' -c "SELECT t.slug,p.preset,p.revision,p.max_distance_m,p.max_visits FROM dispatch_policies p JOIN tenants t ON t.id=p.tenant_id WHERE t.slug='northstar-couriers-b67e10'"
Write-Host "== published routes northstar =="
& $psql -U privatefleet -h 127.0.0.1 -d privatefleet -At -F '|' -c "SELECT r.version,r.status,d.full_name,v.registration,count(rs.id) FROM routes r JOIN tenants t ON t.id=r.tenant_id JOIN drivers d ON d.id=r.driver_id LEFT JOIN vehicles v ON v.id=r.vehicle_id LEFT JOIN route_stops rs ON rs.route_id=r.id WHERE t.slug='northstar-couriers-b67e10' AND r.status IN ('published','in_progress') GROUP BY r.version,r.status,d.full_name,v.registration"
Write-Host "== jobs northstar =="
& $psql -U privatefleet -h 127.0.0.1 -d privatefleet -At -F '|' -c "SELECT status,count(*) FROM jobs j JOIN tenants t ON t.id=j.tenant_id WHERE t.slug='northstar-couriers-b67e10' GROUP BY status"
Write-Host "== duplicate active refs =="
& $psql -U privatefleet -h 127.0.0.1 -d privatefleet -At -F '|' -c "SELECT tenant_id,reference,count(*) FROM jobs WHERE status <> 'cancelled' GROUP BY tenant_id,reference HAVING count(*)>1 ORDER BY 3 DESC LIMIT 10"
Write-Host "== RLS policy tables =="
& $psql -U privatefleet -h 127.0.0.1 -d privatefleet -At -F '|' -c "SELECT relname,relrowsecurity FROM pg_class WHERE relname IN ('dispatch_policies','dispatch_policy_overrides')"
Write-Host "== vroom =="
docker ps --format '{{.Names}} | {{.Image}} | {{.Status}}' | Select-String -Pattern 'vroom'
