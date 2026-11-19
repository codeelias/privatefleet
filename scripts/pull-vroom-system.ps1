$ErrorActionPreference = "Continue"
foreach ($tag in @("v1.15.0", "v1.14.0", "latest")) {
  $log = "C:\Temp\vroom-pull-$tag.log"
  schtasks /create /tn "PFVroomPull" /tr "cmd /c docker pull vroomvrp/vroom-docker:$tag > $log 2>&1" /sc once /st 23:59 /ru SYSTEM /f | Out-Null
  schtasks /run /tn "PFVroomPull" | Out-Null
  Start-Sleep -Seconds 40
  Write-Host "--- $tag ---"
  Get-Content $log -Tail 4 -ErrorAction SilentlyContinue
  schtasks /delete /tn "PFVroomPull" /f | Out-Null
}
Write-Host "--- tags ---"
docker images --format '{{.Repository}}:{{.Tag}}' | Select-String -Pattern 'vroom'
