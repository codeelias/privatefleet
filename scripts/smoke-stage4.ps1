$ErrorActionPreference = "Continue"
Write-Host "-- public tracking invalid token --"
curl.exe -sk -o - -w "`nstatus=%{http_code}`n" https://api.privatefleet.home.arpa/v1/public/tracking/not-a-real-token-0000000000
Write-Host "-- report range bound (no auth -> 401 expected) --"
curl.exe -sk -o - -w "`nstatus=%{http_code}`n" "https://api.privatefleet.home.arpa/v1/reports/delivery-performance?from=2020-01-01&to=2026-01-01"
Write-Host "-- geofences (no auth -> 401 expected) --"
curl.exe -sk -o - -w "`nstatus=%{http_code}`n" https://api.privatefleet.home.arpa/v1/geofences
Write-Host "-- web /track/... SPA route --"
curl.exe -sk -o - -w "`nstatus=%{http_code}`n" https://app.privatefleet.home.arpa/track/not-a-real-token-0000000000
