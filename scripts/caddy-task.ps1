$ErrorActionPreference="Continue"
schtasks /query /tn "PrivateFleet Caddy" /xml 2>&1 | Select-String -Pattern "<Triggers>|<BootTrigger|<LogonTrigger|<RestartOnFailure|<Enabled>|<Command>|<Arguments>|<WorkingDirectory>" | ForEach-Object { $_.Line.Trim() }
"--- last run ---"
schtasks /query /tn "PrivateFleet Caddy" /fo LIST /v 2>&1 | Select-String -Pattern "Last Run Time|Last Result|Status|Task To Run|Start In|Run As User|Schedule Type" | ForEach-Object { $_.Line.Trim() }
