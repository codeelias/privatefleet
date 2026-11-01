$ErrorActionPreference = "Continue"
$img = "ghcr.io/vroom-project/vroom-docker@sha256:247d5683d6745c755d718a156d16b16aac80baccc276a003a68b986c13883b08"
docker rm -f pf-vroom-115-test 2>$null | Out-Null
docker run -d --name pf-vroom-115-test -p 127.0.0.1:3001:3000 $img | Out-Host
Start-Sleep -Seconds 6
Write-Host "--- max_distance test on 3001 ---"
curl.exe -s -m 20 -X POST http://127.0.0.1:3001 -H "content-type: application/json" --data-binary "@C:/privatefleet/vroom-test.json"
Write-Host ""
docker rm -f pf-vroom-115-test | Out-Host
Write-Host "--- replace production ---"
$net = docker inspect privatefleet-vroom --format '{{.HostConfig.NetworkMode}}'
$envs = docker inspect privatefleet-vroom --format '{{range .Config.Env}}{{println .}}{{end}}' | Where-Object { $_ -match '^OSRM_URL=|^VROOM_' }
docker stop privatefleet-vroom | Out-Host
docker rename privatefleet-vroom privatefleet-vroom-rc2 | Out-Host
$args = @('run','-d','--name','privatefleet-vroom','--restart','unless-stopped','--network',$net,'-p','127.0.0.1:3000:3000')
foreach ($e in $envs) { $args += @('-e', $e) }
$args += $img
& docker @args | Out-Host
Start-Sleep -Seconds 8
Write-Host "--- max_distance test on 3000 ---"
curl.exe -s -m 20 -X POST http://127.0.0.1:3000 -H "content-type: application/json" --data-binary "@C:/privatefleet/vroom-test2.json"
Write-Host ""
docker ps --format '{{.Names}} | {{.Image}} | {{.Status}}' | Select-String -Pattern 'vroom'
