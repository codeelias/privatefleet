$ErrorActionPreference = "Continue"
$procs = Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'src/server.ts' -or $_.CommandLine -match 'tsx' }
foreach ($p in $procs) {
  Write-Host "stopping $($p.ProcessId)"
  Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
}
Start-Sleep -Seconds 4
schtasks /run /tn "PrivateFleet API" | Out-Host
Start-Sleep -Seconds 15
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'server.ts' } | ForEach-Object {
  "$($_.ProcessId) | $($_.CreationDate)"
}
