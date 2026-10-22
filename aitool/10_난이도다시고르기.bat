@echo off
chcp 65001 >nul
cd /d "%~dp0"
set PYTHONIOENCODING=utf-8
echo 난이도를 '쳐야 하는 기술'로 다시 골라요. (이미 만든 AI 후보에서 다시 고름 · 그래픽카드 안 씀 · 곡마다 몇 초)
echo  - 쉬움: 박자 / 보통: +8분·2개 동시 / 어려움: +16분 / 극한: +긴 연속·3개 동시·연타 (위 난이도엔 새 기술이 꼭 하나 더)
echo  - 다시 고를 곡의 유튜브 링크나 ID를 넣으면 그 곡만 (여러 곡은 띄어쓰기로)
echo  - 그냥 엔터: AI 채보가 있는 곡 전부
echo  지금 AI 채보는 backup_repick 폴더에 보관해 두니, 별로면 11_난이도다시고르기되돌리기.bat 으로 돌아갈 수 있어요.
echo.
set "IDS="
set /p IDS=곡 링크나 ID: 
"%~dp0venv\Scripts\python.exe" -I "%~dp0tools\linkbeat_ai.py" --repick %IDS%
echo.
pause
