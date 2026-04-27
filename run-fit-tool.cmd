@echo off
setlocal
cd /d "%~dp0"

set "NODE_DIR=%~dp0node-v24.12.0-win-x64"
if exist "%NODE_DIR%\node.exe" (
  echo Using bundled Node from "%NODE_DIR%" ...
  set "PATH=%NODE_DIR%;%NODE_DIR%\node_modules\npm\bin;%PATH%"
)

if not exist node_modules (
  echo Installing dependencies...
  npm install
  if errorlevel 1 (
    echo npm install failed. Press any key to exit.
    pause >nul
    exit /b 1
  )
)

echo Starting FIT web tool on http://localhost:3000 ...
npm start

endlocal
