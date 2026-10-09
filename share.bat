@echo off
cd /d "%~dp0"
title 링크비트 친구 초대 링크
where cloudflared >nul 2>nul
if errorlevel 1 goto install
echo.
echo ============================================================
echo  잠시 후 아래에 https://xxxx.trycloudflare.com 주소가 나와요.
echo  그 주소를 친구에게 보내주세요. (이 창과 서버 창을 켜둬야 해요)
echo ============================================================
echo.
cloudflared tunnel --url http://localhost:8800
pause
exit /b

:install
echo.
echo 친구 초대에 필요한 cloudflared 가 없어요.
echo 아래 명령을 실행하면 설치돼요. 설치할까요?
echo     winget install --id Cloudflare.cloudflared
echo.
choice /m "지금 설치할까요"
if errorlevel 2 exit /b
winget install --id Cloudflare.cloudflared
echo.
echo 설치가 끝났으면 이 창을 닫고 share.bat 을 다시 실행해 주세요.
pause
