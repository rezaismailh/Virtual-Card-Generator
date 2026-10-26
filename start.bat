@echo off
REM Jalankan dashboard lalu buka di browser. Pakai "start.bat demo" untuk mode data palsu.
cd /d "%~dp0"
if /i "%1"=="demo" (
  start "" http://localhost:3000
  node server.js --mock
) else (
  if not exist .env (
    echo File .env belum ada. Salin .env.example ke .env lalu isi KRIPICARD_API_KEY.
    pause
    exit /b 1
  )
  start "" http://localhost:3000
  node server.js
)
