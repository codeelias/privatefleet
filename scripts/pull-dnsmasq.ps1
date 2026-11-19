$ErrorActionPreference = "Continue"
New-Item -ItemType Directory -Force -Path C:\PrivateFleet\dns | Out-Null
@'
no-resolv
domain-needed
bogus-priv
cache-size=1000
server=192.168.1.254
address=/privatefleet.home.arpa/192.168.1.128
'@ | Set-Content C:\PrivateFleet\dns\dnsmasq.conf -Encoding ascii
$log = "C:\Temp\dns-pull.log"
schtasks /create /tn "PFDnsPull" /tr "cmd /c docker pull 4km3/dnsmasq:2.90 > $log 2>&1" /sc once /st 23:59 /ru SYSTEM /f | Out-Null
schtasks /run /tn "PFDnsPull" | Out-Null
Start-Sleep -Seconds 45
Get-Content $log -Tail 8 -ErrorAction SilentlyContinue
schtasks /delete /tn "PFDnsPull" /f | Out-Null
docker images --format '{{.Repository}}:{{.Tag}}' | Select-String -Pattern 'dnsmasq'
