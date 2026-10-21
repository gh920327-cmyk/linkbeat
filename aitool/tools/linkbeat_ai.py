"""
링크비트 AI 채보 도구 (시험용) — 호스트 PC에서만, F:\\LinkbeatAI 안에서만 돌아가요
 - 유튜브 링크 → 오디오 받기 → MuG Diffusion(다른 리듬게임 채보 수만 개로 학습한 AI)이 4키 채보 생성
 - 기본 채보와 비슷한 난이도(★)끼리 골라서 서버에 'AI 채보'로 따로 저장 (기본 채보·기록은 그대로)
 - --undo: 서버에서 AI 채보만 모두 지움 → 원래대로

MuG Diffusion: https://github.com/Keytoyze/Mug-Diffusion (코드 MIT, 모델·AI 채보는 비상업용)
"""
import argparse
import json
import os
import re
import shutil
import ssl
import subprocess
import sys
import time
import traceback
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent          # F:\LinkbeatAI
MUG = ROOT / "mug"                                       # MuG Diffusion 코드 + 모델
WORK = ROOT / "work"                                     # 받은 오디오 (끝나면 지움)
OUT = ROOT / "out"                                       # 만든 AI 채보 (.osu + 요약) 보관
SETTINGS = ROOT / "settings.json"
DEFAULT_SERVER = "https://linkbeat.43-202-116-151.sslip.io"
DIFF_ORDER = ["easy", "normal", "hard", "extreme"]
DIFF_KO = {"easy": "쉬움", "normal": "보통", "hard": "어려움", "extreme": "극한"}
# AI에게 줄 osu! 별점(SR) 후보 — 넓게 만들어 두고, 링크비트 기본 채보 ★와 가장 비슷한 걸 고름
# osu 별점 → 링크비트 별: 1.6≈★3.7 · 2.4≈★5 · 3.2≈★8 · 4.0≈★11 (실제 39곡에서 확인) → 쓸모 있는 1.0~3.8을 촘촘하게
SR_PROMPTS = [1.0, 1.4, 1.8, 2.2, 2.5, 2.8, 3.1, 3.4, 3.8]
# 난이도별 목표 별점 (방장이 정한 범위의 가운데): 쉬움 1.5~2.5 · 보통 3~5 · 어려움 6~7 · 극한 8 이상
MIN_STEP = 0.8   # 난이도 사이 최소 별 차이 (곡 기준 난이도: 기존 채보 별을 따라가되, 위 난이도는 확실히 더 어렵게)


def relative_targets(targets):
    """기존 채보 별(그 곡의 자연스러운 난이도)을 목표로, 난이도마다 최소 0.8★씩 차이 나게"""
    out, prev = {}, None
    for d in DIFF_ORDER:
        if d not in targets:
            continue
        v = float(targets[d])
        if prev is not None:
            v = max(v, prev + MIN_STEP)
        out[d] = round(v, 2)
        prev = v
    return out
PER_PROMPT = 2

sys.path.insert(0, str(Path(__file__).resolve().parent))
# 가상환경의 실행 파일 폴더(deno 등)·ffmpeg 폴더를 PATH 앞에 → yt-dlp가 찾을 수 있게
os.environ["PATH"] = os.pathsep.join([str(Path(sys.executable).parent), str(ROOT / "bin"), os.environ.get("PATH", "")])
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass


def say(msg=""):
    print(msg, flush=True)


# ------------------------------------------------------------------ 설정 · 서버
def load_settings():
    try:
        return json.loads(SETTINGS.read_text(encoding="utf-8"))
    except Exception:
        return {}


def save_settings(d):
    SETTINGS.write_text(json.dumps(d, ensure_ascii=False, indent=1), encoding="utf-8")


def ssl_ctx():
    ctx = ssl.create_default_context()
    try:
        import certifi
        ctx.load_verify_locations(cafile=certifi.where())
    except Exception:
        pass
    return ctx


SSL_CTX = ssl_ctx()


class Server:
    def __init__(self, base, key=""):
        self.base = base.rstrip("/")
        self.key = key

    def call(self, method, path, body=None, timeout=60):
        data = None if body is None else json.dumps(body, ensure_ascii=False).encode("utf-8")
        h = {"User-Agent": "LinkbeatAI/1.0", "Content-Type": "application/json"}
        if self.key:
            h["X-Host-Key"] = self.key
        req = urllib.request.Request(self.base + "/api/" + path, data=data, method=method, headers=h)
        try:
            with urllib.request.urlopen(req, timeout=timeout, context=SSL_CTX) as r:
                return json.loads(r.read().decode("utf-8") or "{}")
        except urllib.error.HTTPError as e:
            try:
                msg = json.loads(e.read().decode("utf-8")).get("error") or str(e)
            except Exception:
                msg = str(e)
            if e.code == 403:
                raise PermissionError(msg)
            if e.code == 404:
                raise LookupError(msg)
            raise RuntimeError(f"서버 오류 {e.code}: {msg}")


def get_server(need_key=True):
    st = load_settings()
    srv = Server(st.get("server") or DEFAULT_SERVER, st.get("hostKey", ""))
    if need_key and not srv.key:
        say("호스트 키가 필요해요 (링크비트 서버 설치 때 받은 키, 실행기 설정에 넣은 그 키).")
        say("한 번만 넣으면 이 폴더의 settings.json 에 저장돼요.")
        k = input("호스트 키: ").strip()
        if not k:
            raise SystemExit("호스트 키를 넣지 않아서 멈췄어요.")
        st["hostKey"] = k
        save_settings(st)
        srv.key = k
    return srv


def parse_vid(text):
    text = text.strip()
    m = re.search(r"(?:v=|youtu\.be/|shorts/|embed/|live/)([A-Za-z0-9_-]{11})", text)
    if m:
        return m.group(1)
    if re.fullmatch(r"[A-Za-z0-9_-]{11}", text):
        return text
    return None


# ------------------------------------------------------------------ 오디오
def ffmpeg_exe():
    b = ROOT / "bin" / "ffmpeg.exe"
    if b.exists():
        return str(b)
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return "ffmpeg"


def download_audio(vid, folder):
    import yt_dlp
    folder.mkdir(parents=True, exist_ok=True)
    for f in folder.iterdir():
        if f.is_file():
            f.unlink()
    last = [-1]

    def hook(d):
        if d.get("status") == "downloading":
            tot = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
            if tot:
                pct = int(d.get("downloaded_bytes", 0) * 100 / tot)
                if pct // 10 != last[0]:
                    last[0] = pct // 10
                    say(f"  오디오 받는 중... {pct}%")

    opts = {"quiet": True, "no_warnings": True, "noplaylist": True, "format": "bestaudio/best",
            "outtmpl": str(folder / "audio.%(ext)s"), "progress_hooks": [hook]}
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(f"https://www.youtube.com/watch?v={vid}", download=True)
    files = [f for f in folder.iterdir() if f.is_file() and not f.name.endswith(".part")]
    if not files:
        raise RuntimeError("오디오 파일을 받지 못했어요.")
    src = max(files, key=lambda f: f.stat().st_size)
    return to_wav(src, folder), info


def to_wav(src, folder):
    """아무 오디오 → 22050Hz 모노 wav (MuG가 읽는 형식)"""
    folder.mkdir(parents=True, exist_ok=True)
    wav = folder / "audio.wav"
    flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    r = subprocess.run([ffmpeg_exe(), "-v", "error", "-y", "-i", str(src), "-ac", "1", "-ar", "22050", str(wav)],
                       capture_output=True, creationflags=flags)
    if r.returncode != 0 or not wav.exists():
        raise RuntimeError("오디오 변환(ffmpeg)에 실패했어요: " + r.stderr.decode("utf-8", "replace")[:300])
    return wav


