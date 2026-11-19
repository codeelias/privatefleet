$ErrorActionPreference="Continue"
"--- local api ---"
curl.exe -s -m 5 -o NUL -w "%{http_code}`n" http://127.0.0.1:4000/healthz
"--- listeners ---"
Get-NetTCPConnection -State Listen -LocalPort 4000,443,5432,3000,5000 -ErrorAction SilentlyContinue | Select-Object LocalAddress,LocalPort,OwningProcess
"--- processes ---"
Get-Process caddy,node,postgres,docker -ErrorAction SilentlyContinue | Select-Object Name,Id,StartTime | Select-Object -First 10
"--- scheduled task ---"
Get-ScheduledTask -TaskName "PrivateFleet API" -ErrorAction SilentlyContinue | Select-Object TaskName,State
"--- api log tail ---"
Get-Content C:\PrivateFleet\logs\api.log -Tail 12 -ErrorAction SilentlyContinue
