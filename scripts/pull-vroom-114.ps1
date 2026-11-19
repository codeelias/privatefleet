$ErrorActionPreference = "Continue"
$cfg = "C:\Temp\pf-docker-config"
New-Item -ItemType Directory -Force -Path $cfg | Out-Null
'{"auths":{}}' | Set-Content "$cfg\config.json" -Encoding ascii
$env:DOCKER_CONFIG = $cfg
Write-Host "config=$env:DOCKER_CONFIG"
docker pull docker.io/vroomvrp/vroom-docker:v1.14.0
Write-Host "--- tags now ---"
docker images --format '{{.Repository}}:{{.Tag}}' | Select-String -Pattern 'vroom'
