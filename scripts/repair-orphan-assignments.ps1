$psql="C:\PostgreSQL\16\bin\psql.exe"
$s=Get-Content C:\privatefleet\secrets\secrets.json | ConvertFrom-Json
$env:PGPASSWORD=$s.owner
& $psql -U privatefleet -h 127.0.0.1 -d privatefleet -At -c "UPDATE jobs j SET status='unassigned', assigned_driver_id=NULL, assigned_vehicle_id=NULL WHERE j.tenant_id=(SELECT id FROM tenants WHERE slug='northstar-couriers-b67e10') AND j.status='assigned' AND NOT EXISTS (SELECT 1 FROM job_stops js JOIN route_stops rs ON rs.job_stop_id=js.id JOIN routes r ON r.id=rs.route_id WHERE js.job_id=j.id AND r.status IN ('published','in_progress'))"
& $psql -U privatefleet -h 127.0.0.1 -d privatefleet -At -F '|' -c "SELECT status,count(*) FROM jobs j JOIN tenants t ON t.id=j.tenant_id WHERE t.slug='northstar-couriers-b67e10' GROUP BY status"
