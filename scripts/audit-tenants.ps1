$psql="C:\PostgreSQL\16\bin\psql.exe"
$s=Get-Content C:\privatefleet\secrets\secrets.json | ConvertFrom-Json
$env:PGPASSWORD=$s.owner
& $psql -U privatefleet -h 127.0.0.1 -d privatefleet -P pager=off -c "SELECT t.slug, t.name, count(DISTINCT j.id) AS jobs, count(DISTINCT r.id) AS routes FROM tenants t LEFT JOIN jobs j ON j.tenant_id=t.id LEFT JOIN routes r ON r.tenant_id=t.id GROUP BY t.id,t.slug,t.name ORDER BY t.created_at"
& $psql -U privatefleet -h 127.0.0.1 -d privatefleet -P pager=off -c "SELECT status, count(*) FROM routes GROUP BY status ORDER BY status"
& $psql -U privatefleet -h 127.0.0.1 -d privatefleet -P pager=off -c "SELECT t.slug, r.status, count(*) FROM routes r JOIN tenants t ON t.id=r.tenant_id GROUP BY t.slug,r.status ORDER BY t.slug,r.status"
