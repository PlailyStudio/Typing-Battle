@echo off
setlocal
cd /d "%~dp0"
where node.exe >nul 2>nul
if errorlevel 1 (
  echo Node.js is required. Install Node.js 22.12 or newer.
  echo https://nodejs.org/
  pause
  exit /b 1
)
if not exist "node_modules\vite\bin\vite.js" (
  echo Installing dependencies...
  call npm.cmd install --cache .npm-cache
  if errorlevel 1 (
    echo Installation failed. Check your internet connection.
    pause
    exit /b 1
  )
)
echo Starting TYPE / BATTLE...
echo Keep this window open while playing. Press Ctrl+C to stop.
call npm.cmd run dev -- --open
if errorlevel 1 pause
