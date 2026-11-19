$m = Select-String -Path C:\privatefleet\logs\api.log -Pattern 'PF_VROOM_VEHICLES' | Select-Object -Last 1
if ($m) {
  $text = $m.Line
  $idx = $text.IndexOf('PF_VROOM_VEHICLES')
  $text.Substring($idx, [Math]::Min(700, $text.Length - $idx))
} else { 'no PF_VROOM_VEHICLES line' }
