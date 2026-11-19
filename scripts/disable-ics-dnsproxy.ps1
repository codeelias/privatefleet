$ErrorActionPreference = "Continue"
$key = 'HKLM:\SYSTEM\CurrentControlSet\Services\SharedAccess\Parameters'
$before = (Get-ItemProperty -Path $key -Name EnableDNSProxy -ErrorAction SilentlyContinue).EnableDNSProxy
Write-Host "before=$before"
Set-ItemProperty -Path $key -Name EnableDNSProxy -Value 0 -Type DWord
Restart-Service SharedAccess -Force -ErrorAction Continue
Start-Sleep -Seconds 5
Write-Host "SharedAccess=$((Get-Service SharedAccess).Status)"
Get-NetUDPEndpoint -LocalPort 53 -ErrorAction SilentlyContinue | ForEach-Object {
  $proc = Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue
  "udp53 $($_.LocalAddress) pid=$($_.OwningProcess) $($proc.ProcessName)"
}
