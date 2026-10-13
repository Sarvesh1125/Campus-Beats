@echo off
REM Daily start. Tries to start the MongoDB Windows service (needs an Administrator prompt the first time), then runs the app.
cd /d "%~dp0"
net start MongoDB >nul 2>nul
start "" cmd /c "timeout /t 3 >nul & start http://localhost:3000"
call npm start
pause
