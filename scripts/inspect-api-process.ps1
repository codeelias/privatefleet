$ErrorActionPreference = "Continue"
schtasks /query /tn "PrivateFleet API" /xml | Select-String -Pattern "<Command>|<Arguments>|<WorkingDirectory>"
Write-Host "--- listeners ---"
Get-NetTCPConnection -State Listen | Where-Object { $_.LocalPort -in 4000, 8080, 4100 } | Select-Object LocalPort, OwningProcess | Format-Table -AutoSize
Write-Host "--- node procs ---"
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | ForEach-Object {
  "$($_.ProcessId) | $($_.CreationDate) | $($_.CommandLine)"
}
