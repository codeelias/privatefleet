$psql="C:\PostgreSQL\16\bin\psql.exe"
$s=Get-Content C:\privatefleet\secrets\secrets.json | ConvertFrom-Json
$env:PGPASSWORD=$s.owner
& $psql -U privatefleet -h 127.0.0.1 -d privatefleet -At -c "SELECT count(*), max(lp.captured_at), max(v.captured_at) FROM location_points lp JOIN vehicles v ON v.id=lp.vehicle_id JOIN drivers d ON d.vehicle_id=v.id WHERE d.id='8780d7c8-99bb-4d4e-84c9-3824e27b4e9e'"
