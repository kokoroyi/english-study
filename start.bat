@echo off
setlocal
set "ELECTRON_RUN_AS_NODE="
if not defined ELECTRON_MIRROR set "ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/"
cd /d "%~dp0"

if not exist "out\main\index.js" (
  echo Build not found. Please double-click setup.bat first.
  pause
  exit /b 1
)

call npm start
