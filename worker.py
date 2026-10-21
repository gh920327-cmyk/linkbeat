"""
링크비트 PC 채보 엔진 — 호스트 PC에서만 돌아가요 (LINKBEAT 실행기가 자동으로 켜고 끔)
 - 클라우드 서버의 대기열(호스트가 추가했거나 승인한 곡)을 하나씩 가져와서
   유튜브 음원 받기 → 채보 분석 → 결과만 서버로 올려요. 서버는 꺼지지 않아요.
 - --import <예전 링크비트 폴더>: PC에서 쓰던 곡·기록·프로필·신청을 서버로 옮겨요.

상태는 한 줄짜리 JSON으로 출력해요 (실행기가 읽어서 화면에 보여줌):
  {"state": "ready" | "working" | "offline" | "error" | "import", "msg": "..."}
"""
import argparse
import json
import os
import ssl
import subprocess
import sys
import tempfile
import time
import traceback
import urllib.error
import urllib.request
from pathlib import Path

VERSION = "1.2.6"

# 가상환경의 실행 파일 폴더(deno 등)를 PATH 앞에 → yt-dlp가 JS 런타임을 찾을 수 있게
os.environ["PATH"] = str(Path(sys.executable).parent) + os.pathsep + os.environ.get("PATH", "")
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)
except Exception:
    pass


def _ssl_context():
    """HTTPS 인증서 확인: 윈도우 인증서 목록에 최신 루트 인증서(Let's Encrypt 등)가 없는 PC도 있어서
    certifi(파이썬 패키지에 들어 있는 인증서 목록)도 함께 씀"""
    ctx = ssl.create_default_context()
    try:
        import certifi
        ctx.load_verify_locations(cafile=certifi.where())
    except Exception:
        pass
    return ctx


SSL_CTX = _ssl_context()


# ------------------------------------------------------------------ AI 채보 도구 (선택: 호스트 PC에 설치돼 있으면)
AUDIO_CACHE = Path(tempfile.gettempdir()) / "linkbeat_ai_audio"     # 기존 채보 만들 때 받은 오디오 (AI 채보에 다시 씀)


def find_ai():
    """F:\\LinkbeatAI 같은 AI 채보 도구 폴더 찾기 (LB_AI_DIR 환경 변수 → 각 드라이브의 LinkbeatAI)"""
    cands = []
    if os.environ.get("LB_AI_DIR"):
        cands.append(Path(os.environ["LB_AI_DIR"]))
    if os.name == "nt":
        cands += [Path(f"{c}:\\LinkbeatAI") for c in "FDEGHCIJK"]
    for d in cands:
        py = d / "venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
        tool = d / "tools" / "linkbeat_ai.py"
        ck = d / "mug" / "models" / "ckpt" / "model.ckpt"
        try:
            if py.exists() and tool.exists() and ck.exists():
                return {"dir": d, "py": py, "tool": tool}
        except OSError:
            continue
    return None


AI = None
AI_CHECKED = 0.0


def ai_tool():
    """1분마다 다시 확인 (설치하거나 지우면 실행기를 다시 안 켜도 반영)"""
    global AI, AI_CHECKED
    if time.time() - AI_CHECKED > 60:
        AI_CHECKED = time.time()
        AI = find_ai()
    return AI


# ------------------------------------------------------------------ AI 캐릭터 그림 (선택: 호스트 PC에 ComfyUI가 있으면)
AVATAR_SCRIPT = Path(__file__).resolve().parent / "avatar_gen.py"


