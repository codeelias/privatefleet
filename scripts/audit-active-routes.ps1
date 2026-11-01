$psql="C:\PostgreSQL\16\bin\psql.exe"
$s=Get-Content C:\privatefleet\secrets\secrets.json | ConvertFrom-Json
$env:PGPASSWORD=$s.owner
& $psql -U privatefleet -h 127.0.0.1 -d privatefleet -P pager=off -c "SELECT t.slug,r.status,r.version,r.created_at FROM routes r JOIN tenants t ON t.id=r.tenant_id WHERE r.status IN ('published','in_progress') ORDER BY t.slug,r.created_at DESC"
