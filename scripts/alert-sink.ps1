$ErrorActionPreference="Continue"
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://127.0.0.1:9099/")
$listener.Start()
$ctx = $listener.GetContext()
$reader = New-Object System.IO.StreamReader($ctx.Request.InputStream)
$body = $reader.ReadToEnd()
Set-Content -Path C:\PrivateFleet\logs\alert-received.json -Value $body -Encoding utf8
$ctx.Response.StatusCode = 204
$ctx.Response.Close()
$listener.Stop()
