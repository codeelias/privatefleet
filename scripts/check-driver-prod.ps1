$psql="C:\PostgreSQL\16\bin\psql.exe"
$s=Get-Content C:\privatefleet\secrets\secrets.json | ConvertFrom-Json
$env:PGPASSWORD=$s.owner
& $psql -U privatefleet -h 127.0.0.1 -d privatefleet -At -F '|' -c "SELECT d.full_name, t.slug FROM drivers d JOIN tenants t ON t.id=d.tenant_id WHERE d.id='03437008-7197-4ad6-8215-edce45699566'"
& $psql -U privatefleet -h 127.0.0.1 -d privatefleet -At -F '|' -c "SELECT j.reference, t.slug FROM jobs j JOIN tenants t ON t.id=j.tenant_id WHERE j.reference IN ('J-000','J-001') LIMIT 5"
