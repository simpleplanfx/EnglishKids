@echo off
REM ============================================================
REM  EnglishKids APK - One-Click Local Build
REM
REM  IMPORTANT: This file MUST stay pure ASCII.
REM  cmd.exe reads .bat files using the system codepage (GBK/936
REM  on Chinese Windows). Any non-ASCII byte (e.g. UTF-8 Chinese)
REM  will be mis-decoded and produce errors like
REM  "'xxx' is not recognized as an internal or external command".
REM  All Chinese output is produced by the PowerShell script below.
REM ============================================================

cd /d "%~dp0"

echo ===============================================
echo   EnglishKids APK - One-Click Local Build
echo ===============================================
echo.
echo  This will download JDK 17 + Android SDK (~1GB on
echo  first run) and compile app-debug.apk.
echo.
echo  - Keep your network connected
echo  - Do NOT close this window
echo  - Already-downloaded parts are skipped on re-run
echo.
echo  Chinese progress messages appear in the
echo  PowerShell console below.
echo.
echo  Starting build...
echo.

powershell -ExecutionPolicy Bypass -NoProfile -File "%~dp0build_apk.ps1"

echo.
if errorlevel 1 (
  echo  BUILD FAILED - see the messages above.
) else (
  echo  BUILD FINISHED.
)
echo.
echo  Press any key to exit...
pause >nul
