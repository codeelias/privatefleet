$psql="C:\PostgreSQL\16\bin\psql.exe"
$s=Get-Content C:\privatefleet\secrets\secrets.json | ConvertFrom-Json
$env:PGPASSWORD=$s.owner
& $psql -U privatefleet -h 127.0.0.1 -d privatefleet -At -c "UPDATE jobs SET status='unassigned', assigned_driver_id=NULL WHERE reference LIKE 'B0%' AND status='assigned'"
& $psql -U privatefleet -h 127.0.0.1 -d privatefleet -At -F '|' -c "SELECT status,count(*) FROM jobs WHERE reference LIKE 'B0%' GROUP BY status"
