# 링크비트 AI 채보 도구 설치 — 전부 이 폴더(예: F:\LinkbeatAI) 안에만 설치돼요.
# 지우고 싶으면 3_되돌리기.bat 실행 후 이 폴더를 통째로 지우면 끝 (윈도우·다른 프로그램은 안 건드림)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$Root  = Split-Path -Parent $PSScriptRoot
$Tools = $PSScriptRoot
$Mug   = Join-Path $Root 'mug'
$Venv  = Join-Path $Root 'venv'
$Py    = Join-Path $Venv 'Scripts\python.exe'
$Dl    = Join-Path $Root 'download'
$UvDir = Join-Path $Root 'uv'
$Uv    = Join-Path $UvDir 'uv.exe'
$MugCommit = 'c2903d4e3d7216d94ef512a9872bc77423c6e0ac'
$ModelUrls = @(
  'https://dl2.hiosu.com/d/kuit/MugDiffusion.zip',
  'https://drive.usercontent.google.com/download?id=1-TmLsveLAjRCPwd0iwXS7V1v61MlQ7DM&export=download&confirm=t'
)

# uv(파이썬 설치 도구)가 받는 파이썬·캐시도 전부 이 폴더 안으로
$env:UV_PYTHON_INSTALL_DIR = Join-Path $Root 'python'
$env:UV_CACHE_DIR = Join-Path $Root 'cache'
$env:UV_NO_CONFIG = '1'
$env:UV_LINK_MODE = 'copy'
$env:UV_HTTP_TIMEOUT = '300'

function Step($n, $msg) { Write-Host ''; Write-Host "[$n/6] $msg" -ForegroundColor Cyan }
function Fail($msg) { Write-Host ''; Write-Host "설치를 멈췄어요: $msg" -ForegroundColor Red; exit 1 }
function Download($url, $out) {
  & curl.exe -L --fail --retry 3 --retry-delay 3 -C - -o $out $url
  if ($LASTEXITCODE -ne 0) { throw "받기 실패 ($LASTEXITCODE): $url" }
}

Write-Host '링크비트 AI 채보 도구 설치' -ForegroundColor Yellow
Write-Host "설치 위치: $Root (여기에만 설치돼요)"

# 0. 남은 공간
$drive = (Get-Item $Root).PSDrive
$freeGB = [math]::Round($drive.Free / 1GB, 1)
Write-Host "드라이브 남은 공간: $freeGB GB"
if ($freeGB -lt 12) { Fail "남은 공간이 12GB보다 적어요. 공간을 비우고 다시 해 주세요." }
if (-not (Get-Command curl.exe -ErrorAction SilentlyContinue)) { Fail 'curl.exe 가 없어요 (윈도우 10 이상이 필요해요).' }
try { $gpu = (Get-CimInstance Win32_VideoController | Where-Object { $_.Name -match 'NVIDIA' } | Select-Object -First 1).Name } catch { $gpu = $null }
if ($gpu) { Write-Host "그래픽카드: $gpu" } else { Write-Host '⚠ NVIDIA 그래픽카드를 못 찾았어요. 설치는 되지만 아주 느릴 수 있어요.' -ForegroundColor Yellow }

# 1. uv
Step 1 '파이썬 설치 도구(uv) 받는 중'
New-Item -ItemType Directory -Force -Path $Dl, $UvDir | Out-Null
if (-not (Test-Path $Uv)) {
  $z = Join-Path $Dl 'uv.zip'
  Download 'https://github.com/astral-sh/uv/releases/latest/download/uv-x86_64-pc-windows-msvc.zip' $z
  Expand-Archive -Force $z $UvDir
  Remove-Item $z -Force
}
if (-not (Test-Path $Uv)) { Fail 'uv.exe 를 찾을 수 없어요.' }
& $Uv --version

# 2. 파이썬 3.10 + 가상환경 (이 폴더 안에만)
Step 2 '파이썬 3.10 준비 중 (이 폴더 안에만 설치)'
if (-not (Test-Path $Py)) {
  & $Uv venv $Venv --python 3.10 --seed
  if ($LASTEXITCODE -ne 0) { Fail '파이썬 가상환경을 만들지 못했어요.' }
}

