@echo off
chcp 65001 >nul
cd /d "%~dp0"
set PYTHONIOENCODING=utf-8
echo 곡 전부를 새 방식으로 AI 채보를 다시 만들어요. (Emergency, Ticking Away, 열 달 아흐레는 빼고)
echo 그래픽카드 사용, 곡마다 3~5분 (전체 2~3시간). 중간에 창을 닫아도 다시 실행하면 이어서 해요.
echo 지금 AI 채보는 backup 폴더에 보관해요. 마음에 안 드는 곡은 7_일관성시험되돌리기.bat 으로 되돌려요.
echo.
"%~dp0venv\Scripts\python.exe" -I "%~dp0tools\linkbeat_ai.py" --remake-all --skip bYNEBbMGRKw cPO2ZEDczis PxFNtrD3JJY
echo.
pause
