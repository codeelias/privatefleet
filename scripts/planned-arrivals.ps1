$psql="C:\PostgreSQL\16\bin\psql.exe"
$s=Get-Content C:\privatefleet\secrets\secrets.json | ConvertFrom-Json
$env:PGPASSWORD=$s.owner
& $psql -U privatefleet -h 127.0.0.1 -d privatefleet -P pager=off -c "SELECT d.full_name, count(*) AS stops, count(rs.planned_arrival_at) AS planned FROM route_stops rs JOIN routes r ON r.id=rs.route_id LEFT JOIN drivers d ON d.id=r.driver_id WHERE r.status IN ('published','in_progress') GROUP BY d.full_name"
& $psql -U privatefleet -h 127.0.0.1 -d privatefleet -P pager=off -c "SELECT d.full_name,rs.sequence_no,rs.planned_arrival_at FROM route_stops rs JOIN routes r ON r.id=rs.route_id LEFT JOIN drivers d ON d.id=r.driver_id WHERE r.status IN ('published','in_progress') ORDER BY d.full_name,rs.sequence_no LIMIT 10"