# 3. PyTorch (그래픽카드용, 약 2.5GB) + 나머지 부품
Step 3 'AI 실행 부품(PyTorch, 약 2.5GB) 받는 중 — 인터넷 속도에 따라 5~20분'
& $Uv pip install --python $Py 'torch==2.3.1' --index-url 'https://download.pytorch.org/whl/cu121'
if ($LASTEXITCODE -ne 0) { Fail 'PyTorch 설치에 실패했어요. 인터넷 연결을 확인하고 다시 실행해 주세요.' }
& $Uv pip install --python $Py 'numpy<2' 'scipy' 'librosa==0.10.2.post1' 'audioread' 'soundfile' 'einops' 'omegaconf' 'pyyaml' 'tqdm' 'scikit-learn' 'packaging' 'opt-einsum' 'pytorch_lightning==1.9.5' 'setuptools<70' 'yt-dlp[default]' 'imageio-ffmpeg' 'certifi' 'deno'
if ($LASTEXITCODE -ne 0) { Fail '부품 설치에 실패했어요. 다시 실행해 주세요.' }

# ffmpeg (오디오 변환) — imageio-ffmpeg 에 들어 있는 걸 bin\ffmpeg.exe 로 복사
$bin = Join-Path $Root 'bin'
New-Item -ItemType Directory -Force -Path $bin | Out-Null
$ff = & $Py -c "import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())"
if ($ff -and (Test-Path $ff)) { Copy-Item -Force $ff (Join-Path $bin 'ffmpeg.exe') }

# 4. MuG Diffusion 코드 (버전 고정)
Step 4 'MuG Diffusion 코드 받는 중'
if (-not (Test-Path (Join-Path $Mug 'mug\diffusion\ddim.py'))) {
  $z = Join-Path $Dl 'mug-code.zip'
  Download "https://codeload.github.com/Keytoyze/Mug-Diffusion/zip/$MugCommit" $z
  $tmp = Join-Path $Dl 'mug-code'
  if (Test-Path $tmp) { Remove-Item -Recurse -Force $tmp }
  Expand-Archive -Force $z $tmp
  $inner = Get-ChildItem $tmp -Directory | Select-Object -First 1
  if (Test-Path $Mug) { Remove-Item -Recurse -Force $Mug }
  Move-Item $inner.FullName $Mug
  Remove-Item -Recurse -Force $tmp, $z
}

# 5. AI 모델 (만든 사람이 올린 공식 묶음에서 모델 파일 2개만 꺼냄)
Step 5 'AI 모델 받는 중 (공식 배포 묶음, 몇 GB) — 끊기면 다시 실행하면 이어 받아요'
$ck = Join-Path $Mug 'models\ckpt'
New-Item -ItemType Directory -Force -Path $ck | Out-Null
if (-not ((Test-Path (Join-Path $ck 'model.ckpt')) -and (Test-Path (Join-Path $ck 'model.yaml')))) {
  $z = Join-Path $Dl 'MugDiffusion.zip'
  $got = $false
  foreach ($u in $ModelUrls) {
    try {
      Write-Host "받는 곳: $u"
      Download $u $z
      if ((Get-Item $z).Length -gt 500MB) { $got = $true; break }
      Write-Host '받은 파일이 너무 작아요 (다운로드 페이지였던 것 같아요). 다른 곳에서 받아 볼게요.' -ForegroundColor Yellow
      Remove-Item $z -Force
    } catch {
      Write-Host "실패: $($_.Exception.Message)" -ForegroundColor Yellow
    }
  }
  if (-not $got) { Fail '모델 묶음을 받지 못했어요. 잠시 뒤 다시 실행해 주세요.' }
  Write-Host '모델 파일 꺼내는 중...'
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $zip = [System.IO.Compression.ZipFile]::OpenRead($z)
  try {
    foreach ($name in @('model.ckpt', 'model.yaml')) {
      $e = $zip.Entries | Where-Object { ($_.FullName -replace '\\', '/') -match "models/ckpt/$([regex]::Escape($name))$" } | Select-Object -First 1
      if (-not $e) { throw "묶음 안에 $name 이 없어요." }
      [System.IO.Compression.ZipFileExtensions]::ExtractToFile($e, (Join-Path $ck $name), $true)
    }
  } finally { $zip.Dispose() }
  Remove-Item $z -Force      # 묶음 원본은 지워서 공간 아끼기 (모델 파일만 남김)
}

# 6. 확인
Step 6 '설치 확인'
& $Py -I (Join-Path $Tools 'linkbeat_ai.py') --check
if ($LASTEXITCODE -ne 0) { Fail '확인에서 문제가 있어요. 위 메시지를 캡처해서 보내 주세요.' }
& $Uv cache clean | Out-Null    # 설치용 임시 파일 지워서 공간 아끼기
Write-Host ''
Write-Host '설치 끝! 이제 2_AI채보만들기.bat 을 실행하세요.' -ForegroundColor Green
