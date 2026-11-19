$psql="C:\PostgreSQL\16\bin\psql.exe"
$s=Get-Content C:\privatefleet\secrets\secrets.json | ConvertFrom-Json
$env:PGPASSWORD=$s.owner
& $psql -U privatefleet -h 127.0.0.1 -d privatefleet -At -c "UPDATE jobs j SET status='assigned', assigned_driver_id=r.driver_id FROM route_stops rs JOIN routes r ON r.id=rs.route_id JOIN job_stops js ON js.id=rs.job_stop_id WHERE j.id=js.job_id AND r.version=107 AND r.status='published' AND j.reference LIKE 'B0%'"
& $psql -U privatefleet -h 127.0.0.1 -d privatefleet -At -F '|' -c "SELECT status,count(*) FROM jobs WHERE reference LIKE 'B0%' GROUP BY status"
