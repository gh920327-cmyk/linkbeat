@echo off
chcp 65001 >nul
cd /d "%~dp0"
set PYTHONIOENCODING=utf-8
echo 채보 확인용 파일을 만들어요. (곡 채보 데이터 + AI 원본 후보, 기록·프로필은 안 넣음)
echo.
"%~dp0venv\Scripts\python.exe" -I "%~dp0tools\linkbeat_ai.py" --export
echo.
pause
