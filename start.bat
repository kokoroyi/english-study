@echo off
setlocal
cd /d "%~dp0"

if not exist "out\main\index.js" (
  echo Build not found. Please double-click setup.bat first.
  pause
  exit /b 1
)

call npm start