# ------------------------------------------------------------------ .osu → 링크비트 노트
def osu_to_notes(path, keys=4):
    """osu!mania .osu 파일의 [HitObjects] → [{"t": 초, "l": 레인, "d": 누르는 시간(초)}]"""
    notes = []
    in_obj = False
    for line in Path(path).read_text(encoding="utf-8", errors="replace").splitlines():
        line = line.strip()
        if line.startswith("["):
            in_obj = line == "[HitObjects]"
            continue
        if not in_obj or not line:
            continue
        p = line.split(",")
        try:
            x, t, typ = float(p[0]), float(p[2]), int(p[3])
        except (IndexError, ValueError):
            continue
        lane = max(0, min(keys - 1, int(x * keys / 512)))
        d = 0.0
        if typ & 128 and len(p) > 5:
            try:
                end = float(p[5].split(":")[0])
                d = max(0.0, (end - t) / 1000.0)
            except ValueError:
                d = 0.0
        if t < 0:
            continue
        notes.append({"t": round(t / 1000.0, 3), "l": lane, "d": round(min(d, 60.0), 3)})
    notes.sort(key=lambda n: (n["t"], n["l"]))
    # 같은 레인 같은 시각 겹침 제거
    out, seen = [], set()
    for n in notes:
        k = (round(n["t"], 3), n["l"])
        if k in seen:
            continue
        seen.add(k)
        out.append(n)
    return out


def stream_ratio(notes):
    """앞뒤 간격이 일정하게 이어지는 단일 노트(스트림) 비율"""
    ts = sorted({round(n["t"], 3) for n in notes})
    k = 0
    for i in range(1, len(ts) - 1):
        a, b = ts[i] - ts[i - 1], ts[i + 1] - ts[i]
        if 0.06 < a < 0.35 and 0.06 < b < 0.35 and abs(a - b) <= 0.15 * max(a, b):
            k += 1
    return k / max(1, len(ts))


def _secs(notes):
    return {int(n["t"]) for n in notes}


