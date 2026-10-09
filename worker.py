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
import sys
import time
import traceback
import urllib.error
import urllib.request
from pathlib import Path

VERSION = "1.0.0"

# 가상환경의 실행 파일 폴더(deno 등)를 PATH 앞에 → yt-dlp가 JS 런타임을 찾을 수 있게
os.environ["PATH"] = str(Path(sys.executable).parent) + os.pathsep + os.environ.get("PATH", "")
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)
except Exception:
    pass


def status(state, msg="", **extra):
    print(json.dumps(dict(state=state, msg=msg, **extra), ensure_ascii=False), flush=True)


class Cancelled(Exception):
    pass


class Api:
    def __init__(self, server, key):
        self.base = server.rstrip("/")
        self.key = key

    def call(self, path, body=None, timeout=60):
        data = json.dumps(body if body is not None else {}, ensure_ascii=False).encode("utf-8")
        req = urllib.request.Request(self.base + "/api/" + path, data=data, method="POST",
                                     headers={"Content-Type": "application/json", "X-Host-Key": self.key,
                                              "User-Agent": f"LinkbeatEngine/{VERSION}"})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.loads(r.read().decode("utf-8") or "{}")
        except urllib.error.HTTPError as e:
            try:
                msg = json.loads(e.read().decode("utf-8")).get("error") or str(e)
            except Exception:
                msg = str(e)
            if e.code == 403:
                raise PermissionError("호스트 키가 맞지 않아요. 실행기에서 호스트 키를 다시 넣어 주세요.")
            raise RuntimeError(msg)


def run_job(api, job):
    import pipeline
    jid = job["id"]
    last = [0.0]

    def progress(stage, msg, force=False):
        now = time.time()
        if not force and now - last[0] < 1.0:
            return
        last[0] = now
        status("working", f"{job.get('title') or job['vid']} · {msg}")
        try:
            r = api.call("worker/progress", {"jobId": jid, "stage": stage, "msg": msg, "version": VERSION}, timeout=15)
        except Exception:
            return
        if r.get("ok") is False:
            raise Cancelled()

    try:
        progress("info", "시작", force=True)
        meta, res = pipeline.analyze(job["vid"], progress)
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
    fails = 0
    while True:
        try:
            r = api.call("worker/poll", {"version": VERSION}, timeout=20)
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
                status("ready", "대기 중")
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
