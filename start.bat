@echo off
cd /d "%~dp0"
rem ใส่ค่าหลังเครื่องหมาย = ในบรรทัดเดียว ห้ามเว้นวรรคหรือขึ้นบรรทัดใหม่
set TURN_KEY_ID=PUT_KEY_ID_HERE
set TURN_KEY_API_TOKEN=PUT_TOKEN_HERE
node server.js
pause
