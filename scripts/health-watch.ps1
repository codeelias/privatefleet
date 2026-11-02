param(
  [switch]$Once
)

$ErrorActionPreference = "Continue"
$logDir = "C:\PrivateFleet\logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir "health-watch.log"

function Write-Health {
  param([string]$status, [string]$detail)
  $line = [ordered]@{
    at = (Get-Date).ToUniversalTime().ToString("o")
    status = $status
    detail = $detail
  } | ConvertTo-Json -Compress
  Add-Content -Path $log -Value $line
  Write-Output $line
}

function Get-HttpStatus {
  param([string]$url)
  $code = & curl.exe -sk -m 8 -o NUL -w "%{http_code}" $url 2>$null
  if ($LASTEXITCODE -ne 0) { return "000" }
  return [string]$code
}

function Test-Tcp {
  param([int]$port)
  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $task = $client.ConnectAsync("127.0.0.1", $port)
    return $task.Wait(3000) -and $client.Connected
  } catch {
    return $false
  } finally {
    $client.Dispose()
  }
}

$pg = "C:\PostgreSQL\16\bin\pg_isready.exe"
$dbReady = $false
if (Test-Path $pg) {
  & $pg -h 127.0.0.1 -p 5432 -q
  $dbReady = ($LASTEXITCODE -eq 0)
}

$apiLocal = Get-HttpStatus "http://127.0.0.1:4000/healthz"
$apiPublic = Get-HttpStatus "https://api.privatefleet.home.arpa/healthz"
$webPublic = Get-HttpStatus "https://app.privatefleet.home.arpa/"
$vroom = Test-Tcp 3000
$osrm = Test-Tcp 5000

$detail = "api_local=$apiLocal api_public=$apiPublic web=$webPublic db=$dbReady vroom=$vroom osrm=$osrm"

if ($apiLocal -ne "200") {
  Write-Health "critical" "$detail api_down"
  exit 1
}

if ($webPublic -ne "200" -or $apiPublic -ne "200") {
  # Caddy owns both public hostnames. Restart it once through the scheduled task.
  & schtasks.exe /run /tn "PrivateFleet Caddy" 2>&1 | Out-Null
  Start-Sleep -Seconds 6
  $apiPublic = Get-HttpStatus "https://api.privatefleet.home.arpa/healthz"
  $webPublic = Get-HttpStatus "https://app.privatefleet.home.arpa/"
  $detail = "$detail after_caddy_restart api_public=$apiPublic web=$webPublic"
  if ($webPublic -eq "200" -and $apiPublic -eq "200") {
    Write-Health "recovered" $detail
    exit 0
  }
  Write-Health "critical" "$detail public_unreachable"
  exit 1
}

if (-not $dbReady -or -not $vroom -or -not $osrm) {
  Write-Health "degraded" $detail
  exit 1
}

Write-Health "ok" $detail
exit 0
