$ErrorActionPreference="Stop"
$psql="C:\PostgreSQL\16\bin\psql.exe"
$createdb="C:\PostgreSQL\16\bin\createdb.exe"
$dropdb="C:\PostgreSQL\16\bin\dropdb.exe"
$pgrestore="C:\PostgreSQL\16\bin\pg_restore.exe"
$s=Get-Content C:\privatefleet\secrets\secrets.json | ConvertFrom-Json
$env:PGPASSWORD=$s.super
$backup="C:\PrivateFleet\backups\pre-retire-load-20261101-230125.dump"
$db="privatefleet_restore_verify"
if (-not (Test-Path $backup)) { throw "backup missing" }
& $dropdb -U postgres -h 127.0.0.1 --if-exists $db
& $createdb -U postgres -h 127.0.0.1 -O privatefleet $db
$sw=[System.Diagnostics.Stopwatch]::StartNew()
& $pgrestore -U postgres -h 127.0.0.1 -d $db --no-owner --no-privileges --exit-on-error --jobs=4 $backup 2>&1 | Tee-Object -Variable restoreOut
$sw.Stop()
"restore_seconds=$([math]::Round($sw.Elapsed.TotalSeconds,1))"
"restore_exit=$LASTEXITCODE"
& $psql -U postgres -h 127.0.0.1 -d $db -P pager=off -c "SELECT count(*) AS jobs FROM jobs; SELECT count(*) AS routes FROM routes; SELECT count(*) AS stops FROM job_stops; SELECT count(*) AS points FROM location_points; SELECT count(*) AS evidence FROM stop_evidence; SELECT count(*) AS policies FROM dispatch_policies;"
& $psql -U postgres -h 127.0.0.1 -d $db -P pager=off -c "SELECT count(*) AS geom_stops FROM job_stops WHERE location IS NOT NULL; SELECT count(*) AS rls_tables FROM pg_class WHERE relrowsecurity AND relnamespace='public'::regnamespace;"
& $dropdb -U postgres -h 127.0.0.1 $db
"dropped=$db"
