$ErrorActionPreference="Continue"
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\privatefleet\health-watch.ps1
"exit=$LASTEXITCODE"
schtasks /Create /TN "PrivateFleet Health Watch" /SC MINUTE /MO 5 /TR "powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\privatefleet\health-watch.ps1" /RU SYSTEM /RL HIGHEST /F 2>&1
schtasks /Query /TN "PrivateFleet Health Watch" /FO LIST 2>&1 | Select-String -Pattern "Status|Task To Run|Schedule Type|Repeat: Every" | ForEach-Object { $_.Line.Trim() }
