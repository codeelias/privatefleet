$ErrorActionPreference = "Continue"
$owner = (Get-NetUDPEndpoint -LocalPort 53 | Select-Object -First 1).OwningProcess
$log = "C:\Temp\ics-kill.log"
schtasks /create /tn "PFICSKill" /tr "cmd /c taskkill /F /PID $owner > $log 2>&1 & timeout /t 6 /nobreak >> $log 2>&1 & sc query SharedAccess >> $log 2>&1" /sc once /st 23:59 /ru SYSTEM /f | Out-Null
schtasks /run /tn "PFICSKill" | Out-Null
Start-Sleep -Seconds 10
Get-Content $log -ErrorAction SilentlyContinue
schtasks /delete /tn "PFICSKill" /f | Out-Null
Write-Host "--- port 53 ---"
Get-NetUDPEndpoint -LocalPort 53 -ErrorAction SilentlyContinue | ForEach-Object {
  $proc = Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue
  "udp53 $($_.LocalAddress) pid=$($_.OwningProcess) $($proc.ProcessName)"
}
