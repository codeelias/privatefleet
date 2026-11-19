$ErrorActionPreference="Continue"
if (-not (Test-Path C:\privatefleet\secrets\alert-webhook.json)) { throw "webhook test config missing" }
$args = @("-NoProfile","-ExecutionPolicy","Bypass","-File","C:\privatefleet\alert-sink.ps1")
Start-Process powershell -ArgumentList $args -WindowStyle Hidden
Start-Sleep -Seconds 2
& powershell -NoProfile -ExecutionPolicy Bypass -File C:\privatefleet\health-watch.ps1 -TestAlert
Start-Sleep -Seconds 2
if (Test-Path C:\PrivateFleet\logs\alert-received.json) { Get-Content C:\PrivateFleet\logs\alert-received.json } else { "NO_SINK_FILE" }
"--- delivery log ---"
Get-Content C:\PrivateFleet\logs\alert-delivery.log -Tail 3 -ErrorAction SilentlyContinue
