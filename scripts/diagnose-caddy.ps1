$ErrorActionPreference="Continue"
"--- services ---"
Get-Service | Where-Object { $_.Name -match "caddy|tailscale|docker" } | Select-Object Name,Status,StartType
"--- caddy process ---"
Get-Process | Where-Object { $_.ProcessName -match "caddy" } | Select-Object ProcessName,Id,Path
"--- caddy paths ---"
Get-ChildItem C:\ -Filter caddy.exe -Recurse -ErrorAction SilentlyContinue | Select-Object -First 5 FullName
"--- scheduled tasks ---"
Get-ScheduledTask | Where-Object { $_.TaskName -match "Caddy|PrivateFleet" } | Select-Object TaskName,State
"--- port 443/4000 ---"
Get-NetTCPConnection -State Listen -LocalPort 443,4000 -ErrorAction SilentlyContinue | Select-Object LocalAddress,LocalPort,OwningProcess
"--- tailscale serve ---"
& "C:\Program Files\Tailscale\tailscale.exe" serve status 2>&1
