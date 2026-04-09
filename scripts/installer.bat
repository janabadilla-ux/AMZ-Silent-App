@echo off
:: AllStars Tracker — Silent Installer
:: Usage: installer.bat  (no arguments needed — same for every laptop)
::
:: The app registers itself by MAC address on first run.
:: Admin then assigns the employee in the AMZ Attendance web portal.
:: Employee never sees any window or prompt.

setlocal

:: ── Supabase & portal credentials (baked in — same for all installs) ──────
set "SUPABASE_URL=https://varhlvyhvfufuxjqnfwq.supabase.co"
set "SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZhcmhsdnlodmZ1ZnV4anFuZndxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU0OTg0ODgsImV4cCI6MjA5MTA3NDQ4OH0.lPtEsiKhSU0_ZUITtO-ZMaG71Zi1i3BIqBITy590JEY"
set "PORTAL_URL=https://amzallstars.ph"
set "INSTALLER_URL=https://YOUR_HOST/AllStars-Tracker-Setup.exe"

:: ── Download installer ─────────────────────────────────────────────────────
set "TMP=%TEMP%\allstars-setup-%RANDOM%.exe"
echo Downloading AllStars Tracker...
powershell -NoProfile -Command "Invoke-WebRequest -Uri '%INSTALLER_URL%' -OutFile '%TMP%' -UseBasicParsing"
if errorlevel 1 ( echo ERROR: Download failed. & exit /b 1 )

:: ── Silent install ─────────────────────────────────────────────────────────
echo Installing silently...
"%TMP%" /S
if errorlevel 1 ( echo ERROR: Install failed. & del /f /q "%TMP%" 2>nul & exit /b 1 )
del /f /q "%TMP%" 2>nul

:: ── Write .env config ─────────────────────────────────────────────────────
set "APP_DIR=%LOCALAPPDATA%\allstars-tracker"
if not exist "%APP_DIR%" mkdir "%APP_DIR%"
(
  echo SUPABASE_URL=%SUPABASE_URL%
  echo SUPABASE_ANON_KEY=%SUPABASE_ANON_KEY%
  echo PORTAL_URL=%PORTAL_URL%
) > "%APP_DIR%\.env"

:: ── Launch app ─────────────────────────────────────────────────────────────
set "APP_PATH=%LOCALAPPDATA%\Programs\allstars-tracker\AllStars Tracker.exe"
if exist "%APP_PATH%" (
  start "" "%APP_PATH%"
  echo.
  echo Done. AllStars Tracker installed and running.
  echo This device will appear in AMZ Attendance under "Inactive Computers".
  echo Assign the employee in the web portal to activate tracking.
) else (
  echo Install complete. App will start on next login.
)

endlocal
exit /b 0
