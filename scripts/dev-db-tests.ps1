# Dev-DB test wrapper: the Windows->WSL localhost relay flaps on this machine
# (ICS interference); each attempt re-boots WSL and reruns the suite until it
# completes without a connection failure. Environment workaround only.
param(
  [string]$Suite = "src/modules/fleet src/modules/driver",
  [int]$Attempts = 6
)
$env:Path += ";$env:APPDATA\npm"
Set-Location C:\privatefleet
for ($i = 1; $i -le $Attempts; $i++) {
  wsl.exe -d Ubuntu-24.04 -- echo up 2>&1 | Out-Null
  Start-Sleep -Seconds 8
  Write-Output "== attempt $i / $Attempts =="
  $suiteArgs = $Suite -split ' '
  $out = pnpm --filter @privatefleet/api exec vitest run @suiteArgs --reporter=dot 2>&1 | Out-String
  $tail = ($out -split "`n" | Select-Object -Last 10) -join "`n"
  Write-Output $tail
  if ($out -match "Tests\s+\d+\s+passed" -and $out -notmatch "ECONNREFUSED" -and $out -notmatch "failed \(") {
    Write-Output "PASS on attempt $i"
    exit 0
  }
  Write-Output "attempt $i failed (connection flap); rebooting WSL relay"
  wsl.exe --shutdown 2>&1 | Out-Null
  Start-Sleep -Seconds 5
}
Write-Output "FAILED after $Attempts attempts"
exit 1
