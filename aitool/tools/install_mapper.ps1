# 새 AI(Mapperatorinator) 시험용 설치 — 전부 이 폴더의 mapper 안에만 설치돼요 (지금 쓰는 MuG 도구·venv 는 안 건드림)
# 지우고 싶으면 mapper 폴더·out_mapper 폴더를 통째로 지우면 끝
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$Root   = Split-Path -Parent $PSScriptRoot          # F:\LinkbeatAI
$M      = Join-Path $Root 'mapper'
$Repo   = Join-Path $M 'repo'
$Venv   = Join-Path $M 'venv'
$Py     = Join-Path $Venv 'Scripts\python.exe'
$Dl     = Join-Path $Root 'download'
$Uv     = Join-Path $Root 'uv\uv.exe'
$RepoCommit   = '0e2b0e387aab4b35c64b0b11b12d47578dea7587'   # Mapperatorinator (2026-08-13, V32)
$SliderCommit = 'ea28c484a0a542d6e094e25aa02e1529ff2c8313'   # osu! 파일 읽는 부품

$env:UV_PYTHON_INSTALL_DIR = Join-Path $Root 'python'
$env:UV_CACHE_DIR = Join-Path $Root 'cache'
$env:UV_NO_CONFIG = '1'
$env:UV_LINK_MODE = 'copy'
$env:UV_HTTP_TIMEOUT = '300'
$env:HF_HOME = Join-Path $M 'hf'

function Step($n, $msg) { Write-Host ''; Write-Host "[$n/5] $msg" -ForegroundColor Cyan }
function Fail($msg) { Write-Host ''; Write-Host "설치를 멈췄어요: $msg" -ForegroundColor Red; exit 1 }
function Download($url, $out) {
  & curl.exe -L --fail --retry 3 --retry-delay 3 -o $out $url
  if ($LASTEXITCODE -ne 0) { throw "받기 실패 ($LASTEXITCODE): $url" }
}

Write-Host '새 AI(Mapperatorinator) 시험용 설치' -ForegroundColor Yellow
Write-Host "설치 위치: $M (여기에만 설치돼요)"
$drive = (Get-Item $Root).PSDrive
$freeGB = [math]::Round($drive.Free / 1GB, 1)
Write-Host "드라이브 남은 공간: $freeGB GB"
if ($freeGB -lt 10) { Fail "남은 공간이 10GB보다 적어요. 공간을 비우고 다시 해 주세요." }
if (-not (Test-Path $Uv)) { Fail 'uv.exe 가 없어요. 1_설치.bat 을 먼저 실행해 주세요.' }
New-Item -ItemType Directory -Force -Path $M, $Dl | Out-Null

# 1. 코드 (버전 고정)
Step 1 'Mapperatorinator 코드 받는 중'
if (-not (Test-Path (Join-Path $Repo 'inference.py'))) {
  $z = Join-Path $Dl 'mapper-code.zip'
  Download "https://codeload.github.com/OliBomby/Mapperatorinator/zip/$RepoCommit" $z
  $tmp = Join-Path $Dl 'mapper-code'
  if (Test-Path $tmp) { Remove-Item -Recurse -Force $tmp }
  Expand-Archive -Force $z $tmp
  $inner = Get-ChildItem $tmp -Directory | Select-Object -First 1
  if (Test-Path $Repo) { Remove-Item -Recurse -Force $Repo }
  Move-Item $inner.FullName $Repo
  Remove-Item -Recurse -Force $tmp, $z
}
if (-not (Test-Path (Join-Path $Repo 'inference.py'))) { Fail '코드를 받지 못했어요.' }

# 2. 파이썬 3.10 가상환경 (MuG 와 따로)
Step 2 '파이썬 3.10 준비 중 (mapper 폴더 안에만)'
if (-not (Test-Path $Py)) {
  & $Uv venv $Venv --python 3.10 --seed
  if ($LASTEXITCODE -ne 0) { Fail '파이썬 가상환경을 만들지 못했어요.' }
}

# 3. PyTorch (그래픽카드용, 약 3GB) — 이 PC 의 ComfyUI 가 CUDA 13 으로 돌아가서 같은 걸로
Step 3 'AI 실행 부품(PyTorch, 약 3GB) 받는 중 — 인터넷 속도에 따라 5~20분'
$ok = $false
foreach ($try in @(
    @('torch==2.10.*', 'https://download.pytorch.org/whl/cu130'),
    @('torch==2.10.*', 'https://download.pytorch.org/whl/cu128'),
    @('torch', 'https://download.pytorch.org/whl/cu130'))) {
  & $Uv pip install --python $Py $try[0] --index-url $try[1]
  if ($LASTEXITCODE -eq 0) { $ok = $true; break }
  Write-Host "  다른 버전으로 다시 해 볼게요..." -ForegroundColor Yellow
}
if (-not $ok) { Fail 'PyTorch 설치에 실패했어요. 인터넷 연결을 확인하고 다시 실행해 주세요.' }
$tv = & $Py -c "import torch;print(torch.__version__.split('+')[0])"
$idx = & $Py -c "import torch;print('cu'+(torch.version.cuda or '13.0').replace('.',''))"
& $Uv pip install --python $Py "torchaudio" "torch==$tv" --index-url "https://download.pytorch.org/whl/$idx"
if ($LASTEXITCODE -ne 0) { Write-Host '  (torchaudio 는 건너뛰어요 — 없어도 돌아가요)' -ForegroundColor Yellow }

# 4. 나머지 부품 (그림 화면·학습용은 빼고 채보 만들기에 필요한 것만)
Step 4 '나머지 부품 설치 중'
& $Uv pip install --python $Py "torch==$tv" 'accelerate==1.12.0' 'pydub==0.25.1' 'nnAudio==0.3.4' 'PyYAML==6.0.3' 'transformers==4.57.3' `
  'hydra-core==1.3.2' "slider @ https://github.com/OliBomby/slider/archive/$SliderCommit.zip" 'matplotlib==3.10.8' 'pandas==2.3.3' `
  'pyarrow==22.0.0' 'einops==0.8.1' 'rich==14.2.0' 'peft==0.18.1' 'rosu-pp-py==3.1.0' 'datasets==4.8.3' 'huggingface-hub==0.36.2' `
  'hf-xet==1.4.2' 'wandb==0.24.2' 'scipy' 'tqdm' 'packaging' 'safetensors'
if ($LASTEXITCODE -ne 0) { Fail '부품 설치에 실패했어요. 다시 실행해 주세요.' }

# 5. 확인
Step 5 '설치 확인'
& $Py -c "import torch;print('  PyTorch', torch.__version__, '· 그래픽카드', torch.cuda.get_device_name(0) if torch.cuda.is_available() else '없음 (아주 느림)')"
if ($LASTEXITCODE -ne 0) { Fail 'PyTorch 가 안 돌아가요. 위 메시지를 캡처해서 보내 주세요.' }
Push-Location $Repo
try {
  & $Py -c "import inference; print('  Mapperatorinator 코드 OK')"
  if ($LASTEXITCODE -ne 0) { Fail '코드를 불러오지 못했어요. 위 메시지를 캡처해서 보내 주세요.' }
} finally { Pop-Location }
& $Uv cache clean | Out-Null
Write-Host ''
Write-Host '설치 끝! 이제 13_새AI로시험.bat 을 실행하세요. (처음 한 번은 AI 모델을 받느라 몇 분 더 걸려요)' -ForegroundColor Green
