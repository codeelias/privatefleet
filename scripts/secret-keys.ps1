$s=Get-Content C:\privatefleet\secrets\secrets.json | ConvertFrom-Json
$s.PSObject.Properties.Name
