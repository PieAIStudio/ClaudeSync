@echo off
setlocal
cd /d "%~dp0"
where py >nul 2>&1
if %errorlevel%==0 (
  py -3 sync_gui.py %*
) else (
  python sync_gui.py %*
)
