$ErrorActionPreference="Continue"
Get-ChildItem C:\Caddy -File | Select-Object Name,Length | Select-Object -First 10
Get-ScheduledTask -TaskName "PrivateFleet Caddy" -ErrorAction SilentlyContinue | Select-Object TaskName,State
