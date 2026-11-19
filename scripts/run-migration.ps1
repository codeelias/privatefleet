$ErrorActionPreference = "Stop"
$secrets = Get-Content 'C:\PrivateFleet\secrets\secrets.json' -Raw | ConvertFrom-Json
$env:DATABASE_URL = "postgres://privatefleet_app:$($secrets.app)@127.0.0.1:5432/privatefleet"
$env:MIGRATION_DATABASE_URL = "postgres://privatefleet:$($secrets.owner)@127.0.0.1:5432/privatefleet"
Set-Location 'C:\PrivateFleet'
& 'C:\Program Files\nodejs\corepack.cmd' pnpm --filter @privatefleet/api db:migrate
