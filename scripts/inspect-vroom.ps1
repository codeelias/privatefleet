$ErrorActionPreference = "Continue"
Write-Host "--- docker version ---"
docker version --format '{{.Server.Version}}'
Write-Host "--- vroom containers ---"
docker ps -a --format '{{.Names}} | {{.Image}} | {{.Status}} | {{.Ports}}' | Select-String -Pattern 'vroom'
Write-Host "--- vroom images ---"
docker images --format '{{.Repository}}:{{.Tag}}' | Select-String -Pattern 'vroom'
Write-Host "--- port 3000 ---"
Get-NetTCPConnection -LocalPort 3000 -State Listen | Select-Object LocalPort, OwningProcess
