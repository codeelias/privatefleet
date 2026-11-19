$ErrorActionPreference = "Continue"
docker rm -f privatefleet-dns 2>$null | Out-Null
docker run -d --name privatefleet-dns --restart unless-stopped `
  -p 53:53/udp -p 53:53/tcp `
  -v C:/PrivateFleet/dns/dnsmasq.conf:/etc/dnsmasq.conf:ro `
  4km3/dnsmasq:latest
Start-Sleep -Seconds 5
docker ps --format '{{.Names}} | {{.Image}} | {{.Status}} | {{.Ports}}' | Select-String dnsmasq
Write-Host "--- logs ---"
docker logs privatefleet-dns --tail 15
Write-Host "--- resolve via 127.0.0.1 ---"
nslookup app.privatefleet.home.arpa 127.0.0.1
nslookup api.privatefleet.home.arpa 127.0.0.1
