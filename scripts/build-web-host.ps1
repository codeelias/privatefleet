$ErrorActionPreference = "Continue"
Set-Location C:\privatefleet
corepack pnpm --filter @privatefleet/web build 2>&1 | Select-Object -Last 30