def find_comfy():
    """ComfyUI(포터블) 폴더 찾기: LB_COMFY_DIR → 각 드라이브의 ComfyUI_AI\\ComfyUI_windows_portable · ComfyUI_windows_portable
    애니풍 모델(animagine-xl-4.0)이 있어야 씀"""
    cands = []
    if os.environ.get("LB_COMFY_DIR"):
        cands.append(Path(os.environ["LB_COMFY_DIR"]))
    if os.name == "nt":
        for c in "FDEGHCIJK":
            cands += [Path(f"{c}:\\ComfyUI_AI\\ComfyUI_windows_portable"), Path(f"{c}:\\ComfyUI_windows_portable")]
    for d in cands:
        try:
            if ((d / "python_embeded" / "python.exe").exists() and (d / "ComfyUI" / "main.py").exists()
                    and (d / "ComfyUI" / "models" / "checkpoints" / "animagine-xl-4.0.safetensors").exists()):
                return d
        except OSError:
            continue
    return None


COMFY = None
COMFY_CHECKED = 0.0


def comfy_dir():
    global COMFY, COMFY_CHECKED
    if time.time() - COMFY_CHECKED > 60:
        COMFY_CHECKED = time.time()
        COMFY = find_comfy() if AVATAR_SCRIPT.exists() else None
    return COMFY


def status(state, msg="", **extra):
    print(json.dumps(dict(state=state, msg=msg, **extra), ensure_ascii=False), flush=True)


class Cancelled(Exception):
    pass


class Api:
    def __init__(self, server, key):
        self.base = server.rstrip("/")
        self.key = key

    def call(self, path, body=None, timeout=60, method="POST"):
        data = json.dumps(body if body is not None else {}, ensure_ascii=False).encode("utf-8") if method != "GET" else None
        req = urllib.request.Request(self.base + "/api/" + path, data=data, method=method,
                                     headers={"Content-Type": "application/json", "X-Host-Key": self.key,
                                              "User-Agent": f"LinkbeatEngine/{VERSION}"})
        try:
            with urllib.request.urlopen(req, timeout=timeout, context=SSL_CTX) as r:
                return json.loads(r.read().decode("utf-8") or "{}")
        except urllib.error.HTTPError as e:
            try:
                msg = json.loads(e.read().decode("utf-8")).get("error") or str(e)
            except Exception:
                msg = str(e)
            if e.code == 403:
                raise PermissionError("호스트 키가 맞지 않아요. 실행기에서 호스트 키를 다시 넣어 주세요.")
            raise RuntimeError(msg)


def make_progress(api, job):
    jid = job["id"]
    last = [0.0]

    def progress(stage, msg, force=False):
        now = time.time()
        if not force and now - last[0] < 1.0:
            return
        last[0] = now
        status("working", f"{job.get('title') or job['vid']} · {msg}")
        try:
            r = api.call("worker/progress", {"jobId": jid, "stage": stage, "msg": msg, "version": VERSION,
                                             "ai": bool(ai_tool())}, timeout=15)
        except Exception:
            return
        if r.get("ok") is False:
            raise Cancelled()
    return progress


