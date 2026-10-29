$ErrorActionPreference = 'Stop'
$secrets = Get-Content 'C:\PrivateFleet\secrets\secrets.json' -Raw | ConvertFrom-Json
$pg = 'C:\PostgreSQL\16\bin'
$jobs = if ($env:PG_RESTORE_JOBS) { [int]$env:PG_RESTORE_JOBS } else { 4 }
$stamp = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')
$dump = "C:\Temp\privatefleet-restore-$stamp.dump"
$restoreDb = 'privatefleet_full_restore'
$start = Get-Date

try {
    $env:PGPASSWORD = $secrets.owner
    & "$pg\pg_dump.exe" -h 127.0.0.1 -U privatefleet -Fc -d privatefleet -f $dump
    if ($LASTEXITCODE -ne 0) { throw 'pg_dump failed' }

    $env:PGPASSWORD = $secrets.super
    & "$pg\psql.exe" -h 127.0.0.1 -U postgres -d postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS $restoreDb;" | Out-Null
    & "$pg\psql.exe" -h 127.0.0.1 -U postgres -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE $restoreDb OWNER privatefleet;" | Out-Null
    & "$pg\psql.exe" -h 127.0.0.1 -U postgres -d $restoreDb -v ON_ERROR_STOP=1 -c 'CREATE EXTENSION IF NOT EXISTS postgis;' | Out-Null
    $restoreStart = Get-Date
    & "$pg\pg_restore.exe" -h 127.0.0.1 -U postgres -d $restoreDb --no-owner --exit-on-error --jobs=$jobs $dump 2> 'C:\Temp\privatefleet-restore-errors.log'
    $restoreExit = $LASTEXITCODE
    $restoreSeconds = [math]::Round(((Get-Date) - $restoreStart).TotalSeconds, 1)

    $counts = & "$pg\psql.exe" -h 127.0.0.1 -U postgres -d $restoreDb -tA -F '|' -c "select 'jobs='||count(*) from jobs; select 'routes='||count(*) from routes; select 'route_stops='||count(*) from route_stops; select 'location_points='||count(*) from location_points; select 'job_stops_geom='||count(*) from job_stops where location is not null; select 'evidence='||count(*) from stop_evidence;"
    $evidenceRows = & "$pg\psql.exe" -h 127.0.0.1 -U postgres -d $restoreDb -tA -F '|' -c "select storage_key, content_hash from stop_evidence;"
    $evidenceRoot = 'C:\Temp\privatefleet-restore-evidence'
    if (Test-Path $evidenceRoot) { Remove-Item $evidenceRoot -Recurse -Force }
    New-Item -ItemType Directory -Path $evidenceRoot -Force | Out-Null
    & tar.exe -cf 'C:\Temp\privatefleet-restore-evidence.tar' -C 'C:\PrivateFleet\evidence' .
    & tar.exe -xf 'C:\Temp\privatefleet-restore-evidence.tar' -C $evidenceRoot
    $matched = 0
    $failed = 0
    foreach ($row in $evidenceRows) {
        if ([string]::IsNullOrWhiteSpace($row)) { continue }
        $parts = $row.Split('|')
        $file = Join-Path $evidenceRoot ($parts[0] -replace '/', '\')
        if (-not (Test-Path $file)) { $failed += 1; continue }
        $actual = (Get-FileHash -Algorithm SHA256 -Path $file).Hash.ToLowerInvariant()
        if ($actual -eq $parts[1]) { $matched += 1 } else { $failed += 1 }
    }

    $grants = @"
GRANT USAGE ON SCHEMA public TO privatefleet_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO privatefleet_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO privatefleet_app;
"@
    $grants | & "$pg\psql.exe" -h 127.0.0.1 -U postgres -d $restoreDb -v ON_ERROR_STOP=1 | Out-Null
    $tenantA = (& "$pg\psql.exe" -h 127.0.0.1 -U postgres -d $restoreDb -tA -c "select tenant_id from jobs group by tenant_id order by count(*) desc limit 1").Trim()
    $tenantB = (& "$pg\psql.exe" -h 127.0.0.1 -U postgres -d $restoreDb -tA -c "select id from tenants where id <> '$tenantA' limit 1").Trim()
    $env:PGPASSWORD = $secrets.app
    $own = (& "$pg\psql.exe" -h 127.0.0.1 -U privatefleet_app -d $restoreDb -tA -c "select set_config('app.tenant_id','$tenantA',true); select count(*) from stop_evidence;" | Select-Object -Last 1).Trim()
    $foreign = (& "$pg\psql.exe" -h 127.0.0.1 -U privatefleet_app -d $restoreDb -tA -c "select set_config('app.tenant_id','$tenantA',true); select count(*) from stop_evidence where tenant_id='$tenantB';" | Select-Object -Last 1).Trim()

    $env:PGPASSWORD = $secrets.super
    & "$pg\psql.exe" -h 127.0.0.1 -U postgres -d postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE $restoreDb;" | Out-Null
    $rto = [math]::Round(((Get-Date) - $start).TotalSeconds, 1)

    Write-Output "PG_RESTORE_JOBS=$jobs"
    Write-Output "PG_RESTORE_EXIT=$restoreExit"
    Write-Output "RESTORE_SECONDS=$restoreSeconds"
    Write-Output "TOTAL_RTO_SECONDS=$rto"
    Write-Output "EVIDENCE_HASH_MATCHED=$matched HASH_FAILED=$failed"
    Write-Output "RUNTIME_OWN_EVIDENCE=$own RUNTIME_FOREIGN_EVIDENCE=$foreign"
    Write-Output "RESTORE_DB_DROPPED=yes"
    $counts
    if (Test-Path 'C:\Temp\privatefleet-restore-errors.log') {
        Write-Output "RESTORE_ERROR_LINES=$((Get-Content 'C:\Temp\privatefleet-restore-errors.log').Count)"
    }
} finally {
    $env:PGPASSWORD = ''
    Remove-Item $dump -Force -ErrorAction SilentlyContinue
    Remove-Item 'C:\Temp\privatefleet-restore-evidence.tar' -Force -ErrorAction SilentlyContinue
    Remove-Item 'C:\Temp\privatefleet-restore-evidence' -Recurse -Force -ErrorAction SilentlyContinue
}
