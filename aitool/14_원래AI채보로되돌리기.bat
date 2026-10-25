@echo off
chcp 65001 >nul
cd /d "%~dp0"
set PYTHONIOENCODING=utf-8
echo 그 곡의 AI 채보를 원래 것(MuG로 만든 것, out 폴더)으로 다시 올려요. (그래픽카드 안 씀)
echo.
set "LINK="
set /p LINK=곡 링크나 ID: 
"%~dp0venv\Scripts\python.exe" -I "%~dp0tools\linkbeat_ai.py" --upload "%LINK%"
echo.
pause
