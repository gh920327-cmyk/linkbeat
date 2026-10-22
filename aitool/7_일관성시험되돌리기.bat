@echo off
chcp 65001 >nul
cd /d "%~dp0"
set PYTHONIOENCODING=utf-8
echo AI 채보를 새로 만들기 전 것으로 되돌려요. (그래픽카드 안 씀)
echo  - 되돌릴 곡의 유튜브 링크나 ID를 넣으면 그 곡만 (여러 곡은 띄어쓰기로)
echo  - 그냥 엔터: '전체 새로 만들기'로 만든 곡 전부 (Emergency, Ticking Away, 열 달 아흐레는 그대로)
echo.
set "IDS="
set /p IDS=곡 링크나 ID: 
"%~dp0venv\Scripts\python.exe" -I "%~dp0tools\linkbeat_ai.py" --restore-test %IDS%
echo.
pause
