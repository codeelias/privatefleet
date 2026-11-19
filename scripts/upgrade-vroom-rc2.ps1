$ErrorActionPreference = "Continue"
$net = docker inspect privatefleet-vroom --format '{{.HostConfig.NetworkMode}}'
$envs = docker inspect privatefleet-vroom --format '{{range .Config.Env}}{{println .}}{{end}}' | Where-Object { $_ -match '^OSRM_URL=|^VROOM_' }
Write-Host "network=$net envs=$($envs -join ',')"
docker stop privatefleet-vroom | Out-Host
docker rename privatefleet-vroom privatefleet-vroom-113 | Out-Host
$args = @('run','-d','--name','privatefleet-vroom','--restart','unless-stopped','--network',$net,'-p','127.0.0.1:3000:3000')
foreach ($e in $envs) { $args += @('-e', $e) }
$args += 'vroomvrp/vroom-docker:v1.14.0-rc.2'
& docker @args | Out-Host
Start-Sleep -Seconds 8
Write-Host "--- max_distance via 3000 ---"
curl.exe -s -m 20 -X POST http://127.0.0.1:3000 -H "content-type: application/json" --data-binary "@C:/privatefleet/vroom-test.json"
Write-Host ""
docker ps --format '{{.Names}} | {{.Image}} | {{.Status}}' | Select-String -Pattern 'vroom'
