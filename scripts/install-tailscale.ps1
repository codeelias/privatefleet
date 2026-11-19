$ErrorActionPreference = "Continue"
$msi = "C:\Temp\tailscale-setup-latest.exe"
try {
  Invoke-WebRequest -Uri "https://pkgs.tailscale.com/stable/tailscale-setup-latest.exe" -OutFile $msi -UseBasicParsing
  Write-Host "downloaded $((Get-Item $msi).Length) bytes"
} catch {
  Write-Host "download failed: $($_.Exception.Message)"
  exit 1
}
$log = "C:\Temp\tailscale-install.log"
$p = Start-Process $msi -ArgumentList "/quiet" -Wait -PassThru
Write-Host "msiexec exit=$($p.ExitCode)"
Get-Content $log -Tail 5 -ErrorAction SilentlyContinue
$exe = "C:\Program Files\Tailscale\tailscale.exe"
if (Test-Path $exe) { & $exe version }
Get-Service Tailscale -ErrorAction SilentlyContinue | Select-Object Name, Status, StartType

