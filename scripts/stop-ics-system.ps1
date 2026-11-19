$ErrorActionPreference = "Continue"
$log = "C:\Temp\ics-restart.log"
schtasks /create /tn "PFICSStop" /tr "cmd /c sc stop SharedAccess > $log 2>&1 & sc query SharedAccess >> $log 2>&1" /sc once /st 23:59 /ru SYSTEM /f | Out-Null
schtasks /run /tn "PFICSStop" | Out-Null
Start-Sleep -Seconds 8
Get-Content $log -ErrorAction SilentlyContinue
schtasks /delete /tn "PFICSStop" /f | Out-Null
Write-Host "--- port 53 ---"
Get-NetUDPEndpoint -LocalPort 53 -ErrorAction SilentlyContinue | ForEach-Object {
  $proc = Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue
  "udp53 $($_.LocalAddress) pid=$($_.OwningProcess) $($proc.ProcessName)"
}
