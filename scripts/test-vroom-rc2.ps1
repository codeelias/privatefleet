$ErrorActionPreference = "Continue"
docker rm -f pf-vroom-test 2>$null | Out-Null
docker run -d --name pf-vroom-test -p 127.0.0.1:3001:3000 vroomvrp/vroom-docker:v1.14.0-rc.2 | Out-Host
Start-Sleep -Seconds 6
Write-Host "--- max_distance test ---"
curl.exe -s -m 20 -X POST http://127.0.0.1:3001 -H "content-type: application/json" --data-binary "@C:/privatefleet/vroom-test.json"
Write-Host ""
docker rm -f pf-vroom-test | Out-Host
