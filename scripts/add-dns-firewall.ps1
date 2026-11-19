$ErrorActionPreference = "Continue"
$rules = @(
  @{ Name = "PrivateFleet DNS UDP"; Protocol = "UDP" },
  @{ Name = "PrivateFleet DNS TCP"; Protocol = "TCP" }
)
foreach ($rule in $rules) {
  Remove-NetFirewallRule -DisplayName $rule.Name -ErrorAction SilentlyContinue
  New-NetFirewallRule -DisplayName $rule.Name -Direction Inbound -Action Allow -Protocol $rule.Protocol -LocalPort 53 -Profile Any | Out-Null
  Write-Host "added $($rule.Name)"
}
Get-NetFirewallRule -DisplayName "PrivateFleet DNS*" | Select-Object DisplayName, Enabled, Direction, Action
