$psql="C:\PostgreSQL\16\bin\psql.exe"
$s=Get-Content C:\privatefleet\secrets\secrets.json | ConvertFrom-Json
$env:PGPASSWORD=$s.owner
& $psql -U privatefleet -h 127.0.0.1 -d privatefleet -At -c "SELECT t.slug, u.email, u.role FROM users u JOIN tenants t ON t.id=u.tenant_id ORDER BY t.slug LIMIT 20"
