@echo off
sc failure SharedAccess reset= 0 actions= ""
sc config SharedAccess start= disabled
sc stop SharedAccess
timeout /t 10 /nobreak
sc query SharedAccess
