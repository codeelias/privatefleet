$ErrorActionPreference = "Continue"
schtasks /run /tn "PrivateFleet API" | Out-Host
Start-Sleep -Seconds 15
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'server.ts' } | ForEach-Object { "$($_.ProcessId) | $($_.CreationDate)" }
Get-Content C:\PrivateFleet\logs\api.log -Tail 12
