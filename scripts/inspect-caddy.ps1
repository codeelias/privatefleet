$ErrorActionPreference = "Continue"
Write-Host "--- caddy process ---"
Get-Process caddy -ErrorAction SilentlyContinue | Select-Object Id, StartTime, Path
Write-Host "--- caddy config ---"
Get-ChildItem C:\PrivateFleet\caddy -ErrorAction SilentlyContinue | Select-Object Name
Get-Content C:\PrivateFleet\caddy\Caddyfile -ErrorAction SilentlyContinue
Write-Host "--- caddy logs tail ---"
Get-ChildItem C:\PrivateFleet\logs -Filter '*caddy*' -ErrorAction SilentlyContinue | Select-Object Name, Length, LastWriteTime
Get-Content C:\PrivateFleet\logs\caddy.log -Tail 12 -ErrorAction SilentlyContinue