def run_ai_job(api, job):
    """AI 채보만 만들기: 기존 채보 ★에 맞춰 AI 채보 생성 → 서버에 따로 저장 (기존 채보는 그대로)"""
    import chartgen
    import pipeline
    vid, jid = job["vid"], job["id"]
    progress = make_progress(api, job)
    tool = ai_tool()
    try:
        if not tool:
            raise RuntimeError("이 PC에 AI 채보 도구(LinkbeatAI)가 없어요.")
        progress("info", "AI 채보 준비 중...", force=True)
        song = api.call(f"songs/{vid}", method="GET", timeout=30)
        charts = song.get("charts") or {}
        targets = {d: chartgen.star_rating(n, 4) for d, n in charts.items() if n}
        if not targets:
            raise RuntimeError("기존 4키 채보가 없어요.")
        AUDIO_CACHE.mkdir(parents=True, exist_ok=True)
        cached = [f for f in AUDIO_CACHE.glob(vid + ".*") if f.is_file()]
        with tempfile.TemporaryDirectory() as td:
            if cached:
                audio = cached[0]
            else:
                audio, _ = pipeline.download_audio(vid, td, progress)
            tfile, ofile = Path(td) / "targets.json", Path(td) / "ai.json"
            tfile.write_text(json.dumps(targets), encoding="utf-8")
            progress("ai", "AI가 채보 쓰는 중... (그래픽카드로 2~5분)", force=True)
            env = dict(os.environ, PYTHONIOENCODING="utf-8")
            cmd = [str(tool["py"]), "-I", str(tool["tool"]), "--gen=" + vid, "--audio", str(audio),   # ID가 '-'로 시작해도 되게
                   "--targets", str(tfile), "--out", str(ofile), "--title=" + str(song.get("title", ""))[:100],
                   "--artist=" + str(song.get("artist", ""))[:80], "--duration", str(song.get("duration") or 900)]
            flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
            proc = subprocess.Popen(cmd, cwd=str(tool["dir"]), stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                    env=env, creationflags=flags)
            tail = []
            try:
                for raw in proc.stdout:
                    line = raw.decode("utf-8", "replace").strip()
                    if not line:
                        continue
                    tail = (tail + [line])[-8:]
                    if "AI가 채보 쓰는 중" in line or "모델 불러오는" in line or "만들었어요" in line:
                        progress("ai", line.strip()[:120])
                proc.wait()
            except Cancelled:
                proc.kill()
                raise
            if proc.returncode != 0 or not ofile.exists():
                msg = next((l for l in reversed(tail) if "문제가 생겼어요" in l or "메모리" in l), tail[-1] if tail else "")
                raise RuntimeError("AI 채보 실패: " + msg[:200])
            body = json.loads(ofile.read_text(encoding="utf-8"))
        for f in cached:
            try:
                f.unlink()
            except OSError:
                pass
        progress("upload", "AI 채보 올리는 중...", force=True)
        r = api.call("worker/done", {"jobId": jid, "ai": body, "version": VERSION}, timeout=180)
        status("ready", f"AI 채보 완료: {job.get('title') or vid}" if r.get("ok") else f"저장 실패: {r.get('msg', '')}")
    except Cancelled:
        status("ready", f"취소됨: {job.get('title') or vid}")
    except PermissionError:
        raise
    except Exception as e:
        traceback.print_exc(file=sys.stderr)
        msg = str(e)[:300]
        status("ready", f"AI 채보 실패: {job.get('title') or vid} · {msg}")
        try:
            api.call("worker/fail", {"jobId": jid, "msg": msg, "version": VERSION}, timeout=15)
        except Exception:
            pass


