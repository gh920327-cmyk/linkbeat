@echo off
chcp 65001 >nul
cd /d "%~dp0"
set PYTHONIOENCODING=utf-8
echo 속도 시험 때 올린 1번 방식 채보를 원래 AI 채보로 되돌려요.
echo.
"%~dp0venv\Scripts\python.exe" -I "%~dp0tools\mapper_test.py" --speed-undo
echo.
pause
