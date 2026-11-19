$ErrorActionPreference = "Continue"
$exe = "C:\Program Files\Tailscale\tailscale.exe"
& $exe serve --bg --https=443 http://127.0.0.1:4000 *> C:\Temp\tailscale-serve.log
& $exe serve status *>> C:\Temp\tailscale-serve.log
& $exe status *>> C:\Temp\tailscale-serve.log
