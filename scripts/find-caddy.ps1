$ErrorActionPreference="Continue"
"--- where ---"
where.exe caddy 2>&1
"--- common ---"
Get-ChildItem C:\Caddy,C:\Tools,C:\privatefleet -Filter caddy.exe -Recurse -Depth 3 -ErrorAction SilentlyContinue | Select-Object -First 5 FullName
"--- tasks ---"
Get-ScheduledTask | Where-Object { $_.TaskName -match "Caddy|PrivateFleet" } | Select-Object TaskName,State
"--- service configs ---"
Get-CimInstance Win32_Service | Where-Object { $_.Name -match "caddy" } | Select-Object Name,State,PathName
"--- caddy config ---"
Get-ChildItem C:\privatefleet -Filter Caddyfile* -Recurse -Depth 3 -ErrorAction SilentlyContinue | Select-Object -First 5 FullName
