@echo off
chcp 65001 >nul
cd /d "%~dp0"
set PYTHONIOENCODING=utf-8
echo 같은 곡을 세 가지 방식으로 AI 채보를 만들어서 걸린 시간을 비교해요.
echo   지금 방식 / 2번(난이도 묶어서) / 1번(곡 조각 한꺼번에)
echo 곡 하나에 15~20분쯤 걸려요. 게임을 안 할 때 켜 두세요.
echo 엔진이 다른 채보를 만드는 중이거나 게임 중이면 끝날 때까지 기다렸다가 시작해요.
echo 끝나면 1번 방식 채보를 그 곡에 올려 둬요 (지금 AI 채보는 보관 - 19번으로 되돌려요).
echo.
set "LINK="
set /p LINK=곡 링크나 ID (여러 개는 띄어서, 그냥 Enter = 최근 AI 채보 2곡): 
"%~dp0venv\Scripts\python.exe" -I "%~dp0tools\mapper_test.py" --speed "%LINK%"
echo.
pause
