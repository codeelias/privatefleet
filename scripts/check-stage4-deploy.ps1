$ErrorActionPreference = "Continue"
schtasks /query /tn "PrivateFleet API" /v /fo LIST | Select-String "Task To Run|Status|Last Result"
Write-Host "-- healthz --"
curl.exe -sk https://api.privatefleet.home.arpa/healthz
Write-Host ""
Write-Host "-- meta --"
curl.exe -sk https://api.privatefleet.home.arpa/v1/meta
Write-Host ""
Write-Host "-- web shell --"
curl.exe -sk https://app.privatefleet.home.arpa/ | Select-Object -First 1
