@echo off
setlocal
cd /d "%~dp0"

if not exist "node_modules" (
  echo Installing dependencies...
  call npm install --no-fund --no-audit
  if errorlevel 1 (
    echo npm install failed.
    pause
    exit /b 1
  )
)

start "" "http://localhost:9000"
node server.js
endlocal
