@echo off
chcp 65001 >nul
cd /d "%~dp0"
set PYTHONIOENCODING=utf-8
echo 앞으로 새 곡의 AI 채보를 어떤 방식으로 만들지 골라요. (18번 속도 시험 결과를 보고 고르세요)
echo.
"%~dp0venv\Scripts\python.exe" -I "%~dp0tools\mapper_test.py" --mode
echo.
pause
