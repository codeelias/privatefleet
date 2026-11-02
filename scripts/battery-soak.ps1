param(
  [string]$Device = "R5CWB0BR3BP",
  [int]$Hours = 8
)

$ErrorActionPreference = "Continue"
$adb = Join-Path $env:LOCALAPPDATA "Android\Sdk\platform-tools\adb.exe"
if (-not (Test-Path $adb)) { throw "adb not found" }
$logDir = "C:\privatefleet\logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$csv = Join-Path $logDir "battery-soak-$stamp.csv"
$end = (Get-Date).AddHours($Hours)
"timestamp,level,temp_c,status,ac,usb,service_foreground" | Set-Content -Path $csv -Encoding utf8

while ((Get-Date) -lt $end) {
  try {
    $battery = & $adb -s $Device shell dumpsys battery 2>$null
    $level = (($battery | Select-String "level:" | Select-Object -First 1) -replace ".*level:\s*", "").Trim()
    $temp = (($battery | Select-String "temperature:" | Select-Object -First 1) -replace ".*temperature:\s*", "").Trim()
    $status = (($battery | Select-String "status:" | Select-Object -First 1) -replace ".*status:\s*", "").Trim()
    $ac = (($battery | Select-String "AC powered:" | Select-Object -First 1) -replace ".*AC powered:\s*", "").Trim()
    $usb = (($battery | Select-String "USB powered:" | Select-Object -First 1) -replace ".*USB powered:\s*", "").Trim()
    $services = & $adb -s $Device shell dumpsys activity services com.privatefleet.driver.nativeapp 2>$null
    $foreground = if ($services -match "isForeground=true") { "true" } else { "false" }
    $line = "{0},{1},{2},{3},{4},{5},{6}" -f (Get-Date).ToUniversalTime().ToString("o"), $level, $temp, $status, $ac, $usb, $foreground
    Add-Content -Path $csv -Value $line
  } catch {
    Add-Content -Path $csv -Value ("{0},,,,,,error:{1}" -f (Get-Date).ToUniversalTime().ToString("o"), $_.Exception.Message)
  }
  Start-Sleep -Seconds 300
}

Add-Content -Path $csv -Value ("{0},,,,,,complete" -f (Get-Date).ToUniversalTime().ToString("o"))
"battery soak complete: $csv"
