$ErrorActionPreference = "Stop"
$psql = "C:\PostgreSQL\16\bin\psql.exe"
$s = Get-Content C:\privatefleet\secrets\secrets.json | ConvertFrom-Json
$env:PGPASSWORD = $s.owner
$cols = & $psql -U privatefleet -h 127.0.0.1 -d privatefleet -At -c "SELECT column_name FROM information_schema.columns WHERE table_name='routes' AND column_name IN ('waypoints','legs') ORDER BY 1"
Write-Host "live-route-columns: $($cols -join ',')"
$routes = & $psql -U privatefleet -h 127.0.0.1 -d privatefleet -At -c "SELECT count(*) FROM routes WHERE waypoints IS NOT NULL"
Write-Host "routes-with-waypoints: $routes"
