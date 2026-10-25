@echo off
chcp 65001 >nul
cd /d "%~dp0"
set PYTHONIOENCODING=utf-8
echo 일관성 방식 시험: Emergency, Ticking Away, 열 달 아흐레 를 새로 만들어요. (그래픽카드 사용, 10~15분)
echo 지금 AI 채보는 backup 폴더에 보관해 두니, 별로면 7_일관성시험되돌리기.bat 으로 돌아갈 수 있어요.
echo.
"%~dp0venv\Scripts\python.exe" -I "%~dp0tools\linkbeat_ai.py" --consist bYNEBbMGRKw cPO2ZEDczis PxFNtrD3JJY
echo.
pause
