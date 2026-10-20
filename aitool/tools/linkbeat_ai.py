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
BAND_MID = {"easy": 2.0, "normal": 4.0, "hard": 6.5, "extreme": 8.5}
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


def pick_for_diffs(cands, targets):
    """cands: [(★, notes, 이름)], targets: {diff: 기본 채보 ★}. 난이도 순서가 뒤집히지 않게 가장 가까운 것 고르기."""
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

    def generate(self, wav, out_dir, sr_list, count, step=100, scale=5.0, seed=1234, title="", artist=""):
        """sr_list의 별점마다 count개씩 생성 → [(osu 경로, sr)]"""
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
            audio = load_audio_without_cache(str(wav), dataset.n_mels, hop, dataset.n_fft, dataset.sr, None)
            t = audio.shape[1]
            ratio = dataset.max_audio_frame // model.z_length
            map_len = (int((t / ratio) / 32) + 1) * 32
            dataset.max_audio_frame = map_len * ratio
            model.z_length = map_len
            if t < dataset.max_audio_frame:
                audio = np.concatenate([audio, np.zeros((dataset.n_mels, dataset.max_audio_frame - t), dtype=np.float32)], axis=1)
            elif t > dataset.max_audio_frame:
                audio = audio[:, :dataset.max_audio_frame]
            w = torch.tensor(np.stack([audio for _ in range(count)]), dtype=torch.float32).to(model.device)
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
                # 후보 절반은 '스트림 많이' 조건 (단일 노트 연타가 어울리는 곡에서 고를 수 있게)
                c = self._features(count, [base, dict(base, stream=True)])
                samples, _ = self.sampler.sample(S=step, c=c, w=w, batch_size=count, shape=None, verbose=False,
                                                 unconditional_guidance_scale=scale, unconditional_conditioning=uc,
                                                 eta=0.0, tqdm_class=tqdm)
                xs = model.model.decode(samples).cpu().numpy()
                for i, x in enumerate(xs):
                    name = f"sr{sr:.1f}_{i + 1}"
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
    except Exception as e:
        ok = False
        say(f"  오류 {e}")
        traceback.print_exc()
    say("설치 확인 끝: " + ("모두 정상이에요." if ok else "빠진 게 있어요. 1_설치.bat 을 다시 실행해 주세요."))
    return ok


def cmd_make(link):
    import chartgen
    srv = get_server(need_key=True)
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
    body, chosen = make_charts(vid, wav, targets, title, song.get("artist", ""), song.get("duration") or 900)

    say("\n[4/4] 서버에 'AI 채보'로 따로 저장 (기본 채보는 그대로)")
    r = upload(srv, vid, body)
    shutil.rmtree(wdir, ignore_errors=True)   # 오디오는 지움 (채보만 남김)
    say("\n완료! 난이도별 비교 (★ = 링크비트 별점)")
    say("  난이도      기본 채보          AI 채보")
    for d in DIFF_ORDER:
        if d in chosen:
            say(f"  {DIFF_KO[d]:<6}  ★{targets[d]:4.1f} {len(basic[d]):5d}노트   ★{chosen[d][0]:4.1f} {len(chosen[d][1]):5d}노트")
    say("\n게임에서 이 곡을 고르면 4키는 AI 채보로 플레이돼요. ('AI 채보' 칩을 끄면 기존 채보)")
    return r


def make_charts(vid, wav, targets, title, artist, duration):
    """AI로 후보 채보를 여러 개 만들고, 기존 채보 ★와 비슷한 걸 난이도마다 하나씩 → (서버에 보낼 body, chosen)
    out\\<곡ID>\\ 에 후보 .osu · summary.json · upload.json 보관"""
    import chartgen
    t0 = time.time()
    mug = Mug()
    odir = OUT / vid
    if odir.exists():
        shutil.rmtree(odir, ignore_errors=True)
    seed = int(time.time()) % 100000000
    made = mug.generate(wav, odir, SR_PROMPTS, PER_PROMPT, seed=seed, title=title, artist=artist)
    cands = []
    for path, sr in made:
        notes = [n for n in osu_to_notes(path) if n["t"] <= duration + 1]
        if len(notes) < 20:
            continue
        cands.append((chartgen.star_rating(notes, 4), notes, path.stem))
    if not cands:
        raise RuntimeError("AI가 채보를 제대로 만들지 못했어요.")
    chosen = pick_for_diffs(cands, {d: BAND_MID.get(d, v) for d, v in targets.items()})
    say(f"  {len(cands)}개 만들었어요 ({time.time() - t0:.0f}초)")
    body = {"charts": {d: c[1] for d, c in chosen.items()}, "by": f"MuG Diffusion v{mug.version}", "style": "rc"}
    (odir / "upload.json").write_text(json.dumps(body, ensure_ascii=False), encoding="utf-8")
    summary = {"vid": vid, "title": title, "at": time.time(), "seed": seed, "model": body["by"],
               "chosen": {d: {"file": c[2], "stars": c[0], "notes": len(c[1])} for d, c in chosen.items()},
               "candidates": [{"file": c[2], "stars": c[0], "notes": len(c[1])} for c in sorted(cands, key=lambda c: c[0])]}
    (odir / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=1), encoding="utf-8")
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


def cmd_resend_all():
    """out 폴더에 남아 있는 AI 원본 채보를 전부 서버에 다시 보냄 (서버가 새 방식으로 다시 다듬음, 그래픽카드 안 씀)"""
    srv = get_server(need_key=True)
    files = sorted(OUT.glob("*/upload.json")) if OUT.exists() else []
    if not files:
        say("다시 보낼 AI 채보가 없어요.")
        return
    ok = 0
    for i, p in enumerate(files):
        vid = p.parent.name
        try:
            r = upload(srv, vid, json.loads(p.read_text(encoding="utf-8")))
            ok += 1
            say(f"  {i + 1}/{len(files)} 보냄: {vid} {r.get('stars', '')}")
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


def main():
    ap = argparse.ArgumentParser(description="링크비트 AI 채보 도구")
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
