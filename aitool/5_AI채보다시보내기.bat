@echo off
chcp 65001 >nul
cd /d "%~dp0"
set PYTHONIOENCODING=utf-8
echo 이미 만든 AI 채보 원본(out 폴더)을 서버에 다시 보내요. 서버가 새 방식으로 다시 다듬어요. (1~2분, 그래픽카드 안 씀)
echo.
"%~dp0venv\Scripts\python.exe" -I "%~dp0tools\linkbeat_ai.py" --resend-all
echo.
pause
