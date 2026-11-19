$ErrorActionPreference = "Continue"
& powershell -NoProfile -ExecutionPolicy Bypass -File C:\privatefleet\start-api.ps1 *> C:\Temp\api-start-full.log
Get-Content C:\Temp\api-start-full.log -TotalCount 40
