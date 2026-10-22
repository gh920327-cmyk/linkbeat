@echo off
chcp 65001 >nul
cd /d "%~dp0"
set PYTHONIOENCODING=utf-8
echo 채보 점검 그림: 노래 소리 위에 AI 채보·기존 채보를 겹쳐 그려요. (spectro 폴더, 1~2분)
echo.
set "LINK="
set /p LINK=곡 링크나 ID: 
set "DIFFS="
set /p DIFFS=난이도 (그냥 엔터 = hard,extreme / 예: normal,hard): 
if "%DIFFS%"=="" set "DIFFS=hard,extreme"
"%~dp0venv\Scripts\python.exe" -I "%~dp0tools\linkbeat_ai.py" --spectro "%LINK%" --diffs %DIFFS%
echo.
pause
