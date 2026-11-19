$ErrorActionPreference = "Continue"
Get-CimInstance Win32_Service | Where-Object { $_.ProcessId -eq 7852 } | Select-Object Name, DisplayName, State, StartMode | Format-List
Write-Host "--- UDP 53 details ---"
Get-NetUDPEndpoint -LocalPort 53 | Format-List LocalAddress, LocalPort, OwningProcess
Write-Host "--- ICS service ---"
Get-Service SharedAccess -ErrorAction SilentlyContinue | Select-Object Name, Status, StartType
Write-Host "--- docker networks ---"
docker network ls --format '{{.Name}} | {{.Driver}}'