def active_secs(cands, duration):
    """원곡 후보 절반 이상이 노트를 찍은 초 = 곡에서 '쳐야 할 소리가 있는' 곳"""
    sets = [_secs(c[1]) for c in cands]
    if not sets:
        return set()
    need = max(1, (len(sets) + 1) // 2)
    out = set()
    for s in range(int(duration) + 2):
        if sum(1 for x in sets if s - 1 in x or s in x or s + 1 in x) >= need:
            out.add(s)
    return out


def coverage(notes, active):
    """쳐야 할 곳 중 이 후보가 노트를 찍은 비율 (AI가 통째로 비운 후보 걸러내기)"""
    if not active:
        return 1.0
    x = _secs(notes)
    return sum(1 for s in active if s - 1 in x or s in x or s + 1 in x) / len(active)


MIN_COVER = 0.85   # 곡에서 쳐야 할 곳의 85% 이상을 찍은 후보만 고름


def pick_for_diffs(cands, targets, active=None):
    """cands: [(★, notes, 이름)], targets: {diff: 기본 채보 ★}. 난이도 순서가 뒤집히지 않게 가장 가까운 것 고르기.
    active가 있으면 곡 대부분을 비운 후보는 뺌 (남는 게 없으면 그대로)"""
    if active:
        good = [c for c in cands if coverage(c[1], active) >= MIN_COVER]
        if len(good) >= min(len(targets), len(cands)):
            cands = good
    cands = sorted(cands, key=lambda c: c[0])
    chosen = {}
    lo = -1.0
    used = set()
    for d in DIFF_ORDER:
        if d not in targets:
            continue
        tgt = targets[d]
        pool = [i for i, c in enumerate(cands) if c[0] >= lo and i not in used] or \
               [i for i, c in enumerate(cands) if i not in used] or list(range(len(cands)))   # 같은 후보는 되도록 다시 안 씀
        best = min(abs(cands[j][0] - tgt) for j in pool)
        near_ = [j for j in pool if abs(cands[j][0] - tgt) <= best + 0.5]     # 별이 비슷하면 스트림이 많은 쪽
        i = max(near_, key=lambda j: (stream_ratio(cands[j][1]), -abs(cands[j][0] - tgt)))
        chosen[d] = cands[i]
        used.add(i)
        lo = cands[i][0]
    return chosen


# ------------------------------------------------------------------ MuG Diffusion
class Mug:
    def __init__(self):
        os.chdir(MUG)                       # MuG 코드는 configs/, asset/ 를 상대 경로로 읽음
        sys.path.insert(0, str(MUG))
        import torch
        from omegaconf import OmegaConf
        from mug.util import instantiate_from_config
        from mug.diffusion.ddim import DDIMSampler
        self.torch = torch
        self.cuda = torch.cuda.is_available()
        if not self.cuda:
            say("  ⚠ NVIDIA 그래픽카드(CUDA)를 못 찾아서 CPU로 해요. 아주 느릴 수 있어요.")
        else:
            say(f"  그래픽카드: {torch.cuda.get_device_name(0)}")
        self.config = OmegaConf.load(str(MUG / "models" / "ckpt" / "model.yaml"))
        say("  AI 모델 불러오는 중... (처음엔 30초쯤)")
        sd = torch.load(str(MUG / "models" / "ckpt" / "model.ckpt"), map_location="cpu")
        sd = sd.get("state_dict", sd)
        model = instantiate_from_config(self.config.model)
        model.load_state_dict(sd, strict=False)
        self.device = torch.device("cuda") if self.cuda else torch.device("cpu")
        model = model.to(self.device)
        model.eval()
        self.model = model
        self.sampler = DDIMSampler(model, self.device)
        self.version = str(self.config.get("version", "?"))

    def _features(self, count, feature_dict):
        """feature_dict 하나면 모두 같은 조건, 리스트면 후보마다 다른 조건"""
        import numpy as np
        import yaml
        from mug.util import feature_dict_to_embedding_ids
        fy = yaml.safe_load(open(MUG / "configs" / "mug" / "mania_beatmap_features.yaml", encoding="utf-8"))
        dicts = feature_dict if isinstance(feature_dict, list) else [feature_dict] * count
        ids = [feature_dict_to_embedding_ids(dicts[i % len(dicts)], fy) for i in range(count)]
        f = self.torch.tensor(np.asarray(ids), dtype=self.torch.float32, device=self.model.device)
        return self.model.model.cond_stage_model(f)

    def generate(self, variants, out_dir, sr_list, step=100, scale=5.0, seed=1234, title="", artist=""):
        """sr_list의 별점마다 variants(후보 종류)마다 하나씩 생성 → [(osu 경로, sr)]
        variants: [(오디오 wav, 추가 조건, 이름)] — 예: 원곡 / 원곡+스트림 많이 / 반주만(소리 분리)"""
        import numpy as np
        import random
        from tqdm import tqdm
        from mug.util import load_audio_without_cache
        from mug.data.convertor import save_osu_file, parse_osu_file
        from mug.data.utils import gridify, remove_intractable_mania_mini_jacks
        torch = self.torch
        model, config = self.model, self.config
        random.seed(seed)
        np.random.seed(seed)
        torch.manual_seed(seed)
        if self.cuda:
            torch.cuda.manual_seed_all(seed)
            torch.cuda.empty_cache()
        out_dir.mkdir(parents=True, exist_ok=True)
        results = []
        with torch.no_grad():
            dataset = config.data.params.common_params
            hop = dataset.n_fft // 4
            frame_dur = hop / dataset.sr
            count = len(variants)
            cache = {}
            for wav, _, _ in variants:
                if str(wav) not in cache:
                    cache[str(wav)] = load_audio_without_cache(str(wav), dataset.n_mels, hop, dataset.n_fft, dataset.sr, None)
            t = max(a.shape[1] for a in cache.values())
            ratio = dataset.max_audio_frame // model.z_length
            map_len = (int((t / ratio) / 32) + 1) * 32
            dataset.max_audio_frame = map_len * ratio
            model.z_length = map_len

            def fit(audio):
                n = audio.shape[1]
                if n < dataset.max_audio_frame:
                    return np.concatenate([audio, np.zeros((dataset.n_mels, dataset.max_audio_frame - n), dtype=np.float32)], axis=1)
                return audio[:, :dataset.max_audio_frame]
            w = torch.tensor(np.stack([fit(cache[str(v[0])]) for v in variants]), dtype=torch.float32).to(model.device)
            if self.cuda:
                model.model.wave_model.to("cuda")
            w = model.model.wave_model(w)
            if self.cuda:
                model.model.wave_model.to("cpu")
                torch.cuda.empty_cache()
            uc = self._features(count, {}) if scale != 1.0 else None
            conv = {"frame_ms": frame_dur * dataset.audio_note_window_ratio * 1000,
                    "max_frame": dataset.max_audio_frame // dataset.audio_note_window_ratio,
                    "from_logits": True}
            _, meta = parse_osu_file(str(MUG / "asset" / "template.osu"), conv)

            def snap(hit_objects):
                new_objs, bpm, offset = gridify(hit_objects, verbose=False)
                objs = remove_intractable_mania_mini_jacks(new_objs, verbose=False, jack_interval=90)
                return bpm, offset, objs

            for k, sr in enumerate(sr_list):
                say(f"  AI가 채보 쓰는 중... {k + 1}/{len(sr_list)} (osu 별점 {sr:.1f} 기준 {count}개)")
                # rc=1 · ln_ratio=0: 롱노트가 적은(10% 미만) 일반 노트 위주 채보로 (링크비트 취향)
                base = {"rank_status": "ranked", "sr": sr, "rc": 1, "ln_ratio": 0.0}
                c = self._features(count, [dict(base, **v[1]) for v in variants])
                samples, _ = self.sampler.sample(S=step, c=c, w=w, batch_size=count, shape=None, verbose=False,
                                                 unconditional_guidance_scale=scale, unconditional_conditioning=uc,
                                                 eta=0.0, tqdm_class=tqdm)
                xs = model.model.decode(samples).cpu().numpy()
                for i, x in enumerate(xs):
                    name = f"sr{sr:.1f}_{variants[i][2]}"
                    path = out_dir / f"{name}.osu"
                    creator = f"MuG Diffusion v{self.version}"
                    save_osu_file(meta, x, path=str(path), override={
                        "Creator": creator, "Version": f"AI {name}", "AudioFilename": "audio.mp3",
                        "Title": title or "LINKBEAT", "TitleUnicode": title or "LINKBEAT",
                        "Artist": artist or "-", "ArtistUnicode": artist or "-",
                        "AIMode": creator, "AIPrompt": f"style=ranked, type=rc, ln=0, sr={sr}, step={step}, cfg={scale}, seed={seed}, {i}",
                    }, gridify=snap)
                    results.append((path, sr))
                if self.cuda:
                    torch.cuda.empty_cache()
        return results


# ------------------------------------------------------------------ 명령
def cmd_check():
    ok = True
    say("== 설치 확인 ==")
    for p in (MUG / "models" / "ckpt" / "model.ckpt", MUG / "models" / "ckpt" / "model.yaml", MUG / "asset" / "template.osu"):
        exists = p.exists()
        ok &= exists
        say(f"  {'OK ' if exists else '없음'}  {p}")
    try:
        import torch
        say(f"  OK   PyTorch {torch.__version__} · CUDA {'사용 가능 (' + torch.cuda.get_device_name(0) + ')' if torch.cuda.is_available() else '없음 (CPU로 느리게 돌아감)'}")
    except Exception as e:
        ok = False
        say(f"  없음 PyTorch ({e})")
    try:
        os.chdir(MUG)
        sys.path.insert(0, str(MUG))
        import mug.diffusion.ddim, mug.data.convertor, mug.data.utils, mug.util  # noqa: F401
        import yt_dlp, chartgen  # noqa: F401
        say(f"  OK   MuG 코드 · yt-dlp {yt_dlp.version.__version__} · 링크비트 별점 계산")
        say("  " + ("OK   소리 분리(Demucs)" if demucs_ok() else "없음 소리 분리(Demucs) — 1_설치.bat 을 다시 실행하면 설치돼요 (없어도 AI 채보는 만들어져요)"))
    except Exception as e:
        ok = False
        say(f"  오류 {e}")
        traceback.print_exc()
    say("설치 확인 끝: " + ("모두 정상이에요." if ok else "빠진 게 있어요. 1_설치.bat 을 다시 실행해 주세요."))
    return ok


def cmd_make(link, mode="", srv=None):
    import chartgen
    srv = srv or get_server(need_key=True)
    vid = parse_vid(link)
    if not vid:
        raise SystemExit("유튜브 링크를 알아볼 수 없어요.")
    say(f"\n[1/4] 서버에서 곡 확인: {vid}")
    try:
        song = srv.call("GET", f"songs/{vid}")
    except LookupError:
        raise SystemExit("이 곡은 아직 링크비트에 없어요. 먼저 게임에서 곡을 추가한 다음 다시 해 주세요.")
    title = song.get("title", vid)
    say(f"  곡: {title}")
    basic = song.get("charts") or {}
    targets = {d: chartgen.star_rating(basic[d], 4) for d in DIFF_ORDER if basic.get(d)}
    if not targets:
        raise SystemExit("이 곡에는 4키 기본 채보가 없어요.")

    say("\n[2/4] 오디오 받는 중")
    wdir = WORK / vid
    wav, info = download_audio(vid, wdir)

    say("\n[3/4] AI 채보 만들기 (그래픽카드로 2~5분)")
    body, chosen = make_charts(vid, wav, targets, title, song.get("artist", ""), song.get("duration") or 900, mode=mode)

    say("\n[4/4] 서버에 'AI 채보'로 따로 저장 (기본 채보는 그대로)")
    r = upload(srv, vid, body)
    shutil.rmtree(wdir, ignore_errors=True)
    shutil.rmtree(WORK / ("sep_" + vid), ignore_errors=True)   # 오디오는 지움 (채보만 남김)
    say("\n완료! 난이도별 비교 (★ = 링크비트 별점)")
    say("  난이도      기본 채보          AI 채보")
    for d in DIFF_ORDER:
        if d in chosen:
            say(f"  {DIFF_KO[d]:<6}  ★{targets[d]:4.1f} {len(basic[d]):5d}노트   ★{chosen[d][0]:4.1f} {len(chosen[d][1]):5d}노트")
    say("\n게임에서 이 곡을 고르면 4키는 AI 채보로 플레이돼요. ('AI 채보' 칩을 끄면 기존 채보)")
    return r


GAP_MIN = 3.0    # 본 채보가 이만큼(초) 넘게 비운 곳만 채움
INST_MIN = 4.0   # 반주 후보로는 이만큼 넘게 빈 전주·간주만


def _align(src, ref):
    """다른 후보(src) 박 위치를 본 채보(ref)에 맞출 만큼(초): 두 후보 모두 박자 칸에 고르게 찍혀 있어서 겹치는 노트가 가장 많은 위치"""
    import bisect
    rt = sorted({n["t"] for n in ref})
    st = sorted({n["t"] for n in src})
    if len(rt) < 20 or len(st) < 20:
        return 0.0
    best = (0, 0.0)
    for k in range(-30, 31):
        sh = k * 0.002
        m = 0
        for t in st:
            x = t + sh
            i = bisect.bisect_left(rt, x)
            if any(0 <= j < len(rt) and abs(rt[j] - x) <= 0.006 for j in (i - 1, i)):
                m += 1
        if m > best[0] or (m == best[0] and abs(sh) < abs(best[1])):
            best = (m, sh)
    return best[1]


def fill_gaps(main, others, insts, duration):
    """본 채보가 통째로 비운 구간 채우기 → (채보, [(채운 후보 이름, 초)])
    - 다른 원곡 후보 절반 이상이 거기 노트를 찍었으면 → AI가 그 후보에서만 빠뜨린 것: 별이 가장 비슷한 원곡 후보로 (같은 느낌)
    - 원곡 후보는 다 비웠는데 반주 후보는 찍었으면 → 보컬 없는 전주·간주: 4초 넘을 때만 반주 후보로
    - 둘 다 비웠으면 → 진짜 쉬는 곳이라 그대로 둠
    채우는 노트는 본 채보 밀도에 맞춰 고르게 솎고, 박 위치는 본 채보에 맞춤"""
    import bisect
    star, notes, name = main
    if not notes:
        return notes, []
    times = [-0.5] + sorted(n["t"] for n in notes) + [duration + 0.5]
    gaps = [(a, b) for a, b in zip(times, times[1:]) if b - a >= GAP_MIN]
    if not gaps:
        return notes, []
    covered = max(1.0, duration - sum(b - a for a, b in gaps))
    target = len({n["t"] for n in notes}) / covered
    others = [c for c in others if c[2] != name]
    aligned = {}

    def inside(c, lo, hi):
        return [n for n in c[1] if lo < n["t"] < hi]

    def shifted(c):
        if c[2] not in aligned:
            sh = _align(c[1], notes)
            aligned[c[2]] = sorted((dict(n, t=round(n["t"] + sh, 3)) for n in c[1]), key=lambda n: n["t"])
        return aligned[c[2]]

    add, used = [], []
    for a, b in gaps:
        lo, hi = a + 0.3, b - 0.3
        need = max(3, int(0.8 * (hi - lo)))
        has_o = [c for c in others if len(inside(c, lo, hi)) >= need]
        has_i = [c for c in insts if len(inside(c, lo, hi)) >= need]
        if others and len(has_o) * 2 >= len(others):
            src = min(has_o, key=lambda c: abs(c[0] - star))
        elif b - a >= INST_MIN and insts and len(has_i) * 2 >= len(insts):
            src = min(has_i, key=lambda c: abs(c[0] - star))
        else:
            continue
        src_notes = shifted(src)
        i = bisect.bisect_left([n["t"] for n in src_notes], lo)
        part = []
        while i < len(src_notes) and src_notes[i]["t"] < hi:
            n = src_notes[i]
            if n["t"] + float(n.get("d", 0) or 0) < b - 0.2:
                part.append(n)
            i += 1
        if not part:
            continue
        groups = sorted({n["t"] for n in part})
        dens = len(groups) / max(0.5, hi - lo)
        if dens > target * 1.15:
            k = dens / max(0.3, target)
            keep, acc = set(), 0.0
            for t in groups:                  # 고르게 솎기 (k개 중 하나)
                acc += 1
                if acc >= k:
                    keep.add(t)
                    acc -= k
            part = [n for n in part if n["t"] in keep]
        add += part
        used.append((src[2], round(hi - lo, 1)))
    return sorted(notes + add, key=lambda n: (n["t"], n["l"])), used


def choose(cands, targets, duration):
    """후보들 → 난이도마다 채보 하나 {diff: (★, notes, 설명)}
    본 채보는 원곡 후보(a·s)에서만, 곡 대부분을 비운 후보는 빼고 고름 → 빈 곳만 채움"""
    import chartgen
    main_c = [c for c in cands if not c[2].endswith("_i")] or cands
    inst_c = [c for c in cands if c[2].endswith("_i") and len(c[1]) >= 50]
    active = active_secs(main_c, duration)
    chosen = pick_for_diffs(main_c, relative_targets(targets), active)
    for d, c in list(chosen.items()):
        notes, used = fill_gaps(c, main_c, inst_c, duration)
        if used:
            tag = "+".join(f"{n}({s:.0f}초)" for n, s in used[:4]) + ("…" if len(used) > 4 else "")
            chosen[d] = (chartgen.star_rating(notes, 4), notes, f"{c[2]}+{tag}")
    return chosen


def load_cands(odir, duration):
    import chartgen
    cands = []
    for path in sorted(odir.glob("sr*.osu")):
        notes = [n for n in osu_to_notes(path) if n["t"] <= duration + 1]
        if len(notes) < 20:
            continue
        cands.append((chartgen.star_rating(notes, 4), notes, path.stem))
    return cands


def write_summary(odir, vid, title, seed, model, targets, chosen, cands, mode=""):
    summary = {"vid": vid, "title": title, "at": time.time(), "seed": seed, "model": model, "targets": targets, "mode": mode,
               "chosen": {d: {"file": c[2], "stars": c[0], "notes": len(c[1])} for d, c in chosen.items()},
               "candidates": [{"file": c[2], "stars": c[0], "notes": len(c[1])} for c in sorted(cands, key=lambda c: c[0])]}
    (odir / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=1), encoding="utf-8")


