$ErrorActionPreference = "Continue"
$exe = "C:\Program Files\Tailscale\tailscale.exe"
& $exe up --hostname=pf-node --accept-dns=false *> C:\Temp\tailscale-up.log
