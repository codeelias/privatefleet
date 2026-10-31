$ErrorActionPreference = "Continue"
schtasks /run /tn "PrivateFleet API"
Start-Sleep -Seconds 10
$code = curl.exe -s -m 8 -o NUL -w "%{http_code}" http://127.0.0.1:4000/healthz
Write-Host "remote4000=$code"
schtasks /query /tn "PrivateFleet API" /fo LIST | Select-String "Status"
