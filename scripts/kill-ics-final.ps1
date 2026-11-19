$ErrorActionPreference = "Continue"
$owner = (Get-NetUDPEndpoint -LocalPort 53 -ErrorAction SilentlyContinue | Select-Object -First 1).OwningProcess
Write-Host "owner=$owner"
if ($owner) { Stop-Process -Id $owner -Force -ErrorAction Continue }
Start-Sleep -Seconds 8
$after = (Get-NetUDPEndpoint -LocalPort 53 -ErrorAction SilentlyContinue | Select-Object -First 1).OwningProcess
Write-Host "after=$after"
sc.exe query SharedAccess
