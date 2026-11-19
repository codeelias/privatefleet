$lines = Select-String -Path C:\PrivateFleet\logs\api.log -Pattern 'req-hj' | Select-Object -Last 4
foreach ($line in $lines) { $line.Line.Substring(0, [Math]::Min(400, $line.Line.Length)) }
