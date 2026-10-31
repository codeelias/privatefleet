# Installs the debug driver APK on physical Android devices and prepares
# them for the acceptance run. Emulators are excluded.
param(
  [string]$ApkPath = "C:\Temp\privatefleet-phone.apk",
  [string]$Adb = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"
)
$ErrorActionPreference = "Continue"
if (-not (Test-Path $ApkPath)) { throw "APK not found: $ApkPath" }

$devices = & $Adb devices | Select-String -Pattern "device$" | ForEach-Object {
  ($_ -split "\s+")[0]
} | Where-Object { $_ -and $_ -notlike "*emulator*" }

if (-not $devices) { throw "no physical devices attached" }
"physical devices: $($devices -join ', ')"

foreach ($dev in $devices) {
  "=== $dev ==="
  & $Adb -s $dev shell getprop ro.product.model | ForEach-Object { "model: $_" }
  & $Adb -s $dev shell getprop ro.build.version.release | ForEach-Object { "android: $_" }
  & $Adb -s $dev reverse tcp:4000 tcp:4000 | Out-Null
  & $Adb -s $dev install -r $ApkPath 2>&1 | Select-Object -Last 1
  & $Adb -s $dev shell pm grant com.privatefleet.driver android.permission.ACCESS_FINE_LOCATION 2>&1 | Select-Object -First 1
  & $Adb -s $dev shell pm grant com.privatefleet.driver android.permission.ACCESS_COARSE_LOCATION 2>&1 | Select-Object -First 1
  & $Adb -s $dev shell pm grant com.privatefleet.driver android.permission.CAMERA 2>&1 | Select-Object -First 1
  & $Adb -s $dev shell pm grant com.privatefleet.driver android.permission.POST_NOTIFICATIONS 2>&1 | Select-Object -First 1
  & $Adb -s $dev shell svc power stayon true 2>&1 | Select-Object -First 1
  & $Adb -s $dev shell am start -n com.privatefleet.driver/.MainActivity 2>&1 | Select-Object -First 1
}
"done"
