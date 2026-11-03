@echo off
cd /d "%~dp0"
if exist "web.exe" (
  "web.exe" --port 4173
  goto failed
)
if not exist "target\release\web.exe" (
  cargo build --release --bin web
  if errorlevel 1 goto failed
)
echo Neko Rust backend: http://127.0.0.1:4173
"target\release\web.exe" --port 4173
:failed
pause
