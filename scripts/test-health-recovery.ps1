$ErrorActionPreference="Continue"
schtasks /End /TN "PrivateFleet Caddy" 2>&1 | Out-Null
Start-Sleep -Seconds 2
$before = & curl.exe -sk -m 5 -o NUL -w "%{http_code}" https://app.privatefleet.home.arpa/ 2>$null
"before=$before"
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\privatefleet\health-watch.ps1
"watch_exit=$LASTEXITCODE"
$after = & curl.exe -sk -m 8 -o NUL -w "%{http_code}" https://app.privatefleet.home.arpa/ 2>$null
"after=$after"
Get-Content C:\PrivateFleet\logs\health-watch.log -Tail 2
