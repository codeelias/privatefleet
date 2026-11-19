$ErrorActionPreference = "Continue"
Get-Content C:\PrivateFleet\logs\api.log -Tail 120 | Select-String -Pattern 'error|Error|dispatch_policy|vehicle_id|uuid' | Select-Object -Last 10 | ForEach-Object { $_.Line }
