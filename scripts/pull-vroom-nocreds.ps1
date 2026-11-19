$ErrorActionPreference = "Continue"
$cfgPath = Join-Path $HOME ".docker\config.json"
Copy-Item $cfgPath "C:\Temp\docker-config-original.json" -Force -ErrorAction SilentlyContinue
'{"auths":{}}' | Set-Content $cfgPath -Encoding ascii
Get-Content $cfgPath
docker pull vroomvrp/vroom-docker:v1.14.0
Write-Host "--- tags ---"
docker images --format '{{.Repository}}:{{.Tag}}' | Select-String -Pattern 'vroom'
