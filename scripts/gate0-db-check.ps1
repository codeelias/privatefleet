$ErrorActionPreference = "Stop"
$psql = "C:\PostgreSQL\16\bin\psql.exe"
$s = Get-Content C:\privatefleet\secrets\secrets.json | ConvertFrom-Json
$env:PGPASSWORD = $s.owner
$ids = @("fb57fa9e-fe6a-4a20-8ec7-a88135f6cdba", "b018d388-316a-4355-af4a-041ccc636243")
foreach ($id in $ids) {
  $q = @"
SELECT r.id, r.version,
       jsonb_array_length(r.waypoints) AS wp,
       jsonb_array_length(r.legs) AS legs,
       (SELECT count(*) FROM route_stops rs WHERE rs.route_id = r.id) AS stops,
       (SELECT count(*) FROM route_stops rs WHERE rs.route_id = r.id AND rs.planned_arrival_at IS NOT NULL) AS arrivals
FROM routes r WHERE r.id = '$id';
"@
  & $psql -U privatefleet -h 127.0.0.1 -d privatefleet -At -F '|' -c $q
}