def demucs_ok():
    try:
        import demucs.pretrained  # noqa: F401
        return True
    except Exception:
        return False


# ------------------------------------------------------------------ 일관성 (소리별로 박자 이끄는 소리를 정해서 후보 고르기)
STEM_W = {"drums": 1.0, "bass": 0.8, "other": 1.0, "vocals": 0.6}   # 보컬은 점수 낮춤 (보컬만 따라가는 채보 방지)
PHRASE_BEATS = 16      # 4마디씩 묶음
SIM_SAME = 0.75        # 묶음끼리 이만큼 비슷하면 '반복 구간' (같은 소리를 따라감)
SWITCH_COST = 0.08     # 후보를 바꾸는 비용 (너무 자주 바꾸지 않게)
NEAR_STAR = 0.8        # 본 채보와 별 차이가 이 안인 후보만 섞음
MAIN_BONUS = 0.05      # 본 채보(평소 방식으로 고른 것)는 조금 우대 — 확실히 더 맞을 때만 바꿈
STAR_KEEP = 0.6        # 다 이어 붙인 뒤 별이 이만큼 넘게 달라지면 그 난이도는 평소 방식 그대로
HIT_WIN = 0.04         # 노트가 소리에 맞았다고 보는 범위(초)


def analyze_stems(ys, harm, sr=22050, hop=512):
    """소리별(드럼·베이스·나머지·보컬) 박자 위치·세기, 박(beat) 위치, 박마다 음 높이 분포(반복 구간 찾기용)"""
    import numpy as np
    import librosa
    env_sum = None
    stems = {}
    for n, y in ys.items():
        env = librosa.onset.onset_strength(y=y, sr=sr, hop_length=hop)
        env_sum = env if env_sum is None else env_sum[:len(env)] + env[:len(env_sum)]
        fr = librosa.onset.onset_detect(onset_envelope=env, sr=sr, hop_length=hop, backtrack=False, delta=0.05)
        rms = librosa.feature.rms(y=y, hop_length=hop)[0]
        top = float(np.percentile(env[fr], 95)) if len(fr) else 1.0
        stems[n] = {"on": [[round(float(t), 3), round(float(min(1.5, env[f] / max(top, 1e-6))), 3), round(float(rms[min(f, len(rms) - 1)]), 4)]
                           for f, t in zip(fr, librosa.frames_to_time(fr, sr=sr, hop_length=hop))]}
    _, beats = librosa.beat.beat_track(onset_envelope=env_sum, sr=sr, hop_length=hop, units="frames")
    btimes = librosa.frames_to_time(beats, sr=sr, hop_length=hop)
    chroma = librosa.feature.chroma_stft(y=harm, sr=sr, hop_length=hop)
    sync = librosa.util.sync(chroma, beats, aggregate=np.mean)[:, 1:] if len(beats) else chroma[:, :0]   # 첫 칸은 첫 박 앞
    loud = {}
    for n, y in ys.items():                     # 박마다 소리 크기 (어느 소리가 크게 들리는지)
        rms = librosa.feature.rms(y=y, hop_length=hop)[0]
        loud[n] = [round(float(v), 4) for v in (librosa.util.sync(rms[None], beats, aggregate=np.mean)[0][1:] if len(beats) else [])]
    return {"beats": [round(float(t), 3) for t in btimes], "stems": stems, "loud": loud,
            "chroma": [[round(float(v), 2) for v in col] for col in sync.T]}


