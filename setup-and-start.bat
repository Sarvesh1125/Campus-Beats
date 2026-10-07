@echo off
REM First-time setup + start. Double-click this file (MongoDB service must be running).
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install the LTS version from https://nodejs.org and run this again.
  pause & exit /b 1
)
if not exist .env (
  copy .env.example .env >nul
  echo Created .env from .env.example
)
call npm install --omit=dev
if errorlevel 1 ( echo npm install failed. & pause & exit /b 1 )
call npm run migrate
if errorlevel 1 ( echo Migration failed. See README. & pause & exit /b 1 )
call npm run seed
if errorlevel 1 (
  echo Seeding failed. Is the MongoDB service running? See README - Troubleshooting.
  pause & exit /b 1
)
start "" cmd /c "timeout /t 3 >nul & start http://localhost:3000"
call npm start
pause
