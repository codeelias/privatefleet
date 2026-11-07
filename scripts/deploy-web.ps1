# Web deploy: syncs the COMPLETE dist wholesale. The index.html and lazy
# chunks must always ship together - partial copies leave the browser
# requesting chunks the server does not have (SPA fallback HTML served for
# a .js request -> MIME error). Use this instead of per-file scp.
param(
  [string]$KeyPath = "$HOME\.ssh\deploy_auto_ed25519",
  [string]$Target = "deploy@192.168.1.128"
)
$ErrorActionPreference = "Stop"
$local = "C:\privatefleet\apps\web\dist"
if (-not (Test-Path "$local\index.html")) {
  Write-Error "web dist missing - run: pnpm --filter @privatefleet/web build"
  exit 1
}
scp -P 22 -i $KeyPath "$local\index.html" ${Target}:C:/privatefleet/apps/web/dist/index.html
Get-ChildItem "$local\assets" -File | ForEach-Object {
  scp -P 22 -i $KeyPath $_.FullName ${Target}:C:/privatefleet/apps/web/dist/assets/$($_.Name)
}
Write-Output "web dist synced ($((Get-ChildItem "$local\assets" -File).Count) assets)"
