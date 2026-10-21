@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Push SKINLAB to GitHub

set "REPO_URL=%~1"
if "%REPO_URL%"=="" set /p "REPO_URL=Enter GitHub repository URL: "
if "%REPO_URL%"=="" (
  echo No repository URL provided.
  pause
  exit /b 1
)

git remote remove origin >nul 2>nul
git remote add origin "%REPO_URL%"
git push -u origin main

if errorlevel 1 (
  echo.
  echo Push failed. Check the repository URL and GitHub login, then try again.
) else (
  echo.
  echo Push succeeded. Next: create a Render Blueprint from this repository.
)
pause
