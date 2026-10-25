@echo off
chcp 65001 >nul
cd /d "%~dp0"
set PYTHONIOENCODING=utf-8
echo 서버의 곡 전부를 새 AI(Mapperatorinator) 채보로 바꿔요. (그래픽카드 사용, 곡마다 7~8분 · 40곡이면 5시간쯤)
echo  - 이미 새 AI로 만든 곡은 건너뛰어요
echo  - 중간에 창을 닫아도 다시 실행하면 이어서 해요
echo  - 원래 AI 채보(MuG)는 out 폴더에 그대로 있어서 16번으로 전부 되돌릴 수 있어요
echo  - 하는 동안에는 게임에서 곡 추가·✦ AI 는 피해 주세요 (그래픽카드를 같이 써서 느려지거나 실패할 수 있어요)
echo.
echo 빼고 싶은 곡이 있으면 링크나 ID를 넣으세요 (여러 곡은 띄어쓰기로). 없으면 그냥 엔터.
set "SKIP="
set /p SKIP=뺄 곡: 
"%~dp0venv\Scripts\python.exe" -I "%~dp0tools\mapper_test.py" --all --skip %SKIP%
echo.
pause
