@echo off
echo Stopping GLB Viewer server...
taskkill /F /IM python.exe /T >nul 2>&1
if %errorlevel% equ 0 (
    echo Server stopped
) else (
    echo Server not running or failed to stop
)
pause
