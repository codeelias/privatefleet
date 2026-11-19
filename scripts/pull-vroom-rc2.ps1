$ErrorActionPreference = "Continue"
$log = "C:\Temp\vroom-pull-rc2.log"
schtasks /create /tn "PFVroomPull" /tr "cmd /c docker pull vroomvrp/vroom-docker:v1.14.0-rc.2 > $log 2>&1" /sc once /st 23:59 /ru SYSTEM /f | Out-Null
schtasks /run /tn "PFVroomPull" | Out-Null
Start-Sleep -Seconds 60
Get-Content $log -Tail 6 -ErrorAction SilentlyContinue
schtasks /delete /tn "PFVroomPull" /f | Out-Null
Write-Host "--- tags ---"
docker images --format '{{.Repository}}:{{.Tag}}' | Select-String -Pattern 'vroom'
