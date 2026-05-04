@echo off
taskkill /f /im explorer.exe
cd /d %userprofile%\AppData\Local
del IconCache.db /a
cd /d %userprofile%\AppData\Local\Microsoft\Windows\Explorer
del iconcache* /a
start explorer.exe
