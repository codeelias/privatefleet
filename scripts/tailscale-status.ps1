$ErrorActionPreference = "Continue"
& "C:\Program Files\Tailscale\tailscale.exe" status *> C:\Temp\tailscale-status.log
Get-Content C:\Temp\tailscale-status.log
