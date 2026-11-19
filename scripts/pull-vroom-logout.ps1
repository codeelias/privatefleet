$ErrorActionPreference = "Continue"
Write-Host "DOCKER_CONFIG=$env:DOCKER_CONFIG"
Write-Host "--- docker config ---"
Get-Content (Join-Path $HOME ".docker\config.json") -ErrorAction SilentlyContinue
Write-Host "--- logout/pull ---"
docker logout docker.io | Out-Host
docker pull vroomvrp/vroom-docker:v1.14.0
Write-Host "--- tags ---"
docker images --format '{{.Repository}}:{{.Tag}}' | Select-String -Pattern 'vroom'
