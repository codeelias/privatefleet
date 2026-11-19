$ErrorActionPreference = "Continue"
$log = "C:\Temp\dns-pull2.log"
schtasks /create /tn "PFDnsPull2" /tr "cmd /c docker pull 4km3/dnsmasq:latest > $log 2>&1" /sc once /st 23:59 /ru SYSTEM /f | Out-Null
schtasks /run /tn "PFDnsPull2" | Out-Null
Start-Sleep -Seconds 40
Get-Content $log -Tail 8 -ErrorAction SilentlyContinue
schtasks /delete /tn "PFDnsPull2" /f | Out-Null
docker images --format '{{.Repository}}:{{.Tag}}' | Select-String -Pattern 'dnsmasq'
