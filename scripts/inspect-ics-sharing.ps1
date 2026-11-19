$ErrorActionPreference = "Continue"
try {
  $m = New-Object -ComObject HNetCfg.HNetShare
  foreach ($conn in $m.EnumEveryConnection) {
    $props = $m.NetConnectionProps($conn)
    $cfg = $m.INetSharingConfigurationForINetConnection($conn)
    "$($props.Name) | sharing=$($cfg.SharingEnabled) | public=$($cfg.SharingConnectionType)"
  }
} catch {
  "COM failed: $($_.Exception.Message)"
}
Write-Host "--- service config ---"
sc.exe qc SharedAccess
