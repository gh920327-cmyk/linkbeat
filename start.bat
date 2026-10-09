@echo off
cd /d "%~dp0"
title 링크비트 서버
set "PY="
where py >nul 2>nul && set "PY=py -3"
if not defined PY (
  where python >nul 2>nul && set "PY=python"
)
if not defined PY goto nopython
if not exist ".venv\installed.ok" goto install
goto run

:install
echo.
echo [처음 실행] 필요한 프로그램을 설치합니다. 몇 분 걸릴 수 있어요...
echo.
if not exist ".venv\Scripts\python.exe" %PY% -m venv .venv
if not exist ".venv\Scripts\python.exe" goto nopython
".venv\Scripts\python.exe" -m pip install --upgrade pip
".venv\Scripts\python.exe" -m pip install -r requirements.txt
if errorlevel 1 goto fail
echo ok> ".venv\installed.ok"

:run
echo 유튜브 다운로더(yt-dlp)를 최신 버전으로 맞추는 중...
".venv\Scripts\python.exe" -m pip install -U -q "yt-dlp[default]"
".venv\Scripts\python.exe" server.py
pause
exit /b

:nopython
echo.
echo 파이썬이 설치되어 있지 않아요.
echo https://www.python.org/downloads/ 에서 설치한 뒤 다시 실행해 주세요.
echo 설치 첫 화면에서 "Add python.exe to PATH" 를 꼭 체크하세요!
echo.
pause
exit /b

:fail
echo.
echo 설치 중 오류가 났어요. 위 메시지를 확인해 주세요.
echo 인터넷 연결을 확인하고 start.bat 을 다시 실행해 보세요.
pause