def phrases_of(stems, duration):
    """박 위치 → 4마디 묶음 [(시작, 끝, 첫 박 번호, 끝 박 번호)]"""
    beats = stems.get("beats") or []
    if len(beats) < PHRASE_BEATS * 2:
        return []
    out = []
    for i in range(0, len(beats), PHRASE_BEATS):
        a = 0.0 if i == 0 else beats[i] - 0.06
        j = min(len(beats), i + PHRASE_BEATS)
        b = duration + 1 if j >= len(beats) else beats[j] - 0.06
        out.append((a, b, i, j))
    if len(out) > 1 and out[-1][3] - out[-1][2] < PHRASE_BEATS // 2:     # 짧은 끝 묶음은 앞에 붙임
        a, _, i, _ = out[-2]
        out[-2:] = [(a, out[-1][1], i, out[-1][3])]
    return out


def lead_scores(stems, phrases):
    """묶음마다 소리별 '박자를 또렷하게 이끄는 정도': 박 쪼갬(16분) 위에 찍힌 세기 합 × 그 소리 크기(상대) × 가중치"""
    import bisect
    beats = stems["beats"]
    grid = []
    for a, b in zip(beats, beats[1:]):
        grid += [a + (b - a) * k / 4 for k in range(4)]
    grid.append(beats[-1])
    res = []
    for a, b, i, j in phrases:
        loud = {}
        for n, v in (stems.get("loud") or {}).items():
            seg = v[i:j] or [0.0]
            loud[n] = sum(seg) / len(seg)
        mx = max(loud.values() or [1e-6]) or 1e-6
        sc = {}
        for n, st in stems["stems"].items():
            on = st["on"]
            ts = [x[0] for x in on]
            lo, hi = bisect.bisect_left(ts, a), bisect.bisect_left(ts, b)
            acc = 0.0
            for t, strength, _ in on[lo:hi]:
                g = bisect.bisect_left(grid, t)
                near = min((abs(grid[k] - t) for k in (g - 1, g) if 0 <= k < len(grid)), default=1)
                if near <= 0.035:
                    acc += min(1.0, strength)
            sc[n] = acc / max(1.0, b - a) * (loud.get(n, 0) / mx) ** 0.5 * STEM_W.get(n, 0.8)
        res.append(sc)
    return res


def _cos(u, v):
    import math
    nu = math.sqrt(sum(x * x for x in u)) or 1e-9
    nv = math.sqrt(sum(x * x for x in v)) or 1e-9
    return sum(x * y for x, y in zip(u, v)) / (nu * nv)


def lead_labels(stems, phrases, scores):
    """묶음마다 따라갈 소리: 반복 구간끼리는 같은 소리(점수 합이 가장 큰 것), 혼자 튀는 묶음은 이웃에 맞춤"""
    chroma = stems.get("chroma") or []
    feats = []
    for a, b, i, j in phrases:
        f = []
        for k in range(i, i + PHRASE_BEATS):
            if k < min(j, len(chroma)):
                m = sum(chroma[k]) / 12
                f += [x - m for x in chroma[k]]       # 박마다 평균을 빼야 '다른 화음'끼리 덜 비슷하게 나옴
            else:
                f += [0.0] * 12
        feats.append(f)
    parent = list(range(len(phrases)))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x
    for x in range(len(phrases)):
        for y in range(x):
            if _cos(feats[x], feats[y]) >= SIM_SAME:
                parent[find(x)] = find(y)
    groups = {}
    for x in range(len(phrases)):
        groups.setdefault(find(x), []).append(x)
    labels = [None] * len(phrases)
    for members in groups.values():
        tot = {}
        for x in members:
            for n, v in scores[x].items():
                tot[n] = tot.get(n, 0) + v
        best = max(tot, key=tot.get) if tot else "drums"
        for x in members:
            labels[x] = best
    for x in range(1, len(phrases) - 1):          # 혼자 튀면 (점수 차가 작을 때만) 이웃 따라감
        l, r = labels[x - 1], labels[x + 1]
        if l == r != labels[x] and len(groups[find(x)]) == 1:
            s = scores[x]
            if s.get(l, 0) >= 0.85 * s.get(labels[x], 0):
                labels[x] = l
    return labels, [find(x) for x in range(len(phrases))]


def _near_count(times, ref, win):
    import bisect
    k = 0
    for t in times:
        i = bisect.bisect_left(ref, t)
        if any(0 <= j < len(ref) and abs(ref[j] - t) <= win for j in (i - 1, i)):
            k += 1
    return k


