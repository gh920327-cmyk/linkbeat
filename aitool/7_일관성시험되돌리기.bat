@echo off
chcp 65001 >nul
cd /d "%~dp0"
set PYTHONIOENCODING=utf-8
echo 일관성 시험 전 AI 채보로 되돌려요. (그래픽카드 안 씀, 1분)
echo.
"%~dp0venv\Scripts\python.exe" -I "%~dp0tools\linkbeat_ai.py" --restore-test
echo.
pause
