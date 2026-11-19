Get-Content C:\Caddy\Caddyfile
Get-NetTCPConnection -State Listen -LocalPort 443 -ErrorAction SilentlyContinue | Select-Object LocalAddress,LocalPort,OwningProcess
