@echo off
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js is not installed. Get the LTS version from https://nodejs.org and run this again. & pause & exit /b 1)
if not exist "client\EvonyClient1921.swf" (echo Copy EvonyClient1921.swf into the client folder first. & pause & exit /b 1)
title Evony local server
node src\server.js
pause
