$ErrorActionPreference="Continue"
$task = Get-ScheduledTask -TaskName "PrivateFleet Caddy"
$settings = $task.Settings
$settings.RestartCount = 3
$settings.RestartInterval = "PT1M"
$settings.ExecutionTimeLimit = "PT0S"
$settings.DisallowStartIfOnBatteries = $false
$settings.StopIfGoingOnBatteries = $false
$settings.StartWhenAvailable = $true
Set-ScheduledTask -TaskName "PrivateFleet Caddy" -Settings $settings | Out-Null
(Get-ScheduledTask -TaskName "PrivateFleet Caddy").Settings | Select-Object RestartCount,RestartInterval,ExecutionTimeLimit,StartWhenAvailable | Format-List
