$ErrorActionPreference = "Continue"
$log = "C:\Temp\ics-disable.log"
$cmd = 'cmd /c sc config SharedAccess start= disabled > C:\Temp\ics-disable.log 2>&1 & sc stop SharedAccess >> C:\Temp\ics-disable.log 2>&1 & timeout /t 8 /nobreak >> C:\Temp\ics-disable.log 2>&1'
schtasks /create /tn "PFICSDisable" /tr $cmd /sc once /st 23:59 /ru SYSTEM /f | Out-Null
schtasks /run /tn "PFICSDisable" | Out-Null
Start-Sleep -Seconds 15
Get-Content $log -ErrorAction SilentlyContinue
schtasks /delete /tn "PFICSDisable" /f | Out-Null
Write-Host "--- service/port ---"
(Get-Service SharedAccess).Status
Get-NetUDPEndpoint -LocalPort 53 -ErrorAction SilentlyContinue | ForEach-Object {
  $proc = Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue
  "udp53 $($_.LocalAddress) pid=$($_.OwningProcess) $($proc.ProcessName)"
}
