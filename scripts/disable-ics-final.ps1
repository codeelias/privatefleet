$ErrorActionPreference = "Continue"
$log = "C:\Temp\ics-final.log"
$cmd = 'cmd /c sc failure SharedAccess reset= 0 actions= "" > C:\Temp\ics-final.log 2>&1 & sc config SharedAccess start= disabled >> C:\Temp\ics-final.log 2>&1 & sc stop SharedAccess >> C:\Temp\ics-final.log 2>&1 & timeout /t 10 /nobreak >> C:\Temp\ics-final.log 2>&1'
schtasks /create /tn "PFICSFinal" /tr $cmd /sc once /st 23:59 /ru SYSTEM /f | Out-Null
schtasks /run /tn "PFICSFinal" | Out-Null
Start-Sleep -Seconds 14
Get-Content $log -ErrorAction SilentlyContinue
schtasks /delete /tn "PFICSFinal" /f | Out-Null
Write-Host "--- status ---"
sc.exe query SharedAccess
Write-Host "--- port 53 ---"
Get-NetUDPEndpoint -LocalPort 53 -ErrorAction SilentlyContinue | ForEach-Object {
  $proc = Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue
  "udp53 $($_.LocalAddress) pid=$($_.OwningProcess) $($proc.ProcessName)"
}
