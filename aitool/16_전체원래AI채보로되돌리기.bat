@echo off
chcp 65001 >nul
cd /d "%~dp0"
set PYTHONIOENCODING=utf-8
echo 15번으로 새 AI 채보로 바꾼 곡을 전부 원래 AI 채보(MuG, out 폴더)로 다시 올려요. (그래픽카드 안 씀, 1~2분)
echo (13번으로 하나씩 바꾼 곡은 14번으로 곡마다 되돌려요)
echo.
"%~dp0venv\Scripts\python.exe" -I "%~dp0tools\mapper_test.py" --all-undo
echo.
pause
