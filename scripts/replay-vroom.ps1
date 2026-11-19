$ErrorActionPreference = "Continue"
curl.exe -s -m 60 -X POST http://127.0.0.1:3000 -H "content-type: application/json" --data-binary "@C:/Temp/vroom-last.json" -o C:\Temp\vroom-replay.json
$r = Get-Content C:\Temp\vroom-replay.json -Raw | ConvertFrom-Json
Write-Host "code=$($r.code) unassigned=$($r.unassigned.Count)"
foreach ($route in $r.routes) {
  $stops = $route.steps.Count
  Write-Host "vehicle=$($route.vehicle) duration=$($route.duration) distance=$($route.distance) stops=$stops"
}
Write-Host "--- body vehicles ---"
$b = Get-Content C:\Temp\vroom-last.json -Raw | ConvertFrom-Json
$b.vehicles | ConvertTo-Json -Compress
