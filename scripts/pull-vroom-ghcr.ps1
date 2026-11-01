$ErrorActionPreference = "Continue"
$log = "C:\Temp\vroom-ghcr-pull.log"
schtasks /create /tn "PFVroomGhcrPull" /tr "cmd /c docker pull ghcr.io/vroom-project/vroom-docker:v1.15.0 > $log 2>&1" /sc once /st 23:59 /ru SYSTEM /f | Out-Null
schtasks /run /tn "PFVroomGhcrPull" | Out-Null
Start-Sleep -Seconds 90
Get-Content $log -Tail 12 -ErrorAction SilentlyContinue
schtasks /delete /tn "PFVroomGhcrPull" /f | Out-Null
Write-Host "--- digest ---"
docker inspect --format '{{range .RepoDigests}}{{println .}}{{end}}' ghcr.io/vroom-project/vroom-docker:v1.15.0 2>$null
