@echo off
chcp 65001 >nul
cd /d "%~dp0"
set PYTHONIOENCODING=utf-8
echo 새 AI(Mapperatorinator)로 곡 하나의 AI 채보를 만들어서 올려요. (그래픽카드 사용, 곡 하나 7~8분)
echo 지금 AI 채보(MuG)는 out 폴더에 그대로 있어서, 14_원래AI채보로되돌리기.bat 으로 언제든 돌아갈 수 있어요.
echo.
set "LINK="
set /p LINK=곡 링크나 ID: 
"%~dp0venv\Scripts\python.exe" -I "%~dp0tools\mapper_test.py" --try "%LINK%"
echo.
pause
