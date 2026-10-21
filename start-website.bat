@echo off
chcp 65001 >nul
cd /d "%~dp0"
title SKINLAB Launcher

set "NODE_EXE=node"
where node >nul 2>nul
if errorlevel 1 set "NODE_EXE=C:\Users\Administrator\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"

if /I not "%NODE_EXE%"=="node" if not exist "%NODE_EXE%" (
  echo Node.js not found.
  echo Please install Node.js or update NODE_EXE in this file.
  pause
  exit /b 1
)

start "SKINLAB Server" /D "%~dp0" "%NODE_EXE%" server.js
timeout /t 1 /nobreak >nul
start "" "http://127.0.0.1:4173"
exit /b 0
