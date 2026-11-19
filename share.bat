@echo off
title CRM Online Share (Pinggy)
cd /d "%~dp0"
cls
echo ====================================================================
echo             CRM Online Share - مشاركة المشروع أونلاين
echo ====================================================================
echo.
echo [1] Checking local server...
echo.
netstat -ano | findstr :3000 | findstr LISTENING > nul
if %errorlevel% neq 0 (
    echo [*] Starting local CRM server on port 3000...
    start "CRM Local Server" /b node server.js
    timeout /t 2 /nobreak > nul
) else (
    echo [*] CRM server is active on port 3000.
)
echo.
echo ====================================================================
echo [2] Connecting to Tunnel (Pinggy)...
echo.
echo   - Wait 2-3 seconds for your Public URL to appear below.
echo   - Copy the "https://....pinggy.link" link and send it to anyone!
echo   - The other person can open it directly (NO PASSWORD NEEDED).
echo   - Keep this window open while sharing.
echo ====================================================================
echo.
ssh -p 443 -R0:localhost:3000 -o StrictHostKeyChecking=no -o ServerAliveInterval=30 a.pinggy.io
pause
