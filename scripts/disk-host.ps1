Get-PSDrive C | Select-Object Name,@{n="UsedGB";e={[math]::Round($_.Used/1GB,2)}},@{n="FreeGB";e={[math]::Round($_.Free/1GB,2)}}
Get-ChildItem C:\PrivateFleet\backups -File -ErrorAction SilentlyContinue | Sort-Object Length -Descending | Select-Object -First 5 Name,@{n="GB";e={[math]::Round($_.Length/1GB,2)}},LastWriteTime
Get-ChildItem C:\PrivateFleet\logs -File -ErrorAction SilentlyContinue | Sort-Object Length -Descending | Select-Object -First 5 Name,@{n="MB";e={[math]::Round($_.Length/1MB,1)}}
