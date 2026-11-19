$ErrorActionPreference = "Continue"
Get-Content C:\privatefleet\apps\api\src\modules\optimization\fleet-service.ts | Select-Object -Skip 20 -First 14
Write-Host "--- dispatch policy tail ---"
Get-Content C:\privatefleet\apps\api\src\modules\optimization\dispatch-policy.ts | Select-Object -Last 20
