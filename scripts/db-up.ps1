# Starts the local dev database (Postgres 16 + PostGIS in WSL).
# WSL shuts the distro down when idle, so run this before `pnpm dev`
# (or let `pnpm db:migrate` / integration tests start it themselves).
$ErrorActionPreference = "Continue"
$distro = "Ubuntu-24.04"

wsl -d $distro -u root -- bash -c "pg_isready -q || (pg_ctlcluster 16 main start 2>/dev/null || service postgresql start); sleep 1; pg_isready" 2>&1 | Select-Object -Last 2

if ($LASTEXITCODE -ne 0) {
  Write-Host "database did not start" -ForegroundColor Red
  exit 1
}

Write-Host ""
Write-Host "privatefleet dev database ready:" -ForegroundColor Green
Write-Host "  app role : postgres://privatefleet_app:privatefleet_app_pw@127.0.0.1:5432/privatefleet_dev"
Write-Host "  migrator : postgres://privatefleet:privatefleet_dev_pw@127.0.0.1:5432/privatefleet_dev"
Write-Host "  migrate  : pnpm --filter @privatefleet/api db:migrate"
