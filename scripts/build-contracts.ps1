$ErrorActionPreference = "Stop"
$secrets = Get-Content 'C:\PrivateFleet\secrets\secrets.json' -Raw | ConvertFrom-Json
$env:PGAPPNAME = 'privatefleet_api'
$env:REPOSITORY_MODE = 'postgres'
$env:DATABASE_URL = "postgres://privatefleet_app:$($secrets.app)@127.0.0.1:5432/privatefleet"
$env:MIGRATION_DATABASE_URL = "postgres://privatefleet:$($secrets.owner)@127.0.0.1:5432/privatefleet"
$env:AUTH_JWT_SECRET = $secrets.jwt
$env:AUTH_ACCESS_TTL_SECONDS = '900'
$env:AUTH_REFRESH_TTL_DAYS = '30'
$env:CORS_ORIGINS = 'https://app.privatefleet.home.arpa'
$env:OSRM_BASE_URL = 'http://127.0.0.1:5000'
$env:VROOM_BASE_URL = 'http://127.0.0.1:3000'
$env:ROUTING_DATASET_ID = 'greater-london-2026-10-28'
$env:EVIDENCE_DIR = 'C:\PrivateFleet\evidence'
$env:PORT = '4000'
$env:HOST = '127.0.0.1'
$env:LOG_LEVEL = 'info'
Set-Location 'C:\PrivateFleet'
& 'C:\Program Files\nodejs\corepack.cmd' pnpm --filter @privatefleet/contracts build
