$ErrorActionPreference = "Continue"
$owner = (Get-NetUDPEndpoint -LocalPort 53 | Select-Object -First 1).OwningProcess
Write-Host "pid=$owner"
Get-CimInstance Win32_Service | Where-Object { $_.ProcessId -eq $owner } | Select-Object Name, DisplayName, State | Format-Table -AutoSize
Write-Host "--- service ---"
Get-Service SharedAccess | Select-Object Name, Status, StartType
Write-Host "--- dependents ---"
Get-Service SharedAccess | Select-Object -ExpandProperty DependentServices | Select-Object Name, Status
