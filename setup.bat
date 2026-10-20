@echo off
setlocal EnableExtensions
cd /d "%~dp0"

set "AUTO=0"
if /I "%~1"=="--auto" set "AUTO=1"

echo ============================================================
echo  English Study - one-time setup
echo ============================================================
echo.

where node >nul 2>nul
if errorlevel 1 goto :no_node

for /f "delims=" %%v in ('node -p "process.versions.node"') do set "NODE_VERSION=%%v"
echo [check] Node.js %NODE_VERSION%
node -e "const v=process.versions.node.split('.').map(Number);process.exit(v[0]>22||(v[0]===22&&v[1]>=12)?0:1)"
if errorlevel 1 goto :old_node

if not exist "node_modules\electron\package.json" (
  echo [1/3] Installing dependencies ^(npm ci^)...
  call npm ci --no-audit --no-fund
  if errorlevel 1 (
    echo [warn] npm ci failed, retrying with npm install...
    call npm install --no-audit --no-fund
    if errorlevel 1 goto :npm_failed
  )
) else (
  echo [1/3] Dependencies already installed.
)

if not exist "data\stardict.db" (
  echo [2/3] Downloading ECDICT dictionary ^(~207 MB, first run only^)...
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\setup-dict.ps1"
  if errorlevel 1 goto :dict_failed
) else (
  echo [2/3] Dictionary already present.
)

if not exist "out\main\index.js" (
  echo [3/3] Building application...
  call npm run build
  if errorlevel 1 goto :build_failed
) else (
  echo [3/3] Build already present.
)

echo.
echo ============================================================
echo  Setup complete.
echo  Double-click start.bat to launch English Study.
echo ============================================================
if "%AUTO%"=="1" goto :done
choice /C YN /M "Launch now"
if errorlevel 2 goto :done
call start.bat
goto :done

:no_node
echo [ERROR] Node.js not found.
echo Install Node.js 22 LTS or newer from https://nodejs.org/
echo Keep "Add to PATH" enabled during installation, then run setup.bat again.
goto :fail
:old_node
echo [ERROR] Node.js 22.12.0 or newer is required. Current: %NODE_VERSION%
echo Download: https://nodejs.org/
goto :fail
:npm_failed
echo [ERROR] Failed to install npm dependencies.
echo Check your network or proxy, then run setup.bat again.
goto :fail
:dict_failed
echo [ERROR] Failed to download or verify the ECDICT dictionary.
echo You can download it manually:
echo   https://github.com/skywind3000/ECDICT/releases/download/1.0.28/ecdict-sqlite-28.zip
echo Extract stardict.db to: %~dp0data\stardict.db
goto :fail
:build_failed
echo [ERROR] Build failed.
echo Run "npm run build" in this folder to see details.
goto :fail
:fail
if "%AUTO%"=="0" pause
exit /b 1
:done
if "%AUTO%"=="0" pause
exit /b 0
