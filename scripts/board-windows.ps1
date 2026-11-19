$psql="C:\PostgreSQL\16\bin\psql.exe"
$s=Get-Content C:\privatefleet\secrets\secrets.json | ConvertFrom-Json
$env:PGPASSWORD=$s.owner
& $psql -U privatefleet -h 127.0.0.1 -d privatefleet -P pager=off -c "SELECT d.full_name, count(*) AS jobs, count(js.window_start) AS starts, count(js.window_end) AS ends FROM jobs j JOIN drivers d ON d.id=j.assigned_driver_id JOIN job_stops js ON js.job_id=j.id AND js.stop_type='pickup' WHERE j.status='assigned' GROUP BY d.full_name ORDER BY d.full_name"
& $psql -U privatefleet -h 127.0.0.1 -d privatefleet -P pager=off -c "SELECT d.full_name,j.reference,js.window_start,js.window_end FROM jobs j JOIN drivers d ON d.id=j.assigned_driver_id JOIN job_stops js ON js.job_id=j.id AND js.stop_type='pickup' WHERE j.status='assigned' ORDER BY d.full_name,js.window_start LIMIT 12"
