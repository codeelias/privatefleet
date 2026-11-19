@echo off
reg add "HKLM\SYSTEM\CurrentControlSet\Services\SharedAccess" /v Start /t REG_DWORD /d 4 /f
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":53 " ^| findstr "UDP"') do taskkill /F /PID %%p
timeout /t 8 /nobreak
sc query SharedAccess
