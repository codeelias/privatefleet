$ErrorActionPreference = "Stop"
Set-Location C:\privatefleet

Write-Host "== secrets =="
$s = Get-Content C:\privatefleet\secrets\secrets.json | ConvertFrom-Json
$migrator = "postgres://privatefleet:$($s.owner)@127.0.0.1:5432/privatefleet"
$app     = "postgres://privatefleet_app:$($s.app)@127.0.0.1:5432/privatefleet"
$env:MIGRATION_DATABASE_URL = $migrator
$env:DATABASE_URL = $app

Write-Host "== contracts build =="
corepack pnpm --filter @privatefleet/contracts build
if ($LASTEXITCODE -ne 0) { Write-Host "contracts build FAILED"; exit 1 }

Write-Host "== migrate =="
corepack pnpm --filter @privatefleet/api db:migrate
if ($LASTEXITCODE -ne 0) { Write-Host "migrate FAILED"; exit 1 }

Write-Host "== web build =="
corepack pnpm --filter @privatefleet/web build
if ($LASTEXITCODE -ne 0) { Write-Host "web build FAILED"; exit 1 }

Write-Host "== api task =="
$task = "PrivateFleet API"
schtasks /query /tn $task 2>&1 | Select-Object -First 3
schtasks /end /tn $task 2>&1 | Select-Object -First 2
Start-Sleep -Seconds 3
schtasks /run /tn $task 2>&1 | Select-Object -First 2
Start-Sleep -Seconds 8

Write-Host "== health =="
$r = curl.exe -sk https://api.privatefleet.home.arpa/healthz
Write-Host "healthz: $r"
$v = curl.exe -sk https://api.privatefleet.home.arpa/v1/meta
Write-Host "meta: $v"
Write-Host "deploy-stage4 done"

