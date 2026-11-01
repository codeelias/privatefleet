$psql="C:\PostgreSQL\16\bin\psql.exe"
$s=Get-Content C:\privatefleet\secrets\secrets.json | ConvertFrom-Json
$env:PGPASSWORD=$s.owner
& $psql -U privatefleet -h 127.0.0.1 -d privatefleet -At -c "SELECT count(*), max(lp.captured_at) FROM location_points lp JOIN vehicles v ON v.id=lp.vehicle_id JOIN drivers d ON d.vehicle_id=v.id WHERE d.id='03437008-7197-4ad6-8215-edce45699566'"
