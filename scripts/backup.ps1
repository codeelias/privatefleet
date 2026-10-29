$ErrorActionPreference = 'Stop'
$secrets = Get-Content 'C:\PrivateFleet\secrets\secrets.json' -Raw | ConvertFrom-Json
$agePub = (Get-Content 'C:\PrivateFleet\secrets\age.pub' -Raw).Trim()
$age = (Get-ChildItem 'C:\age' -Recurse -Filter 'age.exe' | Select-Object -First 1).FullName
$pgDump = 'C:\PostgreSQL\16\bin\pg_dump.exe'
$stamp = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')
$plain = "C:\Temp\privatefleet-$stamp.dump"
$cipher = "C:\Temp\privatefleet-$stamp.dump.age"
$checksum = "$cipher.sha256"
$evidenceDir = 'C:\PrivateFleet\evidence'
$evidencePlain = "C:\Temp\privatefleet-$stamp.evidence.tar"
$evidenceCipher = "C:\Temp\privatefleet-$stamp.evidence.tar.age"
$evidenceChecksum = "$evidenceCipher.sha256"
$log = 'C:\PrivateFleet\logs\backup.log'
New-Item -ItemType Directory -Path 'C:\PrivateFleet\logs' -Force | Out-Null
$stage = 'start'

try {
    $env:PGPASSWORD = $secrets.owner
    $stage = 'pg_dump'
    & $pgDump -h 127.0.0.1 -U privatefleet -Fc -d privatefleet -f $plain
    if ($LASTEXITCODE -ne 0) { throw 'pg_dump failed' }

    $stage = 'age_encrypt'
    & $age -r $agePub -o $cipher $plain
    if ($LASTEXITCODE -ne 0) { throw 'age encryption failed' }
    Remove-Item $plain -Force
    $hash = (Get-FileHash -Algorithm SHA256 -Path $cipher).Hash.ToLowerInvariant()
    Set-Content -Path $checksum -Value "$hash  $(Split-Path $cipher -Leaf)" -Encoding ascii

    $stage = 'evidence_archive'
    New-Item -ItemType Directory -Path $evidenceDir -Force | Out-Null
    & tar.exe -cf $evidencePlain -C $evidenceDir .
    if ($LASTEXITCODE -ne 0) { throw 'evidence tar failed' }
    & $age -r $agePub -o $evidenceCipher $evidencePlain
    if ($LASTEXITCODE -ne 0) { throw 'evidence encryption failed' }
    Remove-Item $evidencePlain -Force
    $evidenceHash = (Get-FileHash -Algorithm SHA256 -Path $evidenceCipher).Hash.ToLowerInvariant()
    Set-Content -Path $evidenceChecksum -Value "$evidenceHash  $(Split-Path $evidenceCipher -Leaf)" -Encoding ascii

    $stage = 'copy_local'
    $targets = @('D:\PrivateFleet_Backups')
    New-Item -ItemType Directory -Path 'D:\PrivateFleet_Backups' -Force | Out-Null
    Copy-Item $cipher, $checksum, $evidenceCipher, $evidenceChecksum -Destination 'D:\PrivateFleet_Backups' -Force

    $stage = 'copy_cloud'
    try {
        if (Test-Path 'G:\My Drive') {
            New-Item -ItemType Directory -Path 'G:\My Drive\PrivateFleet_Backups' -Force | Out-Null
            Copy-Item $cipher, $checksum, $evidenceCipher, $evidenceChecksum -Destination 'G:\My Drive\PrivateFleet_Backups' -Force
            $targets += 'G:\My Drive\PrivateFleet_Backups'
        }
    } catch {
        Add-Content -Path $log -Value "$(Get-Date -Format o) WARN cloud copy unavailable: $($_.Exception.Message)"
    }

    $stage = 'prune'
    Get-ChildItem 'D:\PrivateFleet_Backups' -Include '*.age' -File -ErrorAction SilentlyContinue |
        Where-Object LastWriteTime -lt (Get-Date).AddDays(-30) | Remove-Item -Force

    Add-Content -Path $log -Value "$(Get-Date -Format o) OK db=$(Split-Path $cipher -Leaf) evidence=$(Split-Path $evidenceCipher -Leaf) db_sha256=$hash evidence_sha256=$evidenceHash targets=$($targets -join ',')"
    Write-Output "BACKUP_OK=$cipher"
    Write-Output "DB_SHA256=$hash"
    Write-Output "EVIDENCE_BACKUP=$evidenceCipher"
    Write-Output "EVIDENCE_SHA256=$evidenceHash"
    Write-Output "TARGETS=$($targets -join ',')"
} catch {
    Add-Content -Path $log -Value "$(Get-Date -Format o) FAIL stage=$stage $($_.Exception.Message)"
    Write-Output "BACKUP_FAIL stage=$stage $($_.Exception.Message)"
    exit 1
}