def run_avatar_job(api, job):
    """AI 캐릭터: 호스트 PC의 ComfyUI로 일러스트·도트를 그려서 서버에 올림"""
    import base64
    jid = job["id"]
    title = job.get("title") or "캐릭터"

    def progress(msg):
        status("working", f"{title} · {msg}")
        try:
            api.call("worker/progress", {"jobId": jid, "msg": msg, "version": VERSION}, timeout=15)
        except Exception:
            pass
    try:
        cd = comfy_dir()
        if not cd:
            raise RuntimeError("이 PC에서 ComfyUI(애니풍 모델)를 찾지 못했어요.")
        progress("그림 준비 중...")
        with tempfile.TemporaryDirectory() as td:
            spec = Path(td) / "spec.json"
            ref = None
            if job.get("ref"):
                ext = job.get("refExt") if job.get("refExt") in ("jpg", "png", "webp") else "jpg"
                ref = Path(td) / f"ref.{ext}"
                ref.write_bytes(base64.b64decode(job["ref"]))
            spec.write_text(json.dumps({"avatar": job.get("avatar") or {}, "desc": job.get("desc", ""), "mode": job.get("mode", "all"),
                                        "strength": job.get("strength", "mid"), "useLook": job.get("useLook", True),
                                        "ref": str(ref) if ref else ""}, ensure_ascii=False), encoding="utf-8")
            flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
            proc = subprocess.Popen([str(cd / "python_embeded" / "python.exe"), "-s", str(AVATAR_SCRIPT), "--comfy", str(cd),
                                     "--spec", str(spec), "--out", td], cwd=str(cd), stdout=subprocess.PIPE,
                                    stderr=subprocess.STDOUT, creationflags=flags, env=dict(os.environ, PYTHONIOENCODING="utf-8"))
            err, last = "", 0.0
            for raw in proc.stdout:
                line = raw.decode("utf-8", "replace").strip()
                try:
                    d = json.loads(line)
                except Exception:
                    continue
                if d.get("error"):
                    err = d["error"]
                elif d.get("p") and time.time() - last > 1.5:
                    last = time.time()
                    progress(d["p"])
            proc.wait()
            il, px = Path(td) / "illust.webp", Path(td) / "pixel.png"
            if proc.returncode != 0 or not px.exists() or (not il.exists() and job.get("mode") != "pixel"):
                raise RuntimeError(err or "그림을 만들지 못했어요.")
            images = {"illust": base64.b64encode(il.read_bytes()).decode() if il.exists() else "",
                      "pixel": base64.b64encode(px.read_bytes()).decode()}
            sh = Path(td) / "sheet.png"
            if sh.exists():
                images["sheet"] = base64.b64encode(sh.read_bytes()).decode()
        progress("올리는 중...")
        r = api.call("worker/done", {"jobId": jid, "images": images, "version": VERSION}, timeout=120)
        status("ready", f"캐릭터 완성: {title}" if r.get("ok") else f"캐릭터 저장 실패: {r.get('msg', '')}")
    except PermissionError:
        raise
    except Exception as e:
        traceback.print_exc(file=sys.stderr)
        msg = str(e)[:300]
        status("ready", f"캐릭터 실패: {title} · {msg}")
        try:
            api.call("worker/fail", {"jobId": jid, "msg": msg, "version": VERSION}, timeout=15)
        except Exception:
            pass


def clean_audio_cache():
    """하루 넘은 오디오는 지움 (AI 작업이 취소됐거나 실패한 곡)"""
    try:
        for f in AUDIO_CACHE.glob("*"):
            if time.time() - f.stat().st_mtime > 86400:
                f.unlink()
    except OSError:
        pass


def run_job(api, job):
    if job.get("kind") == "avatar":
        return run_avatar_job(api, job)
    import pipeline
    if job.get("aiOnly"):
        return run_ai_job(api, job)
    jid = job["id"]
    progress = make_progress(api, job)

    try:
        progress("info", "시작", force=True)
        meta, res = pipeline.analyze(job["vid"], progress, keep_audio=AUDIO_CACHE if ai_tool() else None)
        progress("upload", "서버로 올리는 중...", force=True)
        r = api.call("worker/done", {"jobId": jid, "meta": meta, "res": res, "version": VERSION}, timeout=180)
        if r.get("ok"):
            status("ready", f"완료: {meta.get('title') or job['vid']}")
        else:
            status("ready", f"저장 실패: {r.get('msg', '')}")
    except Cancelled:
        status("ready", f"취소됨: {job.get('title') or job['vid']}")
    except PermissionError:
        raise
    except Exception as e:
        traceback.print_exc(file=sys.stderr)
        msg = pipeline.friendly_error(e, updater="실행기를 다시 켜서")
        status("ready", f"실패: {job.get('title') or job['vid']} · {msg}")
        try:
            api.call("worker/fail", {"jobId": jid, "msg": msg, "version": VERSION}, timeout=15)
        except Exception:
            pass


def loop(api):
    status("ready", "서버 연결 중...")
    clean_audio_cache()
    t = ai_tool()
    if t:
        status("ready", f"AI 채보 도구 찾음: {t['dir']}")
    c = comfy_dir()
    if c:
        status("ready", f"AI 캐릭터용 ComfyUI 찾음: {c}")
    fails = 0
    while True:
        try:
            r = api.call("worker/poll", {"version": VERSION, "ai": bool(ai_tool()), "avatar": bool(comfy_dir())}, timeout=20)
            if fails:
                status("ready", "서버에 다시 연결됐어요")
            fails = 0
        except PermissionError as e:
            status("error", str(e))
            time.sleep(30)
            continue
        except Exception as e:
            fails += 1
            status("offline", f"서버에 연결할 수 없어요 ({str(e)[:80]}). 다시 시도 중...")
            time.sleep(min(30, 3 * fails))
            continue
        job = r.get("job")
        if job:
            run_job(api, job)
        else:
            if fails == 0:
                status("ready", "대기 중" + (" · AI 채보 켜짐" if ai_tool() else ""))
            time.sleep(3)


