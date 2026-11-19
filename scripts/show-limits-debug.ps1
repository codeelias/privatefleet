$m = Select-String -Path C:\privatefleet\logs\api.log -Pattern 'PF_LIMITS' | Select-Object -Last 1
if ($m) {
  $text = $m.Line
  $idx = $text.IndexOf('PF_LIMITS')
  $text.Substring($idx, [Math]::Min(900, $text.Length - $idx))
} else { 'no PF_LIMITS line' }
