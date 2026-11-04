# Engineering verification gate.
# Runs: contracts/api/web typecheck, API unit tests, web unit tests, web build.
# Usage: powershell -File scripts/verify.ps1 [-SkipBuild]
param([switch]$SkipBuild)

$ErrorActionPreference = "Stop"
$env:Path += ";$env:APPDATA\npm"
Set-Location (Split-Path $PSScriptRoot -Parent)

function Run-Step {
    param([string]$Name, [string]$Filter, [string]$Command)
    Write-Host "== $Name ==" -ForegroundColor Cyan
    pnpm --filter $Filter $Command.Split(" ")
    if ($LASTEXITCODE -ne 0) { throw "step failed: $Name" }
}

Run-Step "contracts typecheck" "@privatefleet/contracts" "typecheck"
Run-Step "api typecheck" "@privatefleet/api" "typecheck"
Run-Step "api unit tests" "@privatefleet/api" "test"
Run-Step "web typecheck" "@privatefleet/web" "typecheck"
Run-Step "web unit tests" "@privatefleet/web" "exec vitest run src/features/live-map/engine src/features/heads-up/engine src/features/geofences/engine"
if (-not $SkipBuild) {
    Run-Step "web build" "@privatefleet/web" "build"
}
Write-Host "verify gate: PASS" -ForegroundColor Green
