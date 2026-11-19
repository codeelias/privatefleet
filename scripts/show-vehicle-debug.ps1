$m = Select-String -Path C:\privatefleet\logs\api.log -Pattern 'PF_DEBUG_VEHICLES' | Select-Object -Last 1
if ($m) {
  $text = $m.Line
  $idx = $text.IndexOf('PF_DEBUG_VEHICLES')
  $text.Substring($idx, [Math]::Min(1000, $text.Length - $idx))
} else {
  'no debug line'
}
