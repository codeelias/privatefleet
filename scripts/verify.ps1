# Engineering verification gate (thin wrapper around scripts/verify.mjs).
# Usage: powershell -File scripts/verify.ps1 [-SkipBuild]
param([switch]$SkipBuild)

$root = Split-Path $PSScriptRoot -Parent
Set-Location $root
if ($SkipBuild) {
    node scripts\verify.mjs --skip-build
} else {
    node scripts\verify.mjs
}
exit $LASTEXITCODE