def import_dir(api, folder):
    """예전 링크비트 폴더(또는 그 안의 data 폴더)에서 서버로 옮기기"""
    root = Path(folder)
    data = root / "data" if (root / "data").is_dir() else root
    if not (data / "songs").is_dir():
        raise RuntimeError("그 폴더에는 링크비트 곡(data/songs)이 없어요. start.bat 이 있던 폴더를 골라 주세요.")

    def read(p):
        try:
            return json.loads(p.read_text(encoding="utf-8"))
        except Exception:
            return None
    songs = sorted((data / "songs").glob("*.json"))
    n_ok = n_skip = n_fail = 0
    for i, p in enumerate(songs):
        d = read(p)
        status("import", f"곡 옮기는 중 {i + 1}/{len(songs)}", done=i, total=len(songs))
        if not isinstance(d, dict):
            n_fail += 1
            continue
        try:
            r = api.call("admin/import", {"type": "song", "song": d}, timeout=60)
            if r.get("skipped"):
                n_skip += 1
            else:
                n_ok += 1
        except PermissionError:
            raise
        except Exception as e:
            n_fail += 1
            print(f"곡 옮기기 실패 {p.name}: {e}", file=sys.stderr)
    scores = sorted((data / "scores").glob("*.json")) if (data / "scores").is_dir() else []
    for i, p in enumerate(scores):
        d = read(p)
        status("import", f"기록 옮기는 중 {i + 1}/{len(scores)}")
        if isinstance(d, dict):
            try:
                api.call("admin/import", {"type": "scores", "id": p.stem, "data": d})
            except PermissionError:
                raise
            except Exception as e:
                print(f"기록 옮기기 실패 {p.name}: {e}", file=sys.stderr)
    for name, kind in (("profiles.json", "profiles"), ("requests.json", "requests"), ("artist_learn.json", "learn")):
        d = read(data / name)
        if d:
            status("import", f"{name} 옮기는 중")
            try:
                api.call("admin/import", {"type": kind, "data": d})
            except PermissionError:
                raise
            except Exception as e:
                print(f"{name} 옮기기 실패: {e}", file=sys.stderr)
    api.call("admin/import", {"type": "done"})
    msg = f"옮기기 끝: 곡 {n_ok}개 추가" + (f", {n_skip}개는 이미 있어서 건너뜀" if n_skip else "") + (f", {n_fail}개 실패" if n_fail else "")
    status("imported", msg, ok=n_ok, skipped=n_skip, failed=n_fail)
    return msg


def main():
    ap = argparse.ArgumentParser(description="링크비트 PC 채보 엔진")
    ap.add_argument("--server", default=os.environ.get("LB_SERVER", ""))
    ap.add_argument("--key", default=os.environ.get("LB_KEY", ""))
    ap.add_argument("--import", dest="imp", default="")
    ap.add_argument("--check", action="store_true", help="필요한 프로그램이 다 있는지만 확인")
    a = ap.parse_args()
    if a.check:
        import numpy, scipy, yt_dlp, imageio_ffmpeg  # noqa: F401
        import chartgen, pipeline  # noqa: F401
        status("ok", f"yt-dlp {yt_dlp.version.__version__}")
        return
    if not a.server or not a.key:
        status("error", "서버 주소와 호스트 키가 필요해요.")
        sys.exit(2)
    api = Api(a.server, a.key)
    if a.imp:
        try:
            import_dir(api, a.imp)
        except Exception as e:
            status("error", str(e))
            sys.exit(1)
        return
    try:
        loop(api)
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
