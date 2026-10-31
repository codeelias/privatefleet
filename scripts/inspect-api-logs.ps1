$ErrorActionPreference = "Continue"
Get-ChildItem C:\privatefleet\logs | Sort-Object LastWriteTime -Descending |
  Select-Object -First 6 Name, Length, LastWriteTime | Format-Table -AutoSize
foreach ($f in Get-ChildItem C:\privatefleet\logs -File | Sort-Object LastWriteTime -Descending | Select-Object -First 2) {
  Write-Host "=== $($f.Name) ==="
  Get-Content $f.FullName -Tail 35
}