def _lag(times, ref):
    """후보 노트와 소리 위치 사이 전체 어긋남(초) — 분리한 소리 위치는 조금 늦게 잡혀서 그만큼 빼고 비교"""
    import bisect
    ds = []
    for t in times:
        i = bisect.bisect_left(ref, t)
        best = None
        for j in (i - 1, i):
            if 0 <= j < len(ref) and abs(ref[j] - t) <= 0.06 and (best is None or abs(ref[j] - t) < abs(best)):
                best = ref[j] - t
        if best is not None:
            ds.append(best)
    ds.sort()
    return ds[len(ds) // 2] if ds else 0.0


def consist_one(main, pool, stems, phrases, labels, duration):
    """한 난이도: 묶음마다 '따라갈 소리'에 가장 잘 맞는 후보를 고르되 (밀도는 본 채보와 비슷하게, 바꾸는 비용 있음)
    AI 노트는 그대로, 묶음 단위로 이어 붙임 → (노트, [묶음마다 고른 후보 이름])"""
    import bisect
    import math
    star = main[0]
    cands = [main] + [c for c in pool if c[2] != main[2] and abs(c[0] - star) <= NEAR_STAR]
    alignedc = []
    for c in cands:
        sh = 0.0 if c is main else _align(c[1], main[1])
        alignedc.append((c, sorted((dict(n, t=round(n["t"] + sh, 3)) for n in c[1]), key=lambda n: (n["t"], n["l"]))))
    ref = {n: sorted(x[0] for x in st["on"] if x[1] >= 0.15) for n, st in stems["stems"].items()}
    allref = sorted(t for v in ref.values() for t in v)
    lag = _lag(sorted({n["t"] for n in main[1]}), allref)
    P, C = len(phrases), len(alignedc)
    tlist = [[n["t"] for n in ns] for _, ns in alignedc]
    score = [[-9.0] * C for _ in range(P)]
    for p, (a, b, _, _) in enumerate(phrases):
        lead = ref.get(labels[p]) or allref
        mlo, mhi = bisect.bisect_left(tlist[0], a), bisect.bisect_left(tlist[0], b)
        dm = len({round(t, 3) for t in tlist[0][mlo:mhi]})
        for k in range(C):
            lo, hi = bisect.bisect_left(tlist[k], a), bisect.bisect_left(tlist[k], b)
            ts = sorted({round(t + lag, 3) for t in tlist[k][lo:hi]})
            if not ts:
                score[p][k] = -1.0 if dm else 0.0
                continue
            r = len(ts) / max(1, dm)
            if k and dm and not (0.8 <= r <= 1.25):
                continue                          # 그 구간만 확 어려워지거나 쉬워지는 후보는 안 씀
            prec = _near_count(ts, lead, HIT_WIN) / len(ts)
            strong = [t for t in lead if a <= t < b]
            rec = _near_count(strong, ts, HIT_WIN) / max(1, len(strong))
            score[p][k] = (1.25 * prec * rec / max(1e-6, 0.25 * prec + rec)) - (0.3 * abs(math.log(r)) if dm else 0) + (MAIN_BONUS if k == 0 else 0)
    # 바꾸는 비용을 넣고 처음부터 끝까지 가장 좋은 길 (비터비)
    best = [score[0][:]]
    back = [[0] * C]
    for p in range(1, P):
        row, br = [], []
        for k in range(C):
            prev = max(range(C), key=lambda q: best[-1][q] - (SWITCH_COST if q != k else 0))
            row.append(best[-1][prev] - (SWITCH_COST if prev != k else 0) + score[p][k])
            br.append(prev)
        best.append(row)
        back.append(br)
    k = max(range(C), key=lambda q: best[-1][q])
    path = [k]
    for p in range(P - 1, 0, -1):
        k = back[p][k]
        path.append(k)
    path.reverse()
    out = []
    for p, (a, b, _, _) in enumerate(phrases):
        nxt = path[p + 1] if p + 1 < P else path[p]
        for n in alignedc[path[p]][1]:
            if a <= n["t"] < b:
                n = dict(n)
                if nxt != path[p] and n["t"] + float(n.get("d", 0) or 0) > b - 0.08:
                    d = b - 0.08 - n["t"]
                    n["d"] = round(d, 3) if d >= 0.25 else 0.0      # 이음새를 넘는 롱노트는 자름
                out.append(n)
    names = [c[2] for c, _ in alignedc]
    table = [{names[k]: round(score[p][k], 3) for k in range(C) if score[p][k] > -9} for p in range(P)]
    return sorted(out, key=lambda n: (n["t"], n["l"])), [names[k] for k in path], table


def choose_consist(cands, targets, duration, stems):
    """일관성 방식: 평소처럼 난이도마다 본 채보를 고른 뒤, 묶음마다 따라갈 소리에 맞는 후보로 갈아 끼움 → (chosen, 기록)"""
    import chartgen
    base = choose(cands, targets, duration)
    phrases = phrases_of(stems or {}, duration)
    if not phrases:
        return base, None
    main_c = [c for c in cands if not c[2].endswith("_i")] or cands
    inst_c = [c for c in cands if c[2].endswith("_i") and len(c[1]) >= 50]
    active = active_secs(main_c, duration)
    pool = [c for c in main_c if coverage(c[1], active) >= MIN_COVER]
    byname = {c[2]: c for c in cands}
    scores = lead_scores(stems, phrases)
    labels, groups = lead_labels(stems, phrases, scores)
    log = {"phrases": [{"t": [round(a, 2), round(b, 2)], "lead": labels[p], "group": groups[p],
                        "scores": {n: round(v, 3) for n, v in scores[p].items()}} for p, (a, b, _, _) in enumerate(phrases)],
           "picks": {}}
    chosen = {}
    for d, c in base.items():
        main = byname.get(c[2].split("+")[0])
        if not main:
            chosen[d] = c
            continue
        notes, path, table = consist_one(main, pool, stems, phrases, labels, duration)
        log.setdefault("table", {})[d] = table
        notes, used = fill_gaps((main[0], notes, main[2]), main_c, inst_c, duration)
        star = chartgen.star_rating(notes, 4)
        if abs(star - c[0]) > STAR_KEEP:
            chosen[d] = c
            log["picks"][d] = f"평소 방식 그대로 (별 {c[0]:.1f}→{star:.1f}로 너무 달라짐)"
            continue
        tag = "일관성" + (("+" + "+".join(f"{n}({s:.0f}초)" for n, s in used[:3])) if used else "")
        chosen[d] = (star, notes, f"{main[2]}·{tag}")
        log["picks"][d] = path
    return chosen, log


def separate(wav, folder):
    """소리 분리(Demucs): 노래 → 보컬·드럼·베이스·나머지. 반주만 wav + 모든 소리의 시작 위치(초)를 돌려줌.
    설치가 안 돼 있거나 실패하면 None (그냥 원곡으로만 만듦)"""
    if not demucs_ok():
        return None
    try:
        import numpy as np
        import soundfile
        import librosa
        import torch
        from demucs.pretrained import get_model
        from demucs.apply import apply_model
        os.environ.setdefault("TORCH_HOME", str(ROOT / "cache" / "torch"))   # 분리 모델도 이 폴더 안에
        folder.mkdir(parents=True, exist_ok=True)
        say("  소리 분리 중... (보컬·드럼·베이스·나머지)")
        src44 = folder / "mix44.wav"
        flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        subprocess.run([ffmpeg_exe(), "-v", "error", "-y", "-i", str(wav), "-ac", "2", "-ar", "44100", str(src44)],
                       capture_output=True, creationflags=flags, check=True)
        x, sr = soundfile.read(str(src44), always_2d=True, dtype="float32")
        dev = "cuda" if torch.cuda.is_available() else "cpu"
        model = get_model("htdemucs")
        model.eval()
        model.to(dev)
        mix = torch.tensor(x.T, dtype=torch.float32)[None]
        ref = mix.mean(1)
        mu, sd = ref.mean(), ref.std() + 1e-8
        with torch.no_grad():
            out = apply_model(model, ((mix - mu) / sd).to(dev), shifts=1, split=True, overlap=0.25, progress=False)[0]
        out = (out * sd + mu).cpu().numpy()          # (소리 4개, 2, 길이)
        names = list(model.sources)                  # drums, bass, other, vocals
        del model
        if dev == "cuda":
            torch.cuda.empty_cache()
        inst = sum(out[i] for i, n in enumerate(names) if n != "vocals")
        inst_mono = librosa.resample(inst.mean(0), orig_sr=sr, target_sr=22050)
        inst_path = folder / "inst.wav"
        soundfile.write(str(inst_path), inst_mono.astype(np.float32), 22050)
        onsets = []
        ys = {}
        for i, n in enumerate(names):                # 소리마다 시작 위치 (보컬 포함 — '소리 없는 곳' 판단용)
            y = librosa.resample(out[i].mean(0), orig_sr=sr, target_sr=22050)
            if float(np.sqrt(np.mean(y ** 2))) < 1e-4:
                continue
            ys[n] = y
            ts = librosa.onset.onset_detect(y=y, sr=22050, units="time", backtrack=False, delta=0.07)
            onsets += [float(t) for t in ts]
        onsets.sort()
        stems = None
        try:
            stems = analyze_stems(ys, inst_mono)
        except Exception as e:
            traceback.print_exc()
            say(f"  ⚠ 소리별 분석을 건너뛰어요: {e}")
        merged = []
        for t in onsets:                              # 20ms 안에 겹치면 하나로
            if not merged or t - merged[-1] > 0.02:
                merged.append(round(t, 3))
        say(f"  소리 분리 끝: 소리 위치 {len(merged)}개")
        return {"inst": inst_path, "onsets": merged[:20000], "stems": stems}
    except Exception as e:
        traceback.print_exc()
        say(f"  ⚠ 소리 분리를 건너뛰어요: {e}")
        return None


def make_charts(vid, wav, targets, title, artist, duration, mode=""):
    """AI로 후보 채보를 여러 개 만들고, 기존 채보 ★와 비슷한 걸 난이도마다 하나씩 → (서버에 보낼 body, chosen)
    out\\<곡ID>\\ 에 후보 .osu · summary.json · upload.json 보관"""
    import chartgen
    t0 = time.time()
    mug = Mug()
    odir = OUT / vid
    if odir.exists():
        shutil.rmtree(odir, ignore_errors=True)
    seed = int(time.time()) % 100000000
    # 후보 종류: 원곡 / 원곡+스트림 많이 / (소리 분리가 되면) 반주만 — 반주만 넣으면 보컬만 따라가는 채보가 줄어듦
    variants = [(wav, {}, "a"), (wav, {"stream": True}, "s")]
    sep = separate(wav, WORK / ("sep_" + vid))
    onsets = None
    if sep:
        variants.append((sep["inst"], {}, "i"))
        onsets = sep["onsets"]
    made = mug.generate(variants, odir, SR_PROMPTS, seed=seed, title=title, artist=artist)
    cands = load_cands(odir, duration)
    if not cands:
        raise RuntimeError("AI가 채보를 제대로 만들지 못했어요.")
    chosen, log = choose(cands, targets, duration), None
    if sep and sep.get("stems"):
        (odir / "stems.json").write_text(json.dumps(sep["stems"]), encoding="utf-8")   # 다시 고를 때 쓰려고 보관
        if mode == "consist":
            try:
                chosen, log = choose_consist(cands, targets, duration, sep["stems"])
            except Exception as e:
                traceback.print_exc()
                say(f"  ⚠ 일관성 방식에서 문제가 생겨서 평소 방식으로 만들어요: {e}")
    if log:
        (odir / "sections.json").write_text(json.dumps(log, ensure_ascii=False, indent=1), encoding="utf-8")
    say(f"  {len(cands)}개 만들었어요 ({time.time() - t0:.0f}초)")
    body = {"charts": {d: c[1] for d, c in chosen.items()}, "by": f"MuG Diffusion v{mug.version}", "style": "rc"}
    if onsets:
        body["onsets"] = onsets      # 소리 분리로 찾은 진짜 소리 위치 → 서버가 '소리 없는 곳' 판단에 씀
    (odir / "upload.json").write_text(json.dumps(body, ensure_ascii=False), encoding="utf-8")
    write_summary(odir, vid, title, seed, body["by"], targets, chosen, cands, mode="consist" if log else "")
    return body, chosen


def cmd_gen(vid, audio, targets_file, out_file, title="", artist="", duration=900.0):
    """링크비트 실행기의 채보 엔진이 부름: 받은 오디오 + 기존 채보 ★ → AI 채보 json (인터넷 안 씀)"""
    targets = json.loads(Path(targets_file).read_text(encoding="utf-8"))
    targets = {d: float(v) for d, v in targets.items() if d in DIFF_ORDER}
    if not targets:
        raise RuntimeError("기존 채보 별점이 없어요.")
    wdir = WORK / ("gen_" + vid)
    try:
        say("AI: 오디오 준비 중...")
        wav = to_wav(Path(audio), wdir)
        body, _ = make_charts(vid, wav, targets, title, artist, duration)
        Path(out_file).write_text(json.dumps(body, ensure_ascii=False), encoding="utf-8")
        say("AI: 완료")
    finally:
        shutil.rmtree(wdir, ignore_errors=True)
        shutil.rmtree(WORK / ("sep_" + vid), ignore_errors=True)


def upload(srv, vid, body):
    while True:
        try:
            return srv.call("PUT", f"songs/{vid}/ai", body, timeout=120)
        except PermissionError:
            say("호스트 키가 맞지 않아요. 다시 넣어 주세요.")
            st = load_settings()
            st.pop("hostKey", None)
            save_settings(st)
            srv = get_server(need_key=True)
        except LookupError:
            raise SystemExit("\n서버에 아직 'AI 채보' 기능이 안 올라가 있어요. 만든 채보는 저장해 뒀어요.\n"
                             f"기능을 올린 다음 2_AI채보만들기.bat --upload {vid} 로 다시 보내면 돼요.")


def cmd_resend(vid):
    p = OUT / vid / "upload.json"
    if not p.exists():
        raise SystemExit("이 곡으로 만들어 둔 AI 채보가 없어요.")
    r = upload(get_server(need_key=True), vid, json.loads(p.read_text(encoding="utf-8")))
    say(f"서버에 다시 보냈어요: {r.get('counts')}")


def cmd_export():
    """확인용: 서버의 곡 데이터(기존·AI 채보) + out 폴더의 AI 원본 후보를 zip 하나로 (기록·프로필은 안 넣음)"""
    import zipfile
    srv = get_server(need_key=False)
    lst = srv.call("GET", "songs").get("songs", [])
    dst = ROOT / f"확인용_{time.strftime('%m%d_%H%M')}.zip"
    with zipfile.ZipFile(dst, "w", zipfile.ZIP_DEFLATED) as z:
        for i, s0 in enumerate(lst):
            say(f"  곡 데이터 {i + 1}/{len(lst)}: {s0.get('title', s0['id'])[:40]}")
            try:
                d = srv.call("GET", f"songs/{s0['id']}")
            except Exception as e:
                say(f"    건너뜀: {e}")
                continue
            d.pop("board", None)
            z.writestr(f"songs/{s0['id']}.json", json.dumps(d, ensure_ascii=False))
        if OUT.exists():
            for f in OUT.rglob("*"):
                if f.is_file() and f.suffix in (".osu", ".json"):
                    z.write(f, "out/" + str(f.relative_to(OUT)).replace("\\", "/"))
    say(f"\n만들었어요: {dst}\n이 파일을 채팅에 올려 주세요. ({dst.stat().st_size // 1024} KB)")


def rebuild(srv, vid):
    """out\\<곡ID>\\ 에 남은 후보로 빈칸 채우기를 새 규칙으로 다시 (그래픽카드 안 씀)
    난이도마다 예전에 고른 후보는 그대로 두고, 곡 대부분을 비운 후보만 다시 고름 → 바뀐 upload.json (없으면 None)"""
    import chartgen
    odir = OUT / vid
    sp, up = odir / "summary.json", odir / "upload.json"
    if not sp.exists() or not up.exists() or not any(odir.glob("sr*_i.osu")):
        return None                        # 소리 분리 전에 만든 곡은 그대로 보냄
    summary = json.loads(sp.read_text(encoding="utf-8"))
    old = json.loads(up.read_text(encoding="utf-8"))
    song = srv.call("GET", f"songs/{vid}")
    duration = float(song.get("duration") or 900)
    cands = load_cands(odir, duration)
    stp = odir / "stems.json"
    if summary.get("mode") == "consist" and stp.exists():        # 일관성 방식으로 만든 곡은 그 방식으로 다시
        basic = song.get("charts") or {}
        targets = summary.get("targets") or {d: chartgen.star_rating(basic[d], 4) for d in DIFF_ORDER if basic.get(d)}
        chosen, log = choose_consist(cands, targets, duration, json.loads(stp.read_text(encoding="utf-8")))
        if log:
            (odir / "sections.json").write_text(json.dumps(log, ensure_ascii=False, indent=1), encoding="utf-8")
        body = dict(old, charts={d: c[1] for d, c in chosen.items()})
        up.write_text(json.dumps(body, ensure_ascii=False), encoding="utf-8")
        write_summary(odir, vid, summary.get("title", ""), summary.get("seed"), summary.get("model", ""),
                      targets, chosen, cands, mode="consist" if log else "")
        return body
    byname = {c[2]: c for c in cands}
    main_c = [c for c in cands if not c[2].endswith("_i")] or cands
    inst_c = [c for c in cands if c[2].endswith("_i") and len(c[1]) >= 50]
    active = active_secs(main_c, duration)
    keep, redo = {}, []
    for d, info in (summary.get("chosen") or {}).items():
        c = byname.get(str(info.get("file", "")).split("+")[0])
        if c and coverage(c[1], active) >= MIN_COVER:
            keep[d] = c
        else:
            redo.append(d)
    if redo:
        basic = song.get("charts") or {}
        targets = summary.get("targets") or {d: chartgen.star_rating(basic[d], 4) for d in DIFF_ORDER if basic.get(d)} or \
            {d: float(v.get("stars", 0)) for d, v in summary["chosen"].items()}
        again = pick_for_diffs(main_c, relative_targets(targets), active)
        for d in redo:
            c = again.get(d) or byname.get(str(summary["chosen"][d].get("file", "")).split("+")[0])
            if c:
                keep[d] = c
    chosen = {}
    for d in DIFF_ORDER:
        if d not in keep:
            continue
        c = keep[d]
        notes, used = fill_gaps(c, main_c, inst_c, duration)
        tag = ("+" + "+".join(f"{n}({s:.0f}초)" for n, s in used[:4])) if used else ""
        chosen[d] = (chartgen.star_rating(notes, 4), notes, c[2] + tag)
    if not chosen:
        return None
    body = dict(old, charts={d: c[1] for d, c in chosen.items()})
    up.write_text(json.dumps(body, ensure_ascii=False), encoding="utf-8")
    write_summary(odir, vid, summary.get("title", ""), summary.get("seed"), summary.get("model", ""),
                  summary.get("targets"), chosen, cands)
    return body


def cmd_resend_all():
    """out 폴더에 남아 있는 AI 원본 채보를 전부 서버에 다시 보냄 (서버가 새 방식으로 다시 다듬음, 그래픽카드 안 씀)
    소리 분리로 만든 곡은 남은 후보로 빈칸 채우기를 새 규칙으로 다시 한 다음 보냄"""
    srv = get_server(need_key=True)
    files = sorted(OUT.glob("*/upload.json")) if OUT.exists() else []
    if not files:
        say("다시 보낼 AI 채보가 없어요.")
        return
    ok = 0
    for i, p in enumerate(files):
        vid = p.parent.name
        try:
            note = ""
            try:
                body = rebuild(srv, vid)
                if body:
                    note = " (빈칸 다시 채움)"
            except Exception as e:
                body = None
                note = f" (다시 채우기 건너뜀: {e})"
            body = body or json.loads(p.read_text(encoding="utf-8"))
            r = upload(srv, vid, body)
            ok += 1
            say(f"  {i + 1}/{len(files)} 보냄: {vid} {r.get('stars', '')}{note}")
        except SystemExit:
            raise
        except Exception as e:
            say(f"  {i + 1}/{len(files)} 건너뜀: {vid} ({e})")
    say(f"\n{ok}곡을 다시 보냈어요. 게임을 새로고침하면 반영돼요.")


def cmd_undo(vid=None):
    srv = get_server(need_key=True)
    if vid:
        ids = [vid]
    else:
        lst = srv.call("GET", "songs").get("songs", [])
        ids = [s["id"] for s in lst if s.get("ai")]
    if not ids:
        say("서버에 AI 채보가 있는 곡이 없어요. 이미 원래대로예요.")
        return
    for sid in ids:
        r = srv.call("DELETE", f"songs/{sid}/ai")
        say(f"  {'지웠어요' if r.get('removed') else '없었어요'}: {sid}")
    say(f"AI 채보 {len(ids)}곡을 서버에서 지웠어요. 기본 채보와 기록은 그대로예요.")


BACKUP = ROOT / "backup"     # 시험 전 AI 채보 보관 (되돌리기용)


def cmd_consist(ids):
    """일관성 방식 시험: 곡마다 지금 AI 채보(out 폴더)를 backup 에 보관 → 일관성 방식으로 새로 만들어 서버에 올림"""
    srv = get_server(need_key=True)
    ids = [parse_vid(x) or x for x in ids if x.strip()]
    say(f"일관성 방식 시험: {len(ids)}곡 (곡마다 3~5분)")
    done = []
    for k, vid in enumerate(ids):
        say(f"\n========== {k + 1}/{len(ids)}: {vid} ==========")
        src = OUT / vid
        if src.exists() and not (BACKUP / vid).exists():      # 맨 처음 것만 보관 (여러 번 시험해도 원래 것으로 되돌아가게)
            shutil.copytree(src, BACKUP / vid)
            say(f"  지금 AI 채보를 보관했어요: backup\\{vid}")
        try:
            cmd_make(vid, mode="consist", srv=srv)
            done.append(vid)
        except SystemExit as e:
            say(f"  건너뜀: {e}")
        except Exception as e:
            traceback.print_exc()
            say(f"  건너뜀: {e}")
    say(f"\n끝! {len(done)}/{len(ids)}곡을 일관성 방식으로 바꿨어요. 게임을 새로고침하고 쳐 보세요.")
    say("마음에 안 들면 7_일관성시험되돌리기.bat 을 실행하면 시험 전 AI 채보로 돌아가요.")


def cmd_restore_test():
    """일관성 시험 되돌리기: backup 에 보관한 AI 채보를 out 폴더로 되돌리고 서버에 다시 보냄"""
    srv = get_server(need_key=True)
    dirs = sorted(d for d in BACKUP.iterdir() if d.is_dir()) if BACKUP.exists() else []
    if not dirs:
        say("되돌릴 게 없어요 (보관한 AI 채보가 없어요).")
        return
    for d in dirs:
        vid = d.name
        dst = OUT / vid
        if dst.exists():
            shutil.rmtree(dst)
        shutil.copytree(d, dst)
        r = upload(srv, vid, json.loads((dst / "upload.json").read_text(encoding="utf-8"))) if (dst / "upload.json").exists() else {}
        shutil.rmtree(d)
        say(f"  되돌렸어요: {vid} {r.get('stars', '')}")
    say("\n시험 전 AI 채보로 돌아갔어요. 게임을 새로고침하면 반영돼요.")


def main():
    ap = argparse.ArgumentParser(description="링크비트 AI 채보 도구")
    ap.add_argument("--consist", nargs="+", default=None, help="일관성 방식으로 다시 만들기 (곡 ID 여러 개)")
    ap.add_argument("--restore-test", action="store_true", help="일관성 시험 되돌리기")
    ap.add_argument("link", nargs="?", default="")
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--undo", action="store_true")
    ap.add_argument("--export", action="store_true", help="확인용 zip 만들기")
    ap.add_argument("--resend-all", action="store_true", help="out 폴더의 AI 원본을 전부 서버에 다시 보내기")
    ap.add_argument("--upload", default="", help="만들어 둔 AI 채보를 서버에 다시 보내기 (곡 ID)")
    # 링크비트 실행기(채보 엔진)용
    ap.add_argument("--gen", default="", help="곡 ID (엔진용: --audio --targets --out 와 함께)")
    ap.add_argument("--audio", default="")
    ap.add_argument("--targets", default="")
    ap.add_argument("--out", default="")
    ap.add_argument("--title", default="")
    ap.add_argument("--artist", default="")
    ap.add_argument("--duration", type=float, default=900.0)
    # 유튜브 ID가 '-'로 시작하면(예: -tKVN2mAKRI) 옵션으로 오해하지 않게 '--gen=ID' 꼴로 바꿈
    argv = sys.argv[1:]
    for i, x in enumerate(argv[:-1]):
        if x in ("--gen", "--upload", "--title", "--artist") and argv[i + 1].startswith("-"):
            argv[i:i + 2] = [f"{x}={argv[i + 1]}"]
            break
    a = ap.parse_args(argv)
    try:
        if a.gen:
            cmd_gen(a.gen, a.audio, a.targets, a.out, a.title, a.artist, a.duration)
            return
        if a.check:
            sys.exit(0 if cmd_check() else 1)
        if a.consist:
            cmd_consist(a.consist)
            return
        if a.restore_test:
            cmd_restore_test()
            return
        if a.resend_all:
            cmd_resend_all()
            return
        if a.export:
            cmd_export()
            return
        if a.upload:
            cmd_resend(parse_vid(a.upload) or a.upload)
            return
        if a.undo:
            cmd_undo(parse_vid(a.link) if a.link else None)
            return
        link = a.link or input("AI 채보를 만들 유튜브 링크 (게임에 이미 있는 곡): ").strip()
        cmd_make(link)
    except SystemExit:
        raise
    except KeyboardInterrupt:
        say("\n멈췄어요.")
    except Exception as e:
        traceback.print_exc()
        low = str(e).lower()
        if "out of memory" in low:
            say("\n그래픽카드 메모리가 부족해요. 다른 프로그램(게임 등)을 끄고 다시 해 주세요.")
        else:
            say(f"\n문제가 생겼어요: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
