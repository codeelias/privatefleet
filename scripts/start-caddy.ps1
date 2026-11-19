$ErrorActionPreference="Continue"
schtasks /query /tn "PrivateFleet Caddy" /fo LIST 2>&1
schtasks /run /tn "PrivateFleet Caddy" 2>&1
Start-Sleep -Seconds 3
Get-NetTCPConnection -State Listen -LocalPort 443 -ErrorAction SilentlyContinue | Select-Object LocalAddress,LocalPort,OwningProcess
curl.exe -sk -m 5 -o NUL -w "local443=%{http_code}`n" https://127.0.0.1/
