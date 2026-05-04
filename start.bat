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
echo Server stopped.
endlocal
rem `exit` (not `exit /b`) terminates the cmd shell itself so the
rem window closes when the user clicks Shutdown in the web UI.
exit
