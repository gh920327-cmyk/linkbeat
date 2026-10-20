@echo off
chcp 65001 >nul
cd /d "%~dp0"
set PYTHONIOENCODING=utf-8
echo 서버에서 AI 채보만 모두 지워요. 기본 채보와 기록은 그대로예요.
echo.
if exist "%~dp0venv\Scripts\python.exe" (
  "%~dp0venv\Scripts\python.exe" -I "%~dp0tools\linkbeat_ai.py" --undo
) else (
  echo [!] 설치가 안 돼 있어서 서버 정리는 건너뛰어요. 게임에서 AI 채보 칩이 보이면 알려 주세요.
)
echo.
echo 다 끝났으면 이 창을 닫고 이 폴더 "%~dp0" 를 통째로 지우면 완전히 원래대로예요.
echo.
pause
