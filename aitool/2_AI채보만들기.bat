@echo off
chcp 65001 >nul
cd /d "%~dp0"
set PYTHONIOENCODING=utf-8
if not exist "%~dp0venv\Scripts\python.exe" (
  echo [!] 1_설치.bat 을 먼저 실행해 주세요.
  pause
  exit /b 1
)
"%~dp0venv\Scripts\python.exe" -I "%~dp0tools\linkbeat_ai.py" %*
echo.
pause
