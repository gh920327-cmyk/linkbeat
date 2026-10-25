@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo 새 AI(Mapperatorinator) 시험용으로 설치해요. 지금 쓰는 AI 채보 도구는 그대로예요.
echo 전부 이 폴더의 mapper 안에만 들어가요. (약 5GB, 10~30분)
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\install_mapper.ps1"
echo.
pause
