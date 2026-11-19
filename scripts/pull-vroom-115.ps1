$ErrorActionPreference = "Continue"
$cfgPath = Join-Path $HOME ".docker\config.json"
$backup = "C:\Temp\docker-config-backup.json"
if (Test-Path $cfgPath) { Copy-Item $cfgPath $backup -Force }
'{"auths":{}}' | Set-Content $cfgPath -Encoding ascii
docker pull vroomvrp/vroom-docker:v1.15.0
Write-Host "--- tags ---"
docker images --format '{{.Repository}}:{{.Tag}}' | Select-String -Pattern 'vroom'
if (Test-Path $backup) { Copy-Item $backup $cfgPath -Force }
