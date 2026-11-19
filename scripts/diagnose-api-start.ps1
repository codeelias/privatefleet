$ErrorActionPreference = "Continue"
schtasks /query /tn "PrivateFleet API" /fo LIST /v | Select-String -Pattern "Task To Run|Start In|Last Run Time|Last Result|Status|Run As User"
Write-Host "--- log file ---"
Get-Item C:\PrivateFleet\logs\api.log | Select-Object Length, LastWriteTime
Write-Host "--- start-api head ---"
Get-Content C:\privatefleet\start-api.ps1 -TotalCount 5
Write-Host "--- run start-api directly (10s) ---"
$p = Start-Process powershell.exe -ArgumentList "-NoProfile","-ExecutionPolicy","Bypass","-File","C:\privatefleet\start-api.ps1" -PassThru
Start-Sleep -Seconds 10
Write-Host "pid=$($p.Id) exited=$($p.HasExited)"
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'server.ts' } | ForEach-Object { "$($_.ProcessId) | $($_.CreationDate)" }
