@echo off
chcp 65001 >nul
cd /d "%~dp0"
set PYTHONIOENCODING=utf-8
if not exist "%~dp0venv\Scripts\python.exe" (
  echo [!] 1_설치.bat 을 먼저 실행해 주세요.
  pause
  exit /b 1
)
echo 곡마다 음원을 다시 받아서 소리가 없는 곳(노래가 끝난 뒤, 중간 정적, 박수 등)을 찾고
echo 그곳에 있는 노트를 서버의 모든 채보(기본 4키·6키·AI)에서 빼요. 손으로 고친 채보는 그대로예요.
echo  - 그래픽카드는 안 써요. 곡당 10~20초 (70곡이면 15~20분)
echo  - 중간에 창을 닫아도 다시 실행하면 이어서 해요
echo  - 새로 추가하는 곡은 AI 채보를 만들 때 자동으로 해요
echo.
"%~dp0venv\Scripts\python.exe" -I "%~dp0tools\linkbeat_ai.py" --quiet %*
echo.
pause
