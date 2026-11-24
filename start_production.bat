@echo off
title CRM Production Server
chcp 65001 > nul
cd /d "%~dp0"
cls

echo ========================================================
echo       منظومة إدارة العملاء والمبيعات CRM
echo       النسخة الإنتاجية الرسمية (Production Mode)
echo ========================================================
echo.

:: إضافة مسار Node.js المحلي إن وجد
if exist "%LOCALAPPDATA%\Programs\nodejs" (
    set "PATH=%LOCALAPPDATA%\Programs\nodejs;%PATH%"
)

:: فحص توفر Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [خطأ] بيئة Node.js غير مثبتة أو غير موجودة في الـ PATH!
    echo يرجى التأكد من تثبيت Node.js v18 فما فوق.
    pause
    exit /b 1
)

:: فحص وتثبيت الحزم إن لزم
if not exist "node_modules" (
    echo [*] جاري تثبيت الحزم والمكتبات اللازمة...
    call npm install --omit=dev
)

:: ضبط بيئة الإنتاج
set NODE_ENV=production

echo.
echo [*] جاري تشغيل خادم السي آر إم...
echo [✓] سيتم فتح المتصفح تلقائياً على الرابط: http://localhost:3000
echo.

:: فتح المتصفح بعد ثانيتين في الخلفية
start "" /b cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:3000"

:: تشغيل السيرفر
node server.js
pause
