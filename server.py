"""
링크비트 서버 — 파이썬 기본 기능만으로 동작 (HTTP + WebSocket)
 - 게임 화면 제공
 - 유튜브 링크 → 채보 자동 생성 (호스트만)
 - 멀티플레이 방
"""
import asyncio
import base64
import hashlib
import json
import math
import mimetypes
import os
import random
import re
import secrets
import string
import sys

import threading
import time
import traceback
import webbrowser
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import parse_qs, unquote

import artist as artistlib
import chartgen
import pipeline

ROOT = Path(__file__).resolve().parent
STATIC = ROOT / "static"
DATA = Path(os.environ.get("LB_DATA") or (ROOT / "data"))
# 클라우드 모드: 인터넷 서버에 24시간 켜 두는 방식. 유튜브 음원 받기·채보 분석은 호스트 PC의 채보 엔진이 맡음
CLOUD = os.environ.get("LB_CLOUD", "") == "1"
BIND = os.environ.get("LB_BIND", "127.0.0.1" if CLOUD else "0.0.0.0")
SONGS = DATA / "songs"
SONGS.mkdir(parents=True, exist_ok=True)
SCORES = DATA / "scores"
SCORES.mkdir(parents=True, exist_ok=True)
REQ_FILE = DATA / "requests.json"
PROFILES_FILE = DATA / "profiles.json"   # 친구들 프로필 (설정·기록 백업)
MAIN_LOOP = None
PORT = int(os.environ.get("PORT", "8800"))

# 가상환경의 실행 파일 폴더(deno 등)를 PATH 앞에 추가 → yt-dlp가 JS 런타임을 찾을 수 있게
os.environ["PATH"] = str(Path(sys.executable).parent) + os.pathsep + os.environ.get("PATH", "")

KEY_FILE = DATA / "host_key.txt"
if os.environ.get("LB_HOST_KEY", "").strip():
    HOST_KEY = os.environ["LB_HOST_KEY"].strip()
elif KEY_FILE.exists():
    HOST_KEY = KEY_FILE.read_text(encoding="utf-8").strip()
else:
    HOST_KEY = secrets.token_urlsafe(24 if CLOUD else 12)   # 인터넷 서버는 더 긴 키
    KEY_FILE.write_text(HOST_KEY, encoding="utf-8")
    try:
        os.chmod(KEY_FILE, 0o600)
    except OSError:
        pass

VID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")
URL_RE = re.compile(r"(?:youtube\.com/(?:watch\?(?:.*&)?v=|shorts/|embed/|live/|v/)|youtu\.be/)([A-Za-z0-9_-]{11})")


def log(*a):
    print(time.strftime("[%H:%M:%S]"), *a, flush=True)


def parse_video_id(text):
    text = (text or "").strip()
    if VID_RE.match(text):
        return text
    m = URL_RE.search(text)
    return m.group(1) if m else None


# ============================================================ 곡 저장소
def song_path(sid):
    if not VID_RE.match(sid or ""):
        raise ValueError("bad id")
    return SONGS / f"{sid}.json"


FILE_LOCK = threading.RLock()   # 작업 스레드와 서버 루프가 같은 파일을 동시에 쓰지 않게


def write_json_atomic(path, data):
    """임시 파일에 쓴 뒤 교체. 윈도우에서 다른 쪽이 파일을 읽는 중이면 잠깐 기다렸다 재시도."""
    tmp = path.with_name(f"{path.name}.{secrets.token_hex(4)}.tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    for i in range(8):
        try:
            os.replace(tmp, path)
            return
        except PermissionError:
            time.sleep(0.05 * (i + 1))
    tmp.unlink(missing_ok=True)
    raise RuntimeError(f"파일을 저장하지 못했어요: {path.name}")


def read_json(path, default=None):
    for i in range(5):
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            return default
        except (PermissionError, json.JSONDecodeError):
            time.sleep(0.05 * (i + 1))
    return default


def load_song(sid):
    p = song_path(sid)
    if not p.exists():
        return None
    with FILE_LOCK:
        try:
            mt = p.stat().st_mtime_ns
        except OSError:
            mt = 0
        song = read_json(p)
    if not isinstance(song, dict):
        return None
    song["_m"] = mt          # 별점 캐시용 (파일에는 저장 안 함)
    if "charts6" not in song and song.get("charts"):
        # 6키 이전에 만든 곡: 4키 채보를 6키로 변환해서 저장
        seed = int(hashlib.md5(sid.encode()).hexdigest()[:8], 16)
        song["charts6"] = {d: chartgen.convert_to_6(n, seed + i) for i, (d, n) in enumerate(song["charts"].items())}
        save_song(song)
    if song.get("charts") and "extreme" not in song["charts"]:
        # 극한 난이도 추가 이전에 만든 곡: 어려움 채보를 바탕으로 극한 채보를 만듦
        seed = int(hashlib.md5(sid.encode()).hexdigest()[:8], 16)
        bpm, off = float(song.get("bpm") or 120), float(song.get("offset") or 0)
        base4 = song["charts"].get("hard") or []
        song["charts"]["extreme"] = chartgen.densify_chart(base4, bpm, off, 4, seed + 41)
        c6 = song.setdefault("charts6", {})
        if "extreme" not in c6:
            base6 = c6.get("hard") or chartgen.convert_to_6(base4, seed + 2)
            c6["extreme"] = chartgen.densify_chart(base6, bpm, off, 6, seed + 42)
        save_song(song)
    return song


def charts_key(keys):
    return "charts6" if int(keys or 4) == 6 else "charts"


def save_song(song):
    with FILE_LOCK:
        write_json_atomic(song_path(song["id"]), {k: v for k, v in song.items() if not k.startswith("_")})
        try:
            song["_m"] = song_path(song["id"]).stat().st_mtime_ns
        except OSError:
            song.pop("_m", None)
    _STAR_CACHE.pop(song["id"], None)
    _HL_CACHE.pop(song["id"], None)


_STAR_CACHE = {}   # 곡 id → 별점표 (곡을 저장할 때마다 비움)
_HL_CACHE = {}


def song_hl(song):
    """하이라이트 모드 구간 (곡 파일이 바뀔 때만 다시 계산)"""
    sid, stamp = song["id"], song.get("_m")
    hit = _HL_CACHE.get(sid)
    if hit and stamp is not None and hit[0] == stamp:
        return hit[1]
    try:
        r = chartgen.play_range(song)
    except Exception:
        traceback.print_exc()
        r = None
    if stamp is not None:
        _HL_CACHE[sid] = (stamp, r)
    return r


def song_stars(song):
    """별점표 캐시: 곡 파일의 수정 시각이 같을 때만 재사용 (다른 스레드가 고쳐 저장해도 옛 값이 남지 않게)."""
    sid, stamp = song["id"], song.get("_m")
    hit = _STAR_CACHE.get(sid)
    if hit and stamp is not None and hit[0] == stamp:
        return hit[1]
    table = chartgen.star_table(song)
    if stamp is not None:
        _STAR_CACHE[sid] = (stamp, table)
    return table


_DENS_CACHE = {}
DENS_N = 48
_B36 = "0123456789abcdefghijklmnopqrstuvwxyz"


def song_dens(song):
    """곡 선택 화면의 '비트 라인': 채보마다 곡을 48칸으로 나눠 칸마다 1초에 노트가 몇 개인지 (0.5개 단위, 36가지 글자 하나씩)
    → {"4": {난이도: "0a3…"}, "6": {...}, "ai": {...}, "dur": 길이} (곡 파일이 바뀔 때만 다시 계산)"""
    sid, stamp = song["id"], song.get("_m")
    hit = _DENS_CACHE.get(sid)
    if hit and stamp is not None and hit[0] == stamp:
        return hit[1]
    dur = float(song.get("duration") or 0)
    if dur <= 0:
        ts = [n.get("t", 0) for ch in (song.get("charts") or {}).values() for n in ch]
        dur = max(ts) + 1 if ts else 1
    step = dur / DENS_N

    def enc(notes):
        cnt = [0] * DENS_N
        for n in notes or []:
            try:
                i = int(float(n.get("t", 0)) / step)
            except (TypeError, ValueError):
                continue
            if 0 <= i < DENS_N:
                cnt[i] += 1
        return "".join(_B36[min(35, round(c / step * 2))] for c in cnt)

    out = {"4": {d: enc(n) for d, n in (song.get("charts") or {}).items()},
           "6": {d: enc(n) for d, n in (song.get("charts6") or {}).items()},
           "dur": round(dur, 2)}
    ai = song.get("ai")
    if isinstance(ai, dict) and isinstance(ai.get("charts"), dict):
        out["ai"] = {d: enc(n) for d, n in ai["charts"].items()}
    if stamp is not None:
        _DENS_CACHE[sid] = (stamp, out)
    return out


def ai_summary(song):
    """AI 채보(4키, 기본 채보와 따로 저장)가 있으면 난이도별 노트 수·별점"""
    ai = song.get("ai")
    if not isinstance(ai, dict) or not isinstance(ai.get("charts"), dict) or not ai["charts"]:
        return None
    ch = ai["charts"]
    fit = ai.get("fit") or {}
    return {"by": str(ai.get("by", ""))[:60], "at": ai.get("at", 0), "gen": ai.get("gen", 1),
            "rec": fit.get("rec", True) and not song.get("aiOff"), "off": bool(song.get("aiOff")), "shift": fit.get("shift", 0), "match": fit.get("match"),
            "counts": {d: len(n) for d, n in ch.items()},
            "stars": {d: chartgen.star_rating(n, 4) for d, n in ch.items()}}


def song_artist(song):
    """저장된 가수가 있으면 그것, 아직 확인 전이면 제목·채널로 추측"""
    if song.get("artistSrc"):
        return song.get("artist", ""), song["artistSrc"]
    return artistlib.guess(None, song.get("title", ""), song.get("channel", ""))


def song_summary(song):
    sc = load_scores(song["id"])
    return {
        "id": song["id"], "title": song.get("title", song["id"]),
        "channel": song.get("channel", ""), "duration": song.get("duration", 0),
        "artist": song_artist(song)[0], "artistSrc": song_artist(song)[1], "artistAt": song.get("artistAt", 0),
        "bpm": song.get("bpm", 120), "offset": song.get("offset", 0), "noteShift": song.get("noteShift", 0),
        "created": song.get("created", 0), "edited": song.get("edited", {}),
        "counts": {d: len(n) for d, n in song.get("charts", {}).items()},
        "counts6": {d: len(n) for d, n in (song.get("charts6") or {}).items()},
        "stars": song_stars(song),
        "hl": song_hl(song),
        "ai": ai_summary(song),
        "plays": sc["plays"],
        "board": sc["entries"],
    }


_SUM_CACHE = {}   # 곡 id → ((곡 파일 시각, 기록 파일 시각), 요약) — 바뀐 곡만 다시 읽음 (인터넷 서버 부담 줄이기)


def _mtime(path):
    try:
        return path.stat().st_mtime_ns
    except OSError:
        return 0


def list_songs():
    out = []
    alive = set()
    for p in SONGS.glob("*.json"):
        sid = p.stem
        if not VID_RE.match(sid):
            continue
        alive.add(sid)
        try:
            stamp = (_mtime(p), _mtime(scores_path(sid)))
            hit = _SUM_CACHE.get(sid)
            if hit and hit[0] == stamp:
                out.append(dict(hit[1]))
                continue
            song = load_song(sid)
            if song:
                summ = song_summary(song)
                _SUM_CACHE[sid] = ((_mtime(p), stamp[1]), summ)
                out.append(dict(summ))
        except Exception:
            traceback.print_exc()
    for sid in [k for k in _SUM_CACHE if k not in alive]:
        _SUM_CACHE.pop(sid, None)
    # 같은 가수의 한글/영어/괄호 표기를 하나로 (방장이 ✎로 고친 이름이 있으면 그 이름으로)
    try:
        manual = [x["artist"] for x in sorted(out, key=lambda x: x.get("artistAt", 0)) if x.get("artistSrc") == "manual"]
        canon = artistlib.unify([x["artist"] for x in out], preferred=manual)
        for x in out:
            x["artistRaw"] = x["artist"]
            x["artist"] = canon.get(x["artist"], x["artist"])
    except Exception:
        traceback.print_exc()
    out.sort(key=lambda s: -s["created"])
    return out


# ============================================================ 실시간 알림
def notify_all(msg):
    """모든 접속자에게 알림 (다른 스레드에서 불러도 안전)."""
    def _send():
        for c in list(CLIENTS.values()):
            c.send(msg)
    if MAIN_LOOP is None:
        return
    try:
        if asyncio.get_running_loop() is MAIN_LOOP:
            _send()
            return
    except RuntimeError:
        pass
    MAIN_LOOP.call_soon_threadsafe(_send)


# ============================================================ 곡 신청함
def load_requests():
    with FILE_LOCK:
        d = read_json(REQ_FILE, [])
    return d if isinstance(d, list) else []


def save_requests(reqs):
    with FILE_LOCK:
        write_json_atomic(REQ_FILE, reqs)


def drop_requests_for(vid):
    with FILE_LOCK:
        reqs = load_requests()
        left = [r for r in reqs if r.get("vid") != vid]
        changed = len(left) != len(reqs)
        if changed:
            save_requests(left)
    if changed:
        notify_all({"type": "requests"})


def fetch_title(vid):
    """유튜브 oEmbed로 제목/채널 가져오기 (실패하면 빈 값)."""
    import urllib.request
    url = f"https://www.youtube.com/oembed?format=json&url=https://www.youtube.com/watch?v={vid}"
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"}), timeout=6) as r:
            d = json.loads(r.read().decode("utf-8"))
            return str(d.get("title", ""))[:200], str(d.get("author_name", ""))[:100]
    except Exception:
        return "", ""


# ============================================================ 순위표
def scores_path(sid):
    if not VID_RE.match(sid or ""):
        raise ValueError("bad id")
    return SCORES / f"{sid}.json"


def load_scores(sid):
    with FILE_LOCK:
        d = read_json(scores_path(sid))
    if isinstance(d, dict):
        try:
            return {"plays": int(d.get("plays", 0)), "entries": list(d.get("entries", []))}
        except Exception:
            pass
    return {"plays": 0, "entries": []}


def save_scores(sid, data):
    with FILE_LOCK:
        write_json_atomic(scores_path(sid), data)


def submit_score(data):
    sid = str(data.get("songId", ""))
    if not VID_RE.match(sid) or not song_path(sid).exists():
        raise HttpError(404, "곡이 없어요.")
    diff = data.get("diff")
    keys = 6 if data.get("keys") in (6, "6") else 4
    if not isinstance(diff, str) or diff not in chartgen.DIFFS or keys not in (4, 6):
        raise HttpError(400, "잘못된 난이도")
    name = str(data.get("name", "")).strip()[:16] or "이름없음"
    with FILE_LOCK:
        return _submit_score(sid, diff, keys, name, data)


def _same_board(e, diff, keys, hl, ai=False):
    """같은 순위표(난이도·키·전체곡/하이라이트·AI 채보/기존 채보)에 속하는 기록인지"""
    return e["diff"] == diff and e.get("keys", 4) == keys and bool(e.get("hl")) == hl and bool(e.get("ai")) == ai


def _submit_score(sid, diff, keys, name, data):
    sc = load_scores(sid)
    sc["plays"] += 1
    entry = {
        "name": name, "diff": diff, "keys": keys,
        "score": max(0, min(1_000_000, int(data.get("score", 0)))),
        "acc": round(max(0.0, min(100.0, float(data.get("acc", 0)))), 2),
        "rank": str(data.get("rank", ""))[:3], "fc": bool(data.get("fc")),
        "maxCombo": max(0, int(data.get("maxCombo", 0))), "at": time.time(),
    }
    cnt = data.get("counts")                     # 판정 개수 (결과 화면에서 최고 기록과 비교)
    if isinstance(cnt, dict):
        c2 = {}
        for k in ("perfect", "great", "good", "miss"):
            v = cnt.get(k)
            if isinstance(v, (int, float)) and math.isfinite(v):
                c2[k] = max(0, min(100000, int(v)))
        if len(c2) == 4:
            entry["counts"] = c2
    # 고스트 대결용: 노트 5%마다의 점수 (21칸)
    g = data.get("g")
    if isinstance(g, list) and 2 <= len(g) <= 21 and all(isinstance(x, (int, float)) and math.isfinite(x) for x in g):
        entry["g"] = [max(0, min(1_000_000, int(x))) for x in g]
    hl = bool(data.get("hl"))
    if hl:
        entry["hl"] = True                      # 하이라이트 모드 기록은 순위표를 따로
    ai = bool(data.get("ai")) and keys == 4
    if ai:
        entry["ai"] = True                      # AI 채보 기록도 순위표를 따로
    same = [e for e in sc["entries"] if e["name"] == name and _same_board(e, diff, keys, hl, ai)]
    new_best = not same or entry["score"] > same[0]["score"]
    if data.get("incomplete"):
        new_best = False
    if new_best:
        sc["entries"] = [e for e in sc["entries"] if e not in same] + [entry]
        # 난이도·키 조합마다 상위 50명만 보관
        combo = sorted([e for e in sc["entries"] if _same_board(e, diff, keys, hl, ai)],
                       key=lambda e: -e["score"])
        drop = combo[50:]
        if drop:
            sc["entries"] = [e for e in sc["entries"] if e not in drop]
    save_scores(sid, sc)
    board = sorted([e for e in sc["entries"] if _same_board(e, diff, keys, hl, ai)],
                   key=lambda e: -e["score"])
    mine = next((e for e in board if e["name"] == name), None)
    pos = (1 + sum(1 for e in board if e["score"] > mine["score"])) if mine else None   # 동점은 같은 순위
    return {"newBest": new_best, "position": pos, "total": len(board), "plays": sc["plays"]}


# ============================================================ 채보 생성 작업
JOBS = {}
# 전체 채보 다시 만들기 (방장)
BATCH = {"running": False, "total": 0, "done": 0, "ok": 0, "failed": [], "current": "", "cancel": False,
         "keepEdited": True, "started": 0, "finished": 0}
BATCH_LOCK = threading.Lock()


def batch_state():
    b = dict(BATCH)
    b["failedCount"] = len(BATCH["failed"])
    b["failed"] = list(BATCH["failed"])[-20:]
    return b


def batch_notify():
    notify_all({"type": "batch", "batch": batch_state()})


ARTIST_VER = 4   # 가수 찾기 방식이 좋아지면 올림 → 예전 곡을 다시 확인
LEARN_FILE = DATA / "artist_learn.json"   # 방장이 ✎로 고친 것에서 배운 것 (아는 가수, 채널별 '가수-곡' 순서)


def load_learn():
    with FILE_LOCK:
        d = read_json(LEARN_FILE, {})
    if not isinstance(d, dict):
        d = {}
    d.setdefault("known", [])
    d.setdefault("chanOrder", {})
    return d


def artist_knowledge():
    """(아는 가수 이름들, 채널별 순서). 믿을 만한 것만: 유튜브 음악 정보, 방장이 고친 것, 배운 것"""
    learn = load_learn()
    known = set(learn["known"])
    for p in SONGS.glob("*.json"):
        try:
            with FILE_LOCK:
                d = read_json(p)
            if isinstance(d, dict) and d.get("artist") and d.get("artistSrc") in ("youtube", "manual"):
                known.add(d["artist"])
        except Exception:
            pass
    return sorted(known), learn["chanOrder"]


def learn_from_manual(song, artist_name):
    """✎로 고친 가수를 기억하고, 그 채널이 '가수 - 곡' / '곡 - 가수' 중 어느 순서인지 배움"""
    with FILE_LOCK:
        learn = load_learn()
        if artist_name and artist_name not in learn["known"]:
            learn["known"] = (learn["known"] + [artist_name])[-2000:]
        order = artistlib.learn_order(song.get("title", ""), artist_name)
        ch = song.get("channel") or ""
        if order and ch:
            learn["chanOrder"][ch] = order
        write_json_atomic(LEARN_FILE, learn)


def reguess_all():
    """배운 지식으로 자동 추측한 곡들을 다시 판단 (네트워크 없이, 빠름)"""
    known, order = artist_knowledge()
    changed = 0
    for p in SONGS.glob("*.json"):
        if not VID_RE.match(p.stem):
            continue
        with FILE_LOCK:
            song = load_song(p.stem)
            if not song or song.get("artistSrc") in ("manual", "youtube", "search"):
                continue
            new = artistlib.guess(None, song.get("title", ""), song.get("channel", ""), known=known, chan_order=order)
            if new[0] and (new[0], new[1]) != (song.get("artist"), song.get("artistSrc")):
                song["artist"], song["artistSrc"] = new
                save_song(song)
                changed += 1
    if changed:
        log(f"배운 가수 정보로 {changed}곡의 가수를 다시 맞췄어요.")
        notify_all({"type": "songs"})


def refresh_artist(vid):
    """예전 곡: 오디오는 받지 않고 유튜브 정보만 다시 읽어 가수를 채움"""
    try:
        import yt_dlp
    except ImportError:
        return False
    try:
        with yt_dlp.YoutubeDL({"quiet": True, "no_warnings": True, "noplaylist": True, "skip_download": True}) as ydl:
            info = ydl.extract_info(f"https://www.youtube.com/watch?v={vid}", download=False)
    except Exception as e:
        log("가수 정보 확인 실패:", vid, str(e)[:120])
        return False
    with FILE_LOCK:
        song = load_song(vid)
        if not song or song.get("artistSrc") == "manual":
            return True
        title, channel = song.get("title", ""), song.get("channel", "") or info.get("channel") or ""
    # 음악 검색은 시간이 걸려서 파일 잠금 밖에서
    known, order = artist_knowledge()
    found = artistlib.guess(info, title, channel, online=True, known=known, chan_order=order)
    with FILE_LOCK:      # 다시 읽고 가수 칸만 바꿔서 저장 (그사이 다른 수정이 있어도 덮어쓰지 않게)
        song = load_song(vid)
        if not song or song.get("artistSrc") == "manual":
            return True
        song["artist"], song["artistSrc"] = found
        if not song.get("channel"):
            song["channel"] = info.get("channel") or info.get("uploader") or ""
        song["artistVer"] = ARTIST_VER
        save_song(song)
    return True


def run_artist_refresh():
    """서버를 켤 때 한 번: 가수 확인이 안 된 곡을 뒤에서 하나씩 확인 (곡 추가 작업 사이사이에 끼워서)"""
    time.sleep(3)
    ids = []
    for p in SONGS.glob("*.json"):
        try:
            song = load_song(p.stem) if VID_RE.match(p.stem) else None
        except Exception:
            song = None
        if song and song.get("artistVer", 0) < ARTIST_VER and song.get("artistSrc") != "manual":
            ids.append(p.stem)
    if not ids:
        return
    log(f"가수 정보 확인 시작: {len(ids)}곡 (뒤에서 천천히 진행돼요)")
    done = 0
    for vid in ids:
        try:
            if EXECUTOR.submit(refresh_artist, vid).result():
                done += 1
        except Exception:
            traceback.print_exc()
    log(f"가수 정보 확인 끝: {done}/{len(ids)}곡")
    if done:
        notify_all({"type": "songs"})


def run_batch(ids, keep_edited):
    """곡을 하나씩 다시 만듦. 곡마다 작업을 따로 넣어서, 그 사이에 새 곡 추가도 끼어들 수 있게 함."""
    try:
        for vid in ids:
            if BATCH["cancel"]:
                break
            try:
                old = load_song(vid)
            except Exception as e:   # 망가진 곡 파일 하나 때문에 전체가 멈추지 않게
                traceback.print_exc()
                BATCH["failed"].append({"title": vid, "msg": f"곡 파일을 읽지 못했어요 ({e})"[:160]})
                BATCH["done"] += 1
                batch_notify()
                continue
            if not old:
                BATCH["done"] += 1
                continue
            BATCH["current"] = old.get("title", vid)
            batch_notify()
            jid = secrets.token_hex(6)
            JOBS[jid] = {"id": jid, "vid": vid, "stage": "queued", "msg": "대기 중...", "songId": None,
                         "created": time.time(), "batch": True}
            fut = EXECUTOR.submit(run_job, jid, vid, keep_edited, True)
            try:
                fut.result()
            except Exception:
                traceback.print_exc()
            job = JOBS.get(jid, {})
            if job.get("stage") == "done":
                BATCH["ok"] += 1
            else:
                BATCH["failed"].append({"title": old.get("title", vid), "msg": str(job.get("msg", ""))[:160]})
            BATCH["done"] += 1
            batch_notify()
    finally:
        BATCH.update(running=False, current="", finished=time.time())
        batch_notify()
        log(f"전체 다시 만들기 끝: 성공 {BATCH['ok']} / 실패 {len(BATCH['failed'])} / 전체 {BATCH['total']}"
            + (" (중간에 멈춤)" if BATCH["cancel"] else ""))
EXECUTOR = ThreadPoolExecutor(max_workers=1)


def ffmpeg_exe():
    return pipeline.ffmpeg_exe()


def finish_song(vid, meta, res, keep_edited=False, keep_title=False):
    """분석 결과(res)와 유튜브 정보(meta)로 곡을 저장 (이 컴퓨터에서 분석했든 PC 채보 엔진이 보냈든 똑같이)"""
    old = load_song(vid)
    song = {
        "id": vid,
        "title": meta.get("title") or vid,
        "channel": meta.get("channel") or meta.get("uploader") or "",
        "duration": res["duration"],
        "bpm": res["bpm"],
        "offset": res["offset"],
        "created": old["created"] if old else time.time(),
        "charts": res["charts"],
        "charts6": res["charts6"],
        "beats": res.get("beats") or [],
        "highlight": res.get("highlight"),          # 가장 잘 들리는 구간(후렴) — 미리듣기·하이라이트 모드
        "chorus": res.get("chorus") or [],          # 후렴이 나오는 구간들 — 플레이 중 연출
        "edited": {},
    }
    # 진짜 부른 가수: 유튜브 음악 정보 → 제목 → 채널 순
    known, order = artist_knowledge()
    song["artist"], song["artistSrc"] = artistlib.guess(meta, song["title"], song["channel"], online=True,
                                                       known=known, chan_order=order)
    song["artistVer"] = ARTIST_VER
    if old and keep_title:
        song["title"] = old.get("title") or song["title"]
        song["channel"] = old.get("channel") or song["channel"]
    if old and old.get("artistSrc") == "manual":   # 방장이 직접 고친 가수는 항상 유지
        song["artist"], song["artistSrc"] = old.get("artist", ""), "manual"
        if old.get("artistAt"):
            song["artistAt"] = old["artistAt"]
    if old and isinstance(old.get("ai"), dict):   # AI 채보는 따로 만든 거라 기본 채보를 다시 만들어도 그대로 둠
        song["ai"] = old["ai"]
    if old and isinstance(old.get("onsets"), list):
        song["onsets"] = old["onsets"]
    if old and keep_edited and old.get("edited"):
        for key, at in old["edited"].items():
            six = key.startswith("6-")
            diff = key[2:] if six else key
            src = old.get("charts6" if six else "charts") or {}
            if diff in src:
                song["charts6" if six else "charts"][diff] = src[diff]
                song["edited"][key] = at
        # 고친 채보는 노트 시각(초)이 그대로라 새 BPM 분석과 함께 써도 플레이에 문제없음
    save_song(song)
    drop_requests_for(vid)
    notify_all({"type": "songs"})
    log("채보 생성 완료:", song["title"], {d: len(n) for d, n in res["charts"].items()})
    return song


def run_job(job_id, vid, keep_edited=False, keep_title=False):
    """keep_edited: 채보 수정기로 고친 난이도는 그대로 둠 / keep_title: 바꿔둔 곡 제목 유지 (전체 다시 만들기용)"""
    job = JOBS[job_id]
    try:
        meta, res = pipeline.analyze(vid, lambda stage, msg: job.update(stage=stage, msg=msg))
        finish_song(vid, meta, res, keep_edited, keep_title)
        job.update(stage="done", msg="완료!", songId=vid)
    except Exception as e:
        job.update(stage="error", msg=pipeline.friendly_error(e))
        log("채보 생성 실패:", vid, repr(e))
        traceback.print_exc()


# ============================================================ PC 채보 엔진 대기열 (클라우드 모드)
# 호스트가 곡을 추가하거나 신청을 승인하면 여기 쌓이고, 호스트 PC의 채보 엔진이 하나씩 가져가서
# 음원 받기·분석을 한 뒤 결과만 올려 보냄. 서버는 계속 돌아가고, 결과가 오면 곡 목록에 바로 나타남.
QUEUE_FILE = DATA / "pcqueue.json"
WORKER = {"seen": 0.0, "version": "", "busy": None, "ai": False, "avatar": False}   # ai: 호스트 PC에 AI 채보 도구가 설치돼 있는지
PENDING = ("waitpc", "claimed", "info", "download", "analyze", "ai", "upload")
CLAIM_TIMEOUT = 20 * 60          # 엔진이 가져간 뒤 이 시간 동안 소식이 없으면 다시 대기열로


def worker_online():
    return time.time() - WORKER["seen"] < 15


def worker_status():
    return {"online": worker_online(), "seen": WORKER["seen"], "version": WORKER["version"], "ai": WORKER["ai"],
            "avatar": WORKER.get("avatar", False)}


def save_queue():
    with FILE_LOCK:
        keep = [j for j in JOBS.values() if j.get("pc") and j["stage"] in PENDING]
        write_json_atomic(QUEUE_FILE, [{k: v for k, v in j.items() if not k.startswith("_")} for j in keep])


def load_queue():
    d = read_json(QUEUE_FILE, [])
    for j in d if isinstance(d, list) else []:
        if isinstance(j, dict) and j.get("id") and VID_RE.match(j.get("vid") or ""):
            j.update(stage="waitpc", msg="PC 채보 엔진을 기다리는 중...")   # 서버가 다시 켜졌으면 처음부터
            JOBS[j["id"]] = j


def jobs_changed():
    save_queue()
    notify_all({"type": "jobs"})


def enqueue_pc(vid, keep_edited=False, keep_title=False, title="", by="", batch=False, ai_only=False):
    """같은 곡이 이미 대기 중이면 그 작업을 돌려줌.
    ai_only: 기존 채보는 그대로 두고 AI 채보만 만드는 작업 (호스트 PC에 AI 채보 도구가 있을 때)"""
    for j in JOBS.values():
        if j.get("pc") and j["vid"] == vid and j["stage"] in PENDING and bool(j.get("aiOnly")) == bool(ai_only):
            return j
    jid = secrets.token_hex(6)
    j = {"id": jid, "vid": vid, "stage": "waitpc", "msg": "PC 채보 엔진을 기다리는 중..." if not ai_only else "AI 채보 대기 중...",
         "songId": None, "created": time.time(), "pc": True, "keepEdited": bool(keep_edited), "keepTitle": bool(keep_title),
         "title": title or vid, "by": by, "batch": bool(batch), "claimedAt": 0, "aiOnly": bool(ai_only)}
    JOBS[jid] = j
    jobs_changed()
    log("PC 작업 대기열에 추가:", ("[AI] " if ai_only else "") + (title or vid))
    return j


def claim_job():
    now = time.time()
    for j in JOBS.values():          # 엔진이 가져가고 오래 소식이 없으면 다시 대기
        if j.get("pc") and j["stage"] in PENDING and j["stage"] != "waitpc" and now - j.get("claimedAt", 0) > CLAIM_TIMEOUT:
            j.update(stage="waitpc", msg="PC 채보 엔진을 기다리는 중... (다시 시도)")
    # AI 채보 작업은 AI 채보 도구가 있는 엔진만 가져감. 새 곡(기존 채보)이 AI 작업보다 먼저
    waiting = sorted((j for j in JOBS.values() if j.get("pc") and j["stage"] == "waitpc" and (WORKER["ai"] or not j.get("aiOnly"))),
                     key=lambda j: (bool(j.get("aiOnly")), j["created"]))
    if not waiting:
        return None
    j = waiting[0]
    j.update(stage="claimed", msg="PC에서 준비 중...", claimedAt=now)
    jobs_changed()
    return j


def recent_jobs():
    pcj = [j for j in JOBS.values() if j.get("pc")]
    live = sorted((j for j in pcj if j["stage"] in PENDING), key=lambda j: j["created"])
    done = sorted((j for j in pcj if j["stage"] not in PENDING), key=lambda j: -j.get("finished", j["created"]))[:8]
    return [{k: v for k, v in j.items() if not k.startswith("_")} for j in live + done]


# ============================================================ AI 캐릭터 그림 (호스트 PC의 ComfyUI가 그림)
# 누구나 '내 캐릭터'에서 요청 → 호스트 PC 엔진이 하나씩 가져가서 일러스트(webp)·도트(png)를 그려 올림
AVATARS = DATA / "avatars"
AVQ_FILE = DATA / "avqueue.json"
AVJOBS = {}
AV_PENDING = ("waitpc", "claimed", "working")
AV_TOKEN_RE = re.compile(r"^[0-9a-f]{12}$")
AV_FILE_RE = re.compile(r"^/avatars/([0-9a-f]{12})_(i\.webp|p\.png|s\.png|x\.webp)$")


def clean_avatar(av):
    """캐릭터 설정: 짧은 값만 (방 목록에 보내는 것과 같은 규칙)"""
    if not isinstance(av, dict):
        return {}
    return {str(k)[:12]: (v if isinstance(v, int) and 0 <= v < 100 else str(v)[:12])
            for k, v in list(av.items())[:12] if isinstance(v, (int, str))}


def save_avqueue():
    with FILE_LOCK:
        keep = [j for j in AVJOBS.values() if j["stage"] in AV_PENDING]
        write_json_atomic(AVQ_FILE, keep)


def load_avqueue():
    d = read_json(AVQ_FILE, [])
    for j in d if isinstance(d, list) else []:
        if isinstance(j, dict) and j.get("id") and j.get("pid"):
            j.update(stage="waitpc", msg="호스트 PC를 기다리는 중...")
            AVJOBS[j["id"]] = j


def av_job_public(j):
    if not j:
        return None
    out = {k: j.get(k) for k in ("id", "stage", "msg", "created", "token")}
    out["pos"] = av_position(j)
    return out


def av_position(j):
    if j["stage"] != "waitpc":
        return 0
    return 1 + sum(1 for x in AVJOBS.values() if x["stage"] == "waitpc" and x["created"] < j["created"])


def av_request(headers, data):
    with FILE_LOCK:
        profiles = load_profiles()
        key, pr, _ = profile_find(headers, profiles)
    av = clean_avatar(data.get("avatar"))
    if not av:
        raise HttpError(400, "캐릭터 설정이 없어요.")
    cur = pr.get("aiAvatar") if isinstance(pr.get("aiAvatar"), dict) else {}
    keep_il = data.get("mode") == "pixel" and AV_TOKEN_RE.match(str(cur.get("token") or "")) and \
        (AVATARS / f"{cur['token']}_i.webp").is_file()
    extra = {"mode": "pixel" if keep_il else "all",     # pixel: 일러스트는 그대로 두고 도트(동작 그림)만 다시
             "desc": str(data.get("desc") or "").strip()[:200],
             "strength": data.get("strength") if data.get("strength") in ("low", "mid", "high") else "mid",
             "useLook": data.get("useLook") is not False}
    ref = None
    if data.get("ref"):                    # 참고 사진 (브라우저에서 작게 줄여 보냄) — 그림이 끝나면 지움
        try:
            ref = base64.b64decode(str(data["ref"]).split(",")[-1], validate=True)
        except (ValueError, TypeError):
            raise HttpError(400, "참고 사진을 읽을 수 없어요.")
        kind = "jpg" if ref[:3] == b"\xff\xd8\xff" else "png" if ref[:8] == b"\x89PNG\r\n\x1a\n" else \
            "webp" if ref[:4] == b"RIFF" and ref[8:12] == b"WEBP" else None
        if not kind or len(ref) > 1_500_000:
            raise HttpError(400, "참고 사진은 jpg·png·webp, 1.5MB 이하만 돼요.")
    for j in AVJOBS.values():
        if j["pid"] == key and j["stage"] in AV_PENDING:
            if j["stage"] == "waitpc":
                j["avatar"] = av            # 아직 안 그렸으면 바뀐 설정으로
                j.update(extra)
                if ref:
                    av_drop_ref(j)
                    j["ref"] = av_save_ref(j["id"], ref, kind)
            return av_job_public(j)
    if sum(1 for j in AVJOBS.values() if j["stage"] in AV_PENDING) >= 40:
        raise HttpError(429, "그림 요청이 너무 많이 밀려 있어요. 조금 뒤에 다시 해 주세요.")
    recent = [j for j in AVJOBS.values() if j["pid"] == key and j["stage"] == "done" and time.time() - j.get("finished", 0) < 30]
    if recent:
        raise HttpError(429, "방금 그렸어요. 30초 뒤에 다시 해 주세요.")
    jid = secrets.token_hex(6)
    j = {"id": jid, "pid": key, "name": pr.get("id", key), "avatar": av, "stage": "waitpc",
         "msg": "호스트 PC를 기다리는 중...", "created": time.time(), "claimedAt": 0, **extra}
    if ref:
        j["ref"] = av_save_ref(jid, ref, kind)
    AVJOBS[jid] = j
    save_avqueue()
    notify_all({"type": "avjobs"})
    log("AI 캐릭터 요청:", j["name"])
    return av_job_public(j)


def av_save_ref(jid, data, kind):
    AVATARS.mkdir(parents=True, exist_ok=True)
    name = f"ref_{jid}.{kind}"
    (AVATARS / name).write_bytes(data)
    return name


def av_drop_ref(j):
    name = j.pop("ref", None)
    if name and re.match(r"^ref_[0-9a-f]{12}\.(jpg|png|webp)$", name):
        try:
            (AVATARS / name).unlink()
        except OSError:
            pass


def av_ref_b64(j):
    name = j.get("ref")
    if not name:
        return None
    try:
        return base64.b64encode((AVATARS / name).read_bytes()).decode()
    except OSError:
        return None


def av_cur_illust(j):
    """도트만 다시 그릴 때 참고할 지금 일러스트 (base64)"""
    with FILE_LOCK:
        pr = load_profiles().get(j["pid"]) or {}
    t0 = (pr.get("aiAvatar") or {}).get("token") if isinstance(pr.get("aiAvatar"), dict) else None
    try:
        if t0 and AV_TOKEN_RE.match(t0):
            return base64.b64encode((AVATARS / f"{t0}_i.webp").read_bytes()).decode()
    except OSError:
        pass
    return None


def av_status(headers):
    with FILE_LOCK:
        profiles = load_profiles()
        key, pr, _ = profile_find(headers, profiles)
    mine = sorted((j for j in AVJOBS.values() if j["pid"] == key), key=lambda j: -j["created"])
    ai = pr.get("aiAvatar") if isinstance(pr.get("aiAvatar"), dict) else {}
    pend = pr.get("aiAvatarNew") if isinstance(pr.get("aiAvatarNew"), dict) else {}
    return {"job": av_job_public(mine[0]) if mine else None, "token": ai.get("token"),
            "pending": pend.get("token") if AV_TOKEN_RE.match(str(pend.get("token") or "")) else None,
            "worker": {"online": worker_online(), "avatar": WORKER.get("avatar", False)}}


def av_claim():
    now = time.time()
    for j in AVJOBS.values():
        if j["stage"] in ("claimed", "working") and now - j.get("claimedAt", 0) > 10 * 60:
            j.update(stage="waitpc", msg="호스트 PC를 기다리는 중... (다시 시도)")
    waiting = sorted((j for j in AVJOBS.values() if j["stage"] == "waitpc"), key=lambda j: j["created"])
    if not waiting:
        return None
    j = waiting[0]
    j.update(stage="claimed", msg="호스트 PC에서 준비 중...", claimedAt=now)
    save_avqueue()
    notify_all({"type": "avjobs"})
    return j


def av_finish(j, images):
    """엔진이 보낸 그림 저장: 일러스트 webp(2.5MB 이하) · 도트 png(300KB 이하)"""
    try:
        if not isinstance(images, dict):
            raise ValueError("그림이 없어요.")
        il = base64.b64decode(str(images.get("illust", "")), validate=True)
        if not il and j.get("mode") == "pixel":      # 도트만 다시 그린 경우: 지금 일러스트를 그대로 씀
            with FILE_LOCK:
                pr0 = load_profiles().get(j["pid"]) or {}
            t0 = (pr0.get("aiAvatar") or {}).get("token") if isinstance(pr0.get("aiAvatar"), dict) else None
            if t0 and AV_TOKEN_RE.match(t0) and (AVATARS / f"{t0}_i.webp").is_file():
                il = (AVATARS / f"{t0}_i.webp").read_bytes()
        px = base64.b64decode(str(images.get("pixel", "")), validate=True)
        if not (il[:4] == b"RIFF" and il[8:12] == b"WEBP" and 1000 < len(il) <= 2_500_000):
            raise ValueError("일러스트 형식이 이상해요.")
        if not (px[:8] == b"\x89PNG\r\n\x1a\n" and 100 < len(px) <= 400_000):
            raise ValueError("도트 그림 형식이 이상해요.")
        sh = base64.b64decode(str(images.get("sheet", "")), validate=True) if images.get("sheet") else b""
        if sh and not (sh[:8] == b"\x89PNG\r\n\x1a\n" and len(sh) <= 600_000):
            raise ValueError("동작 그림 형식이 이상해요.")
        sk = base64.b64decode(str(images.get("sticker", "")), validate=True) if images.get("sticker") else b""
        if sk and not (sk[:4] == b"RIFF" and sk[8:12] == b"WEBP" and len(sk) <= 4_000_000):
            raise ValueError("스티커 그림 형식이 이상해요.")
    except (ValueError, TypeError) as e:
        j.update(stage="error", msg=str(e)[:200], finished=time.time())
        av_drop_ref(j)
        save_avqueue()
        notify_all({"type": "avjobs"})
        return
    tok = secrets.token_hex(6)
    AVATARS.mkdir(parents=True, exist_ok=True)
    (AVATARS / f"{tok}_i.webp").write_bytes(il)
    (AVATARS / f"{tok}_p.png").write_bytes(px)
    if sh:
        (AVATARS / f"{tok}_s.png").write_bytes(sh)     # 동작 그림 (기본·치기 왼·오른·점프·슬픔) — 예전 도트 방식
    if sk:
        (AVATARS / f"{tok}_x.webp").write_bytes(sk)    # SD 스티커 표정 줄 (기본·웃음·신남·놀람·슬픔·깜빡임)
    drop = None
    with FILE_LOCK:
        profiles = load_profiles()
        pr = profiles.get(j["pid"])
        if pr is not None:
            prev = pr.get("aiAvatar") if isinstance(pr.get("aiAvatar"), dict) else {}
            ot = str(prev.get("token") or "")
            if AV_TOKEN_RE.match(ot) and any((AVATARS / f"{ot}_{suf}").is_file() for suf in ("x.webp", "p.png", "i.webp")):
                # 예전 캐릭터가 있으면 바로 바꾸지 않음 → 본인이 예전 것·새 것을 나란히 보고 고름 (av_choose)
                pend = pr.get("aiAvatarNew") if isinstance(pr.get("aiAvatarNew"), dict) else {}
                drop = pend.get("token")          # 아직 안 고른 예전 '새 그림'은 이번 것으로 바뀜
                pr["aiAvatarNew"] = {"token": tok, "at": time.time()}
            else:
                pr["aiAvatar"] = {"token": tok, "at": time.time()}
            save_profiles(profiles)
    av_retire(drop)
    av_drop_ref(j)
    with FILE_LOCK:
        picking = bool((load_profiles().get(j["pid"]) or {}).get("aiAvatarNew"))
    j.update(stage="done", msg="완성! 예전 캐릭터와 비교해서 골라 주세요" if picking else "완성!", token=tok, finished=time.time())
    save_avqueue()
    notify_all({"type": "avjobs"})
    log("AI 캐릭터 완성:", j["name"])


def av_retire(tok):
    """안 쓰게 된 캐릭터 그림 정리 (방 목록에서 잠깐 그 그림을 쓰는 친구가 있어도 하루 정도는 남겨 둠)"""
    if not tok or not AV_TOKEN_RE.match(str(tok)):
        return
    try:
        for f in AVATARS.glob("*_old_*"):
            if time.time() - f.stat().st_mtime > 86400:
                f.unlink()
        for suf in ("i.webp", "p.png", "s.png", "x.webp"):
            src = AVATARS / f"{tok}_{suf}"
            if src.exists():
                src.rename(AVATARS / f"{tok}_old_{suf}")
    except OSError:
        pass


def av_choose(headers, data):
    """새로 그린 캐릭터를 쓸지(new), 예전 캐릭터를 그대로 둘지(old) → 남은 그림 토큰"""
    pick = data.get("pick")
    if pick not in ("new", "old"):
        raise HttpError(400, "new 나 old 중에 골라 주세요.")
    with FILE_LOCK:
        profiles = load_profiles()
        key, pr, _ = profile_find(headers, profiles)
        pend = pr.get("aiAvatarNew") if isinstance(pr.get("aiAvatarNew"), dict) else {}
        new = pend.get("token")
        cur = (pr.get("aiAvatar") or {}).get("token") if isinstance(pr.get("aiAvatar"), dict) else None
        if not new or not AV_TOKEN_RE.match(str(new)):
            pr.pop("aiAvatarNew", None)
            save_profiles(profiles)
            return {"ok": True, "token": cur}
        pr.pop("aiAvatarNew", None)
        if pick == "new":
            pr["aiAvatar"] = {"token": new, "at": pend.get("at") or time.time()}
            drop, keep = cur, new
        else:
            drop, keep = new, cur
        save_profiles(profiles)
    av_retire(drop)
    log("AI 캐릭터 고름:", pr.get("id", key), "새 것" if pick == "new" else "예전 것")
    return {"ok": True, "token": keep}


def serve_avatar(path):
    m = AV_FILE_RE.match(path)
    if not m:
        return None
    f = AVATARS / f"{m.group(1)}_{m.group(2)}"
    if not f.is_file():
        old = AVATARS / f"{m.group(1)}_old_{m.group(2)}"
        if not old.is_file():
            raise HttpError(404, "Not found")
        f = old
    return ("image/webp" if f.suffix == ".webp" else "image/png"), f.read_bytes()


def _num(x, lo, hi, name):
    v = float(x)
    if not math.isfinite(v) or not (lo <= v <= hi):
        raise ValueError(f"{name} 값이 이상해요.")
    return v


def clean_result(res):
    """PC 채보 엔진이 보낸 분석 결과 검사 (형식이 틀리면 저장하지 않음)"""
    if not isinstance(res, dict):
        raise ValueError("분석 결과 형식이 잘못됐어요.")
    out = {
        "duration": round(_num(res.get("duration"), 1, pipeline.MAX_SONG_SEC + 5, "길이"), 2),
        "bpm": round(_num(res.get("bpm"), 30, 400, "BPM"), 2),
        "offset": round(_num(res.get("offset"), -30, 30, "첫 박"), 3),
        "charts": {}, "charts6": {},
    }
    for key, nl in (("charts", 4), ("charts6", 6)):
        src = res.get(key)
        if not isinstance(src, dict):
            if key == "charts6":      # 아주 예전 곡은 6키 채보가 없음 → 불러올 때 4키에서 만들어 줌
                continue
            raise ValueError("채보가 비어 있어요.")
        for d, notes in src.items():
            if d in chartgen.DIFFS:
                out[key][d] = validate_notes(notes, nl)
    if not out["charts"]:
        raise ValueError("채보가 비어 있어요.")
    beats = res.get("beats") or []
    if not isinstance(beats, list) or len(beats) > 40000:
        raise ValueError("박 정보가 잘못됐어요.")
    out["beats"] = [round(_num(b, -5, pipeline.MAX_SONG_SEC + 30, "박"), 3) for b in beats]
    hl = res.get("highlight")
    if isinstance(hl, dict):
        a, b = _num(hl.get("start"), 0, out["duration"], "하이라이트"), _num(hl.get("end"), 0, out["duration"] + 1, "하이라이트")
        out["highlight"] = {"start": round(a, 3), "end": round(b, 3)} if b > a else None
    else:
        out["highlight"] = None
    ch = res.get("chorus") or []
    out["chorus"] = []
    if isinstance(ch, list):
        for c in ch[:100]:
            if isinstance(c, list) and len(c) == 2:
                a, b = _num(c[0], 0, out["duration"] + 1, "후렴"), _num(c[1], 0, out["duration"] + 1, "후렴")
                if b > a:
                    out["chorus"].append([round(a, 3), round(b, 3)])
    return out


def clean_meta(meta, vid):
    meta = meta if isinstance(meta, dict) else {}
    out = {}
    for k in ("title", "channel", "uploader", "artist", "creator", "track"):
        v = meta.get(k)
        if isinstance(v, str) and v.strip():
            out[k] = v.strip()[:200]
    arts = meta.get("artists")
    if isinstance(arts, list):
        out["artists"] = [str(a)[:80] for a in arts[:10] if isinstance(a, str)]
    out.setdefault("title", vid)
    return out


def finish_pc_job(job, meta, res):
    """엔진이 보낸 결과로 곡 저장 (가수 찾기 검색이 있어 작업 스레드에서)"""
    try:
        song = finish_song(job["vid"], meta, res, job.get("keepEdited"), job.get("keepTitle"))
        job.update(stage="done", msg="완료!", songId=job["vid"], finished=time.time())
        # 호스트 PC에 AI 채보 도구가 있으면 이어서 AI 채보도 (기존 채보는 이미 플레이 가능)
        if WORKER["ai"] and not job.get("noAi") and not song.get("ai"):
            enqueue_pc(job["vid"], title=song.get("title", job["vid"]), ai_only=True, batch=job.get("batch", False))
    except Exception as e:
        traceback.print_exc()
        job.update(stage="error", msg=f"저장하지 못했어요: {e}"[:300], finished=time.time())
    jobs_changed()


ACC_WIN = 0.05   # 기존 채보의 드럼 강타 시각과 이만큼(초) 가까운 AI 노트를 강타로
AI_OWN_GAIN = 0.03   # 난이도별 박자 밀기는 곡 전체 값보다 노트 3% 이상 더 맞을 때만
AI_FIX = 13       # AI 채보 다듬기 버전 (올리면 예전 AI 채보도 서버 켤 때 다시 다듬음)
HOLD_GAP = 0.1   # 롱노트 끝과 같은 줄 다음 노트 사이 최소 간격
MAX_HOLDS = 1    # 동시에 누르고 있는 롱노트 최대 개수 (롱노트는 최소한으로)
HOLD_MIN = 0.6   # 이보다 짧은 롱노트는 일반 노트로
HOLD_RATIO = 0.05   # 롱노트는 전체 노트의 5%까지만 (긴 것부터 남김)


def ai_tidy(notes):
    """AI 채보 롱노트 정리: 같은 줄 겹침 → 롱노트를 줄임(짧으면 일반 노트), 동시에 3개 이상 → 일반 노트, 같은 줄 거의 같은 시각 → 하나로"""
    notes = sorted(({"t": float(n["t"]), "l": int(n["l"]), "d": float(n.get("d", 0) or 0)} for n in notes),
                   key=lambda n: (n["t"], n["l"]))
    out, last_t = [], {}
    for n in notes:                      # 같은 줄 0.03초 안 중복 제거
        if n["t"] - last_t.get(n["l"], -9) < 0.03:
            continue
        last_t[n["l"]] = n["t"]
        out.append(n)
    by_lane = {}
    for n in out:
        by_lane.setdefault(n["l"], []).append(n)
    for lane_notes in by_lane.values():  # 같은 줄: 다음 노트 전에 롱노트가 끝나게
        for a, b in zip(lane_notes, lane_notes[1:]):
            if a["d"] > 0 and a["t"] + a["d"] > b["t"] - HOLD_GAP:
                a["d"] = b["t"] - HOLD_GAP - a["t"]
                if a["d"] < 0.2:
                    a["d"] = 0.0
    for n in out:                         # 짧은 롱노트 → 일반 노트
        if 0 < n["d"] < HOLD_MIN:
            n["d"] = 0.0
    holds = sorted((n for n in out if n["d"] > 0), key=lambda n: -n["d"])
    for n in holds[int(len(out) * HOLD_RATIO):]:   # 너무 많으면 긴 것만 남김
        n["d"] = 0.0
    held = []                             # 동시에 누르는 롱노트 수 제한
    for n in out:
        held = [e for e in held if e > n["t"] + 0.001]
        if n["d"] > 0:
            if len(held) >= MAX_HOLDS:
                n["d"] = 0.0
            else:
                held.append(n["t"] + n["d"])
    return [{"t": round(n["t"], 3), "l": n["l"], "d": round(n["d"], 3)} for n in out]


# 난이도별 목표 별점 범위 (방장이 정함): 쉬움 1.5~2.5 · 보통 3~5 · 어려움 6~7 · 극한 8 이상
STAR_BANDS = {"easy": (1.5, 2.5), "normal": (3.0, 5.0), "hard": (6.0, 7.0), "extreme": (8.0, 10.0)}
CHORD_MAX = {"easy": 1, "normal": 2, "hard": 3, "extreme": 3}   # 동시치기 최대 개수 (6키는 +1)
CHORD_RARE = {"hard": 0.03}   # 어려움: 3개짜리 동시치기는 드물게 (박 덩어리의 3%까지, 강타 먼저)


def band_mid(diff):
    lo, hi = STAR_BANDS.get(diff, (3.0, 5.0))
    return (lo + min(hi, lo + 1.0)) / 2 if diff == "extreme" else (lo + hi) / 2


def song_beats(song):
    """박 위치: 분석한 박이 있으면 그것, 없으면(예전 곡) BPM·첫 박으로 계산"""
    b = song.get("beats") or []
    if len(b) >= 8:
        return sorted(float(x) for x in b)
    bpm = max(40.0, min(300.0, float(song.get("bpm") or 120)))
    step, off = 60.0 / bpm, float(song.get("offset") or 0)
    dur = float(song.get("duration") or 300)
    k0 = -int(off / step) - 1
    return [round(off + k * step, 3) for k in range(k0, int((dur - off) / step) + 2) if 0 <= off + k * step <= dur + 1]


def _beat_tools(song):
    import bisect
    grid = sorted(set(round(float(b), 3) for b in song_beats(song)))
    half = sorted(set(grid + [round((x + y) / 2, 3) for x, y in zip(grid, grid[1:])]))

    def near(arr, t, w):
        i = bisect.bisect_left(arr, t)
        return any(0 <= j < len(arr) and abs(arr[j] - t) <= w for j in (i - 1, i))

    def on_beat(t):
        return 1.5 if near(grid, t, 0.04) else 0.8 if near(half, t, 0.04) else 0.0
    return near, on_beat


BEAT_GAP = {"easy": 1 / 2, "normal": 1 / 3, "hard": 1 / 4, "extreme": 1 / 4}   # 노트 사이 최소 간격(박 단위): 이보다 촘촘한 연타는 막음
GAP_CAP = {"easy": 0.32, "normal": 0.17, "hard": 0.105, "extreme": 0.08}   # 박 기준 간격의 상한(초): 템포를 절반으로 잡은 곡도 스트림이 살게


def need_gap(diff, beats, t):
    """t에서 노트 사이에 필요한 최소 간격(초)"""
    min_gap = float((chartgen.DIFFS.get(diff) or {}).get("min_gap", 0.1))
    return max(min_gap, min(beat_len_at(beats, t) * BEAT_GAP.get(diff, 0.25) * 0.92, GAP_CAP.get(diff, 0.11)))


def stream_bonus(times, i):
    """앞뒤 간격이 일정하게 이어지는 노트(스트림)면 보너스 — 덜어낼 때 나중에 빼게"""
    if 0 < i < len(times) - 1:
        a, b = times[i] - times[i - 1], times[i + 1] - times[i]
        if 0.06 < a < 0.35 and 0.06 < b < 0.35 and abs(a - b) <= 0.15 * max(a, b):
            return 1.8
    return 0.0


def beat_len_at(beats, t):
    """t 근처 한 박 길이 (박 목록에서)"""
    import bisect
    i = bisect.bisect_right(beats, t)
    lo, hi = max(1, i - 2), min(len(beats) - 1, i + 2)
    gaps = [beats[j] - beats[j - 1] for j in range(lo, hi + 1) if 0 < beats[j] - beats[j - 1] < 2.0]
    return sorted(gaps)[len(gaps) // 2] if gaps else 0.5


def snap_to_grid(song, notes, tol=0.03):
    """AI 노트를 박자 칸(1/4박 · 셋잇단 1/3박)에 맞춤 — 살짝 어긋난 노트끼리 붙어서 생기는 뭉침 방지"""
    import bisect
    beats = song_beats(song)
    if len(beats) < 4:
        return notes
    pts = []
    for x, y in zip(beats, beats[1:]):
        L = y - x
        pts += [x + L * k / 4 for k in range(4)] + [x + L / 3, x + 2 * L / 3]
    pts.sort()
    out = []
    for n in notes:
        t = float(n["t"])
        i = bisect.bisect_left(pts, t)
        best = min((pts[j] for j in (i - 1, i) if 0 <= j < len(pts)), key=lambda p: abs(p - t), default=t)
        n = dict(n)
        if abs(best - t) <= tol:
            n["t"] = round(best, 3)
        out.append(n)
    return out


def limit_chords(notes, diff, nl=4):
    """동시치기 최대 개수: 쉬움 1 · 보통/어려움 2 · 극한 3 (6키는 +1). 넘치면 서로 먼 줄을 남김"""
    cmax = CHORD_MAX.get(diff, 2) + (1 if nl == 6 and diff != "easy" else 0)
    groups = {}
    for n in notes:
        groups.setdefault(round(float(n["t"]), 3), []).append(n)
    def trim(g, m):
        g = sorted(g, key=lambda n: n["l"])
        idx = sorted({round(i * (len(g) - 1) / max(1, m - 1)) for i in range(m)}) if m > 1 else [0]
        return [g[i] for i in idx][:m]
    for t in groups:
        if len(groups[t]) > cmax:
            groups[t] = trim(groups[t], cmax)
    rare = CHORD_RARE.get(diff)
    if rare:                              # 가장 큰 동시치기는 드물게: 강타부터 남기고 나머지는 하나 줄임
        big = [t for t, g in groups.items() if len(g) >= cmax]
        allow = int(len(groups) * rare)
        big.sort(key=lambda t: (0 if any(n.get("a") for n in groups[t]) else 1, t))
        for t in big[allow:]:
            groups[t] = trim(groups[t], cmax - 1)
    return [n for t in sorted(groups) for n in groups[t]]


def fit_band(song, diff, notes, nl=4, pool=(), max_change=None, synth=True):
    """별점이 그 난이도의 목표 범위에 들어오게: 넘치면 박자에서 벗어난 노트·동시치기 곁가지부터 덜고,
    모자라면 pool(위 난이도 채보 등)에서 박자에 맞는 노트를 비어 있는 곳부터 더함. 그래도 모자라면 센 박에 동시치기 추가."""
    import bisect
    lo, hi = STAR_BANDS.get(diff, (0, 99))
    near, on_beat = _beat_tools(song)
    min_gap = float((chartgen.DIFFS.get(diff) or {}).get("min_gap", 0.1))
    jack = JACK_MIN.get(diff, 0.17)
    cmax = CHORD_MAX.get(diff, 2) + (1 if nl == 6 and diff != "easy" else 0) - (1 if diff in CHORD_RARE else 0)   # 새로 붙일 땐 드문 크기 제외
    notes = sorted((dict(n) for n in notes), key=lambda n: (n["t"], n["l"]))
    star = lambda ns: chartgen.star_rating(ns, nl)
    cur = star(notes)
    n0 = len(notes)
    budget = int(n0 * max_change) if max_change is not None else 10 ** 9   # 바꿀 수 있는 노트 수
    # 덜기
    it = 0
    while cur > hi and len(notes) > 16 and it < 40 and n0 - len(notes) < budget:
        it += 1
        groups = {}
        for n in notes:
            groups.setdefault(round(n["t"], 3), []).append(n)
        cand = []
        gtimes = sorted(groups)
        for gi, t in enumerate(gtimes):
            g = groups[t]
            base_score = on_beat(t) + (1.0 if any(n.get("a") for n in g) else 0) + stream_bonus(gtimes, gi)
            if len(g) > 1:
                cand.append((base_score - 0.7, t, g[-1]))      # 동시치기 곁가지부터
            cand.append((base_score, t, None))
        cand.sort(key=lambda c: c[0])
        k = max(1, int(len(notes) * 0.04))
        drop_ids, drop_t = set(), set()
        for sc, t, n in cand:
            if len(drop_ids) + sum(len(groups[x]) for x in drop_t) >= k:
                break
            if t in drop_t:
                continue
            if n is not None:
                drop_ids.add(id(n))
            else:
                drop_t.add(t)
        notes = [n for n in notes if id(n) not in drop_ids and round(n["t"], 3) not in drop_t]
        cur = star(notes)
    # 더하기
    it = 0
    pool = sorted(({k: v for k, v in n.items() if k in ("t", "l", "d", "a")} for n in pool), key=lambda n: n["t"])
    used_pool = set()
    beats = song_beats(song)
    grid_pts = []
    sub = 4 if diff in ("hard", "extreme") else 2
    if notes:
        first, last = notes[0]["t"] - 0.5, notes[-1]["t"] + 0.5
        for x, y2 in zip(beats, beats[1:]):
            for k2 in range(sub):
                gt = round(x + (y2 - x) * k2 / sub, 3)
                if first <= gt <= last:
                    grid_pts.append(gt)
    while cur < lo and it < 80 and len(notes) - n0 < budget:
        it += 1
        times = sorted({round(n["t"], 3) for n in notes})
        lane_times = {}
        for n in notes:
            lane_times.setdefault(n["l"], []).append(n["t"])
        for v in lane_times.values():
            v.sort()

        def free(t, l):
            i = bisect.bisect_left(times, t)
            need = need_gap(diff, beats, t)
            if any(0 <= j < len(times) and 0.003 < abs(times[j] - t) < need for j in (i - 1, i)):
                return False
            lt = lane_times.get(l, [])
            i = bisect.bisect_left(lt, t)
            return not any(0 <= j < len(lt) and abs(lt[j] - t) < jack for j in (i - 1, i))
        sec = {}
        for t in times:
            sec[int(t)] = sec.get(int(t), 0) + 1
        k = max(2, int(len(notes) * 0.04))
        cands = []
        for i, n in enumerate(pool):
            if i in used_pool or not free(n["t"], n["l"]):
                continue
            same = [x for x in notes if abs(x["t"] - n["t"]) < 0.003]
            if same and (len(same) >= cmax or any(x["l"] == n["l"] for x in same)):
                continue
            cands.append((-(on_beat(n["t"]) + (0.8 if n.get("a") else 0)) + 0.15 * sec.get(int(n["t"]), 0), i))
        cands.sort()
        added = 0
        for _, i in cands:
            if added >= k:
                break
            n = dict(pool[i])
            used_pool.add(i)
            if not free(n["t"], n["l"]):          # 같은 묶음에서 먼저 넣은 노트와 너무 붙으면 건너뜀
                continue
            j = bisect.bisect_left(times, n["t"])
            for jj in (j - 1, j):                  # 거의 같은 시각이면 그 박에 정확히 맞춰 동시치기로
                if 0 <= jj < len(times) and abs(times[jj] - n["t"]) <= 0.003:
                    n["t"] = times[jj]
            if any(abs(x["t"] - n["t"]) < 0.001 and x["l"] == n["l"] for x in notes):
                continue
            notes.append(n)
            if n["t"] not in times:
                times.insert(bisect.bisect_left(times, n["t"]), n["t"])
            lane_times.setdefault(n["l"], []).append(n["t"])
            lane_times[n["l"]].sort()
            added += 1
        if not added and grid_pts and synth:   # 가져올 노트가 없으면: 박·반박(어려움 이상은 1/4박) 빈자리에 노트
            gc = []
            for t in grid_pts:
                if any(abs(x - t) < 0.003 for x in times[max(0, bisect.bisect_left(times, t) - 1):bisect.bisect_left(times, t) + 1]):
                    continue
                lanes = [l for l in range(nl) if free(t, l)]
                if lanes:
                    j = bisect.bisect_left(times, t)
                    a_ = times[j - 1] if j > 0 else None
                    b_ = times[j] if j < len(times) else None
                    # 두 노트 사이 한가운데(8분 → 16분처럼)면 흐름이 스트림으로 이어짐 → 먼저 채움
                    mid = a_ is not None and b_ is not None and b_ - a_ < 0.5 and abs((t - a_) - (b_ - t)) < 0.02
                    gc.append((-on_beat(t) - (1.6 if mid and diff in ("hard", "extreme") else 0) + 0.2 * sec.get(int(t), 0), t, lanes))
            gc.sort()
            for _, t, lanes in gc[:k]:
                lanes = [l for l in lanes if free(t, l)]      # 같은 묶음에서 먼저 넣은 노트와 겹치지 않게
                if not lanes:
                    continue
                before = [n for n in notes if n["t"] < t - 0.003]
                pl = max(before, key=lambda n: n["t"])["l"] if before else None
                # 이웃한 줄로 자연스럽게 이어지게 (같은 줄은 피함)
                l2 = min(lanes, key=lambda l: (abs(abs(l - pl) - 1) if pl is not None else 0, random.random()))
                notes.append({"t": t, "l": l2, "d": 0.0})
                lane_times.setdefault(l2, []).append(t)
                lane_times[l2].sort()
                i2 = bisect.bisect_left(times, t)
                times.insert(i2, t)
                added += 1
        if not added and synth:            # 더 가져올 노트가 없으면: 센 박의 한 개짜리 노트에 동시치기
            groups = {}
            for n in notes:
                groups.setdefault(round(n["t"], 3), []).append(n)
            strong = sorted((t for t, g in groups.items() if len(g) < cmax and on_beat(t) >= 0.8),
                            key=lambda t: (-(1 if any(n.get("a") for n in groups[t]) else 0), -on_beat(t), sec.get(int(t), 0)))
            for t in strong[:k]:
                taken = {n["l"] for n in groups[t]}
                lanes = [l for l in range(nl) if l not in taken and free(t, l) or (l not in taken and not lane_times.get(l))]
                if not lanes:
                    continue
                l2 = max(lanes, key=lambda l: min(abs(l - u) for u in taken))
                notes.append({"t": t, "l": l2, "d": 0.0})
                lane_times.setdefault(l2, []).append(t)
                lane_times[l2].sort()
                added += 1
            if not added:
                break
        notes.sort(key=lambda n: (n["t"], n["l"]))
        cur = star(notes)
    return notes


GAP_FILL = 1.6     # AI 채보가 이보다 오래(초) 비어 있고 기존 채보엔 노트가 있으면 기존 채보로 채움
DENSE_X = 1.25     # 1초 구간 AI 노트 수가 기존 채보의 이 배수(+1개)를 넘으면 덜어냄
JACK_MIN = {"easy": 0.4, "normal": 0.25, "hard": 0.14, "extreme": 0.1}
NPS_CAP = {"easy": 4, "normal": 7, "hard": 11, "extreme": 15}   # 1초에 이보다 많으면(랩 폭주 등)만 덜어냄
AI_MAX_CHANGE = 0.2   # 별 범위 맞추기로 AI 채보를 바꾸는 건 노트의 20%까지 (AI 채보 느낌 유지)   # 같은 줄 연타 최소 간격(초)


def ai_balance(song, diff, notes):
    """AI가 보컬(랩 등)에만 쏠리는 것 보정 — 기존 채보(악기·박자를 따라감)를 기준으로
    1) 전주·간주처럼 AI 채보가 비어 있는 구간 → 기존 채보 노트로 채움
    2) 노트가 미친 듯이 몰리는 구간 → 박자(기존 채보 노트·박 위치)에 맞는 노트만 남김"""
    import bisect
    import math
    base = sorted(((song.get("charts") or {}).get(diff) or []), key=lambda n: n["t"])
    if not base or not notes:
        return notes
    # AI(MuG)는 이미 자기 박자 칸에 맞춰 둠 → 우리 박 분석으로 다시 옮기지 않음 (옮기면 박이 어긋나고 스트림 간격이 흐트러짐)
    notes = sorted((dict(n) for n in notes), key=lambda n: (n["t"], n["l"]))
    bpm = float(song.get("bpm") or 120)
    beat = 60.0 / max(40.0, min(300.0, bpm))
    gap_min = max(GAP_FILL, 3 * beat)
    btimes = [float(n["t"]) for n in base]
    # 1) 빈 구간 채우기 (곡 처음 ~ 첫 노트, 노트 사이, 마지막 노트 ~ 끝)
    times = [-1.0] + [n["t"] for n in notes] + [float(song.get("duration") or btimes[-1] + 1) + 1.0]
    fill = []
    for a, b in zip(times, times[1:]):
        if b - a < gap_min:
            continue
        lo, hi = a + 0.25, b - 0.25
        i = bisect.bisect_left(btimes, lo)
        while i < len(base) and base[i]["t"] < hi:
            n = base[i]
            if n["t"] + float(n.get("d", 0) or 0) < b - 0.15:
                fill.append({k: v for k, v in n.items() if k in ("t", "l", "d", "a")})
            i += 1
    notes = sorted(notes + fill, key=lambda n: (n["t"], n["l"]))
    # 2) 몰림 덜어내기: 1초 구간마다 허용 개수 = max(기존 × 1.5 + 2, 기존 상위 10% 밀도 × 1.2)
    dur = max(n["t"] for n in notes) + 1
    nsec = int(math.ceil(dur))
    bcount = [0] * (nsec + 1)
    for t in btimes:
        if 0 <= t <= nsec:
            bcount[int(t)] += 1
    # 기존 채보 별점이 목표 범위와 다르면 그만큼 기준 밀도도 맞춰서 비교
    bstar = chartgen.star_rating(base, 4) or 1.0
    scale = max(0.6, min(2.5, band_mid(diff) / bstar))
    bcount = [int(round(c * scale)) for c in bcount]
    busy = sorted(c for c in bcount if c)
    p90 = busy[int(len(busy) * 0.9)] if busy else 4
    grid = sorted(set(round(float(b), 3) for b in song_beats(song)))

    def near(arr, t, w):
        i = bisect.bisect_left(arr, t)
        return any(0 <= j < len(arr) and abs(arr[j] - t) <= w for j in (i - 1, i))

    half = sorted(set(grid + [round((x + y) / 2, 3) for x, y in zip(grid, grid[1:])]))
    groups = {}
    for n in notes:                       # 동시치기는 한 덩어리로
        groups.setdefault(round(n["t"], 3), []).append(n)
    keep = []
    for sec in range(nsec + 1):
        gs = [t for t in groups if sec <= t < sec + 1]
        cnt = sum(len(groups[t]) for t in gs)
        # 앞뒤 1초까지 같이 봐서 기존 채보가 부드럽게 비교되게
        # 기존 채보와 비교하지 않고, 사람이 칠 수 있는 한계(초당 개수)를 넘을 때만 덜어냄 → AI 채보 느낌 유지
        allow = NPS_CAP.get(diff, 11)
        if cnt <= allow:
            keep += gs
            continue
        gtimes = sorted(groups)
        gidx = {t: k for k, t in enumerate(gtimes)}

        def score(t):
            return (2 if near(btimes, t, 0.05) else 0) + (1.5 if near(grid, t, 0.04) else 0.8 if near(half, t, 0.04) else 0) \
                   + (0.5 if any(n.get("a") for n in groups[t]) else 0) + stream_bonus(gtimes, gidx[t])
        ranked = sorted(gs, key=lambda t: (-score(t), t))
        total, chosen = 0, []
        for t in ranked:
            if total + len(groups[t]) > allow:
                continue
            chosen.append(t)
            total += len(groups[t])
        keep += chosen
    # 3) 난이도별 최소 간격 (기존 채보와 같은 기준): 너무 붙은 노트는 박자에 맞는 쪽만
    min_gap = float((chartgen.DIFFS.get(diff) or {}).get("min_gap", 0.1))
    jack = JACK_MIN.get(diff, 0.17)
    def score2(t):
        return (2 if near(btimes, t, 0.05) else 0) + (1.5 if near(grid, t, 0.04) else 0.8 if near(half, t, 0.04) else 0) \
               + (0.5 if any(n.get("a") for n in groups[t]) else 0)
    beats_all = song_beats(song)
    frac = BEAT_GAP.get(diff, 0.25)
    spaced = []
    for t in sorted(keep):
        gap_need = need_gap(diff, beats_all, t)   # 그 곡 박자 기준 (템포를 절반으로 잡아도 스트림은 살게 상한)
        if spaced and t - spaced[-1] < gap_need - 0.002:
            if score2(t) > score2(spaced[-1]):
                spaced[-1] = t
            continue
        spaced.append(t)
    out, lane_last = [], {}
    for t in spaced:
        for n in groups[t]:
            if t - lane_last.get(n["l"], -9) < jack:     # 같은 줄 너무 빠른 연타 → 뺌
                continue
            lane_last[n["l"]] = t + float(n.get("d", 0) or 0)
            out.append(n)
    return out


AI_REC_OFF = 0.10     # AI 노트 중 '소리 없는 곳(기존 채보가 찾은 소리와 60ms 넘게 떨어짐)' 비율이 이보다 적고
AI_REC_MATCH = 0.5    # 소리와 25ms 안으로 맞는 비율이 이 이상이면 AI 채보를 기본으로 (아니면 기존 채보가 기본, 칩으로 바꿀 수 있음)
SAFE_GAP = {"easy": 0.3, "normal": 0.15, "hard": 0.075, "extreme": 0.06}   # 이보다 붙은 노트는 사람이 못 침 (안전장치만)


def basic_onsets(song):
    """기존 채보 노트 시각 — AI 채보 박자를 맞추는 기준 (사용자 싱크가 그동안 기존 채보에 맞춰져 있어서)"""
    return sorted({round(float(n["t"]), 3) for v in (song.get("charts") or {}).values() for n in v})


def sound_onsets(song):
    """음원의 소리 위치 — '소리 없는 곳' 판단용. 소리 분리로 찾은 위치가 있으면 그것(보컬·악기 전부), 없으면 기존 채보
    (분리로 찾은 위치는 소리가 커지는 지점이라 기존 채보보다 15ms쯤 늦게 잡혀서, 박자 맞추기에는 안 씀)"""
    on = song.get("onsets")
    if isinstance(on, list) and len(on) >= 30:
        return sorted(float(t) for t in on)
    return basic_onsets(song)


def _match_rate(times, onsets, shift, w):
    import bisect
    k = 0
    for t in times:
        x = t + shift
        i = bisect.bisect_left(onsets, x)
        if any(0 <= j < len(onsets) and abs(onsets[j] - x) <= w for j in (i - 1, i)):
            k += 1
    return k / max(1, len(times))


def _best_shift(times, onsets):
    base = _match_rate(times, onsets, 0.0, 0.015)
    best = max(((_match_rate(times, onsets, sh / 1000, 0.015), sh) for sh in range(-60, 125, 5)), key=lambda x: (x[0], -abs(x[1])))
    fine = max(((_match_rate(times, onsets, sh / 1000, 0.012), sh) for sh in range(best[1] - 4, best[1] + 5)), key=lambda x: (x[0], -abs(x[1])))
    return fine[1] / 1000 if best[0] - base >= 0.03 and abs(fine[1]) >= 5 else 0.0


def ai_fit(song, charts):
    """AI 채보가 음원보다 얼마나 일찍/늦게 나오는지 재기 (실제 39곡: 15~60ms 일찍, 곡마다 다름)
    AI 후보마다 박 위치가 조금씩 달라서(같은 곡도 최대 30ms) 난이도마다도 재 보고, 확실히 더 맞을 때만 그 값을 씀
    → ({난이도: 밀 시간 초}, 맞는 비율, 소리 없는 곳 비율)"""
    onsets = basic_onsets(song)
    sound = sound_onsets(song)
    alltimes = sorted({round(float(n["t"]), 3) for v in charts.values() for n in v})
    if len(onsets) < 30 or len(alltimes) < 30:
        return {d: 0.0 for d in charts}, 0.0, 0.0
    common = _best_shift(alltimes, onsets)
    shifts, hit, hit60, tot = {}, 0.0, 0.0, 0
    for d, v in charts.items():
        times = sorted({round(float(n["t"]), 3) for n in v})
        sh = common
        if len(times) >= 30:                         # 그 난이도만 따로 잰 값이 확실히 더 잘 맞을 때만 따로 밈 (아니면 곡 전체 값)
            own = _best_shift(times, onsets)
            if own != common and _match_rate(times, onsets, own, 0.025) >= _match_rate(times, onsets, common, 0.025) + AI_OWN_GAIN:
                sh = own
        shifts[d] = sh
        hit += _match_rate(times, onsets, sh, 0.025) * len(times)
        hit60 += _match_rate(times, sound, sh, 0.06 if sound is onsets else 0.075) * len(times)
        tot += len(times)
    return shifts, round(hit / max(1, tot), 3), round(1 - hit60 / max(1, tot), 3)


def ai_safe(song, diff, notes):
    """AI 채보는 거의 그대로 — 사람이 칠 수 없는 것만 고침:
    1) 아주 긴 빈 구간(전주·간주에서 AI가 통째로 비운 곳)만 기존 채보로 채움 (노트끼리 섞지 않고 구간 단위)
    2) 1초에 사람 한계보다 많이 몰린 곳(랩 폭주 등)만 덜어냄
    3) 붙어서 칠 수 없는 노트 · 같은 줄 너무 빠른 연타만 뺌"""
    import bisect
    base = sorted(((song.get("charts") or {}).get(diff) or []), key=lambda n: n["t"])
    notes = sorted((dict(n) for n in notes), key=lambda n: (n["t"], n["l"]))
    if not notes:
        return notes
    beat = 60.0 / max(40.0, min(300.0, float(song.get("bpm") or 120)))
    gap_min = max(3.0, 8 * beat)                     # 두 마디쯤 통째로 비었을 때만
    if base:
        btimes = [float(n["t"]) for n in base]
        times = [-1.0] + [n["t"] for n in notes] + [float(song.get("duration") or btimes[-1] + 1) + 1.0]
        fill = []
        for a, b in zip(times, times[1:]):
            if b - a < gap_min:
                continue
            i = bisect.bisect_left(btimes, a + 0.4)
            while i < len(base) and base[i]["t"] < b - 0.4:
                n = base[i]
                if n["t"] + float(n.get("d", 0) or 0) < b - 0.2:
                    fill.append({k: v for k, v in n.items() if k in ("t", "l", "d", "a")})
                i += 1
        notes = sorted(notes + fill, key=lambda n: (n["t"], n["l"]))
    groups = {}
    for n in notes:
        groups.setdefault(round(n["t"], 3), []).append(n)
    gtimes = sorted(groups)
    cap = NPS_CAP.get(diff, 11)
    keep = []
    for sec in range(int(gtimes[-1]) + 2):           # 사람 한계를 넘는 1초만 덜기 (스트림·박자 위 노트를 남김)
        gs = [t for t in gtimes if sec <= t < sec + 1]
        if sum(len(groups[t]) for t in gs) <= cap:
            keep += gs
            continue
        idx = {t: k for k, t in enumerate(gtimes)}
        ranked = sorted(gs, key=lambda t: (-(stream_bonus(gtimes, idx[t]) + (1 if any(n.get("a") for n in groups[t]) else 0)), t))
        tot = 0
        for t in ranked:
            if tot + len(groups[t]) <= cap:
                keep.append(t)
                tot += len(groups[t])
    floor = SAFE_GAP.get(diff, 0.075)
    jack = JACK_MIN.get(diff, 0.14)
    spaced = []
    for t in sorted(keep):
        if spaced and t - spaced[-1] < floor - 0.002:
            continue
        spaced.append(t)
    out, lane_last = [], {}
    for t in spaced:
        for n in groups[t]:
            if t - lane_last.get(n["l"], -9) < jack:
                continue
            lane_last[n["l"]] = t + float(n.get("d", 0) or 0)
            out.append(n)
    return out


def ai_accents(song, charts):
    """AI 채보 다듬기 (최소한만): 박자 밀기(음원에 맞춤) → 칠 수 없는 것만 고침 → 롱노트 정리 → 동시치기 제한 → 강타 표시"""
    import bisect
    shifts, match, off = ai_fit(song, charts)
    acc = sorted({round(float(n["t"]), 3) for notes in (song.get("charts") or {}).values() for n in notes if n.get("a")})
    out = {}
    for d in [d for d in ("easy", "normal", "hard", "extreme") if d in charts]:
        shift = shifts.get(d, 0.0)
        moved = [dict(n, t=round(float(n["t"]) + shift, 3)) for n in charts[d] if float(n["t"]) + shift >= 0]
        notes = limit_chords(ai_tidy(ai_safe(song, d, moved)), d)
        res = []
        for n in notes:
            n = {k: v for k, v in n.items() if k != "a"}
            if acc:
                i = bisect.bisect_left(acc, n["t"])
                near = min((abs(acc[j] - n["t"]) for j in (i - 1, i) if 0 <= j < len(acc)), default=9)
                if near <= ACC_WIN:
                    n["a"] = 1
                    n["d"] = 0.0 if n.get("d", 0) < 0.3 else n["d"]
            res.append(n)
        out[d] = res
    vals = [round(v * 1000) for v in shifts.values()]
    out["_fit"] = {"shift": round(sum(vals) / max(1, len(vals))), "shifts": {d: round(v * 1000) for d, v in shifts.items()}, "match": match, "off": off, "rec": off < AI_REC_OFF and match >= AI_REC_MATCH}
    return out


def migrate_ai_accents():
    """예전에 저장된 AI 채보에도 강타 표시를 한 번 붙임 (서버 켤 때)"""
    n = 0
    for p in SONGS.glob("*.json"):
        if not VID_RE.match(p.stem):
            continue
        try:
            with FILE_LOCK:
                song = load_song(p.stem)
                ai = song and song.get("ai")
                if not isinstance(ai, dict) or ai.get("fix", 0) >= AI_FIX or not isinstance(ai.get("charts"), dict):
                    continue
                ai.setdefault("gen", 1)   # 이 업데이트 전에 만든 AI 채보 = 예전 방식 (롱노트 많은 osu! 스타일)
                ai["charts"] = ai_accents(song, ai.get("raw") or ai["charts"])   # AI 원본이 있으면 원본부터 다시 다듬음
                ai["fit"] = ai["charts"].pop("_fit")
                ai["fix"] = AI_FIX
                ai.pop("acc", None)
                save_song(song)
            n += 1
        except Exception:
            traceback.print_exc()
    if n:
        log(f"AI 채보 {n}곡을 다듬었어요 (빈 구간 채우기 · 몰림 덜기 · 롱노트 정리 · 강타 표시).")
        notify_all({"type": "songs"})


BAND_VER = 1   # 기존 채보 별 범위 맞춤 버전 (올리면 저장된 곡도 서버 켤 때 한 번 맞춤)


BACKUPS = Path(os.environ.get("LB_BACKUPS") or "/var/backups/linkbeat")
RESTORE_BEFORE = "20261020"   # 별 범위 맞추기(10/20 밤)를 하기 전 백업
RESTORE_MARK = DATA / ".basic_restored_v1"


def restore_basic_from_backup():
    """기존 채보를 '별 범위 맞추기' 전으로 되돌림 (서버 켤 때 한 번) — 서버가 남겨 둔 매일 백업에서 기존 채보만 꺼냄.
    AI 채보·기록·제목·직접 고친 난이도(백업 뒤에 고친 것)는 그대로. 백업에 없는 곡(그 뒤 추가)은 PC에서 다시 만들기 대기열로."""
    import tarfile
    if RESTORE_MARK.exists():
        return
    touched = [p.stem for p in SONGS.glob("*.json") if VID_RE.match(p.stem) and (load_song(p.stem) or {}).get("bandFix")]
    if not touched:
        RESTORE_MARK.write_text("nothing", encoding="utf-8")
        return
    cands = sorted(p for p in BACKUPS.glob("linkbeat-*.tgz") if p.stem.split("-")[-1][:8] <= RESTORE_BEFORE) if BACKUPS.is_dir() else []
    backup = {}
    when = 0.0
    if cands:
        try:
            with tarfile.open(cands[-1], "r:gz") as tf:
                for m in tf:
                    parts = m.name.split("/")
                    if m.isfile() and len(parts) >= 2 and parts[-2] == "songs" and parts[-1].endswith(".json") and parts[-1][:-5] in touched:
                        try:
                            backup[parts[-1][:-5]] = json.loads(tf.extractfile(m).read().decode("utf-8"))
                            when = max(when, m.mtime)
                        except Exception:
                            pass
        except Exception:
            traceback.print_exc()
    restored = rebuilt = 0
    for sid in touched:
        with FILE_LOCK:
            song = load_song(sid)
            if not song:
                continue
            old = backup.get(sid)
            if isinstance(old, dict) and not old.get("bandFix"):
                edited = song.get("edited") or {}
                for key, nl in (("charts", 4), ("charts6", 6)):
                    src = old.get(key) or {}
                    for d, notes in src.items():
                        ek = d if nl == 4 else f"6-{d}"
                        if edited.get(ek, 0) > when:      # 백업 뒤에 직접 고친 난이도는 그대로
                            continue
                        song.setdefault(key, {})[d] = notes
                song.pop("bandFix", None)
                save_song(song)
                restored += 1
                continue
            # 백업에 없는 곡: PC 채보 엔진이 원래 방식으로 다시 만듦 (제목·고친 난이도 유지, AI 채보는 그대로)
            song.pop("bandFix", None)
            save_song(song)
        if CLOUD:
            enqueue_pc(sid, True, True, song.get("title", sid), batch=True)
        rebuilt += 1
    RESTORE_MARK.write_text(json.dumps({"backup": str(cands[-1]) if cands else None, "restored": restored, "rebuild": rebuilt}), encoding="utf-8")
    log(f"기존 채보 되돌리기: 백업에서 {restored}곡 · PC에서 다시 만들기 {rebuilt}곡" + (f" ({cands[-1].name})" if cands else " (백업 없음)"))
    notify_all({"type": "songs"})


def migrate_basic_bands():
    """예전에 만든 기존(자동) 채보도 난이도별 별 범위에 맞춤 (서버 켤 때 한 번, 고친 난이도는 그대로)"""
    n = 0
    for p in SONGS.glob("*.json"):
        if not VID_RE.match(p.stem):
            continue
        try:
            with FILE_LOCK:
                song = load_song(p.stem)
                if not song or song.get("bandFix", 0) >= BAND_VER:
                    continue
                fit_basic(song)
                save_song(song)
            n += 1
        except Exception:
            traceback.print_exc()
    if n:
        log(f"기존 채보 {n}곡을 난이도별 별 범위에 맞췄어요.")
        notify_all({"type": "songs"})


def fit_basic(song):
    """기존(자동) 채보도 난이도별 별점 범위에 맞춤 — 채보 수정기로 고친 난이도는 그대로"""
    order = ("easy", "normal", "hard", "extreme")
    edited = song.get("edited") or {}
    for key, nl in (("charts", 4), ("charts6", 6)):
        ch = song.get(key) or {}
        for i, d in enumerate(order):
            if d not in ch or not ch[d] or edited.get(d if nl == 4 else f"6-{d}"):
                continue
            pool = [n for u in order[i + 1:] for n in ch.get(u, [])]
            try:
                cur = ch[d]
                for _ in range(3):
                    cur = limit_chords(fit_band(song, d, cur, nl, pool), d, nl)
                    lo, hi = STAR_BANDS[d]
                    if lo <= chartgen.star_rating(cur, nl) <= hi:
                        break
                ch[d] = validate_notes(cur, nl)
            except Exception:
                traceback.print_exc()
    song["bandFix"] = BAND_VER


def save_ai(vid, data):
    """AI 채보 저장 (기존 채보와 따로). data = {"charts": {난이도: 노트}, "by": "..."}"""
    with FILE_LOCK:
        song = load_song(vid)
        if song is None:
            raise HttpError(404, "곡이 없어요.")
        src = data.get("charts") if isinstance(data, dict) else None
        if not isinstance(src, dict):
            raise HttpError(400, "AI 채보 형식이 잘못됐어요.")
        charts = {}
        try:
            for d, notes in src.items():
                if d in chartgen.DIFFS:
                    charts[d] = validate_notes(notes, 4)
        except (KeyError, TypeError, ValueError) as e:
            raise HttpError(400, str(e) or "노트 형식이 잘못됐어요.")
        charts = {d: n for d, n in charts.items() if n}
        if not charts:
            raise HttpError(400, "AI 채보가 비어 있어요.")
        on = data.get("onsets")
        if isinstance(on, list) and 30 <= len(on) <= 40000:     # 소리 분리로 찾은 소리 위치 (호스트 PC가 보냄)
            try:
                song["onsets"] = sorted(round(float(t), 3) for t in on if 0 <= float(t) <= pipeline.MAX_SONG_SEC)
            except (TypeError, ValueError):
                pass
        polished = ai_accents(song, charts)
        fit = polished.pop("_fit")
        song["ai"] = {"charts": polished, "raw": charts, "fit": fit, "by": str(data.get("by") or "AI")[:60], "at": time.time(), "fix": AI_FIX,
                      "gen": 2}   # 2 = 새 방식 (일반 노트 위주로 생성)
        save_song(song)
    notify_all({"type": "songs"})
    log("AI 채보 저장:", song.get("title"), {d: len(n) for d, n in charts.items()})
    return {"ok": True, "counts": {d: len(n) for d, n in polished.items()},
            "stars": {d: chartgen.star_rating(n, 4) for d, n in polished.items()}, "fit": fit}


def finish_ai_job(job, ai):
    try:
        save_ai(job["vid"], ai)
        job.update(stage="done", msg="AI 채보 완료!", songId=job["vid"], finished=time.time())
    except HttpError as e:
        job.update(stage="error", msg=f"AI 채보를 저장하지 못했어요: {e.msg}"[:300], finished=time.time())
    except Exception as e:
        traceback.print_exc()
        job.update(stage="error", msg=f"AI 채보를 저장하지 못했어요: {e}"[:300], finished=time.time())
    jobs_changed()


def run_batch_cloud(ids, keep_edited):
    """클라우드 모드의 전체 다시 만들기: 한 곡씩 대기열에 넣고 끝나길 기다림 (그사이 새 곡 추가가 먼저 처리될 수 있음)"""
    try:
        for vid in ids:
            if BATCH["cancel"]:
                break
            old = load_song(vid)
            if not old:
                BATCH["done"] += 1
                continue
            BATCH["current"] = old.get("title", vid)
            batch_notify()
            j = enqueue_pc(vid, keep_edited, True, old.get("title", vid), batch=True)
            while j["stage"] in PENDING and not BATCH["cancel"]:
                time.sleep(1.0)
            if BATCH["cancel"] and j["stage"] == "waitpc":
                j.update(stage="canceled", msg="취소됨", finished=time.time())
                jobs_changed()
            if j["stage"] == "done":
                BATCH["ok"] += 1
            elif j["stage"] != "canceled":
                BATCH["failed"].append({"title": old.get("title", vid), "msg": str(j.get("msg", ""))[:160]})
            BATCH["done"] += 1
            batch_notify()
    finally:
        BATCH.update(running=False, current="", finished=time.time())
        batch_notify()


def import_item(data):
    """PC에 있던 데이터를 클라우드 서버로 옮기기 (호스트 PC 채보 엔진이 하나씩 보냄). 이미 있는 건 더 좋은 쪽을 남김."""
    kind = data.get("type")
    if kind == "song":
        src = data.get("song")
        if not isinstance(src, dict) or not VID_RE.match(str(src.get("id", ""))):
            raise HttpError(400, "곡 형식이 잘못됐어요.")
        vid = src["id"]
        if song_path(vid).exists() and not data.get("overwrite"):
            return {"ok": True, "skipped": True}
        try:
            res = clean_result(src)
        except (KeyError, TypeError, ValueError) as e:
            raise HttpError(400, f"{src.get('title', vid)}: {e}")
        song = {"id": vid, **res}
        if not song["charts6"]:
            song.pop("charts6")
        for k in ("title", "channel", "artist", "artistSrc"):
            if isinstance(src.get(k), str):
                song[k] = src[k][:200]
        for k in ("artistVer", "artistAt", "created"):
            if isinstance(src.get(k), (int, float)) and math.isfinite(src[k]):
                song[k] = src[k]
        song.setdefault("title", vid)
        song.setdefault("created", time.time())
        ed = src.get("edited")
        song["edited"] = {str(k)[:12]: v for k, v in ed.items() if isinstance(v, (int, float))} if isinstance(ed, dict) else {}
        save_song(song)
        return {"ok": True}
    if kind == "scores":
        vid = str(data.get("id", ""))
        d = data.get("data")
        if not VID_RE.match(vid) or not isinstance(d, dict) or not isinstance(d.get("entries"), list):
            raise HttpError(400, "기록 형식이 잘못됐어요.")
        with FILE_LOCK:
            sc = load_scores(vid)
            best = {}
            for e in sc["entries"] + [e for e in d["entries"] if isinstance(e, dict)]:
                try:
                    k = (str(e["name"])[:16], str(e["diff"]), int(e.get("keys", 4)), bool(e.get("hl")), bool(e.get("ai")))
                    if k[1] not in chartgen.DIFFS or not math.isfinite(float(e["score"])):
                        continue
                except (KeyError, TypeError, ValueError):
                    continue
                if k not in best or float(e["score"]) > float(best[k]["score"]):
                    best[k] = e
            sc["entries"] = list(best.values())
            sc["plays"] = max(sc["plays"], int(d.get("plays", 0) or 0))
            save_scores(vid, sc)
        return {"ok": True}
    if kind == "profiles":
        d = data.get("data")
        if not isinstance(d, dict):
            raise HttpError(400, "프로필 형식이 잘못됐어요.")
        added = 0
        with FILE_LOCK:
            profiles = load_profiles()
            for k, pr in d.items():
                if not isinstance(pr, dict) or not all(x in pr for x in ("id", "salt", "pin")):
                    continue
                cur = profiles.get(k)
                if cur is None or float(pr.get("updated", 0) or 0) > float(cur.get("updated", 0) or 0):
                    profiles[k] = pr
                    added += 1
            save_profiles(profiles)
        return {"ok": True, "added": added}
    if kind == "requests":
        d = data.get("data")
        if not isinstance(d, list):
            raise HttpError(400, "신청 형식이 잘못됐어요.")
        with FILE_LOCK:
            reqs = load_requests()
            have = {r.get("vid") for r in reqs}
            for r in d:
                if isinstance(r, dict) and VID_RE.match(str(r.get("vid", ""))) and r["vid"] not in have and not song_path(r["vid"]).exists():
                    reqs.append({k: r.get(k) for k in ("id", "vid", "title", "channel", "by", "at")})
                    have.add(r["vid"])
            save_requests(reqs[:50])
        notify_all({"type": "requests"})
        return {"ok": True}
    if kind == "learn":
        d = data.get("data")
        if not isinstance(d, dict):
            raise HttpError(400, "형식이 잘못됐어요.")
        with FILE_LOCK:
            learn = load_learn()
            for a in d.get("known", []) if isinstance(d.get("known"), list) else []:
                if isinstance(a, str) and a not in learn["known"]:
                    learn["known"].append(a[:80])
            if isinstance(d.get("chanOrder"), dict):
                for k, v in d["chanOrder"].items():
                    if isinstance(v, str):
                        learn["chanOrder"][str(k)[:100]] = v[:20]
            learn["known"] = learn["known"][-2000:]
            write_json_atomic(LEARN_FILE, learn)
        return {"ok": True}
    if kind == "done":
        notify_all({"type": "songs"})
        return {"ok": True}
    raise HttpError(400, "알 수 없는 항목이에요.")


# 곡 신청 도배 막기: 같은 곳(IP)에서 10분에 5번까지
REQ_RATE = {}


def request_rate_ok(ip):
    now = time.time()
    lst = [t for t in REQ_RATE.get(ip, []) if now - t < 600]
    if len(lst) >= 5:
        REQ_RATE[ip] = lst
        return False
    lst.append(now)
    REQ_RATE[ip] = lst
    if len(REQ_RATE) > 2000:
        for k in [k for k, v in REQ_RATE.items() if not v or now - v[-1] > 600]:
            REQ_RATE.pop(k, None)
    return True


def validate_notes(notes, nl=4):
    if not isinstance(notes, list) or len(notes) > 20000:
        raise ValueError("노트 형식이 잘못됐어요.")
    out = []
    for n in notes:
        t = float(n["t"])
        l = int(n["l"])
        d = float(n.get("d", 0) or 0)
        if not (0 <= l < nl) or not (0 <= t <= pipeline.MAX_SONG_SEC) or not (0 <= d <= 60):
            raise ValueError("노트 값이 범위를 벗어났어요.")
        note = {"t": round(t, 3), "l": l, "d": round(d, 3)}
        if n.get("a"):          # 드럼 강타 표시 (크게 터지는 연출)
            note["a"] = 1
        out.append(note)
    out.sort(key=lambda n: (n["t"], n["l"]))
    return out


# ============================================================ HTTP
class HttpError(Exception):
    def __init__(self, status, msg):
        super().__init__(msg)
        self.status = status
        self.msg = msg


STATUS_TEXT = {200: "OK", 201: "Created", 204: "No Content", 400: "Bad Request", 401: "Unauthorized", 403: "Forbidden",
               404: "Not Found", 405: "Method Not Allowed", 409: "Conflict", 413: "Payload Too Large",
               429: "Too Many Requests", 500: "Internal Server Error"}


def is_host(headers):
    k = headers.get("x-host-key", "")
    return bool(k) and secrets.compare_digest(k, HOST_KEY)


def require_host(headers):
    if not is_host(headers):
        raise HttpError(403, "호스트만 할 수 있어요.")


def _no_nan(_c):
    raise ValueError("NaN/Infinity 는 받지 않아요")


def json_body(body):
    try:
        data = json.loads(body.decode("utf-8") or "{}", parse_constant=_no_nan)
    except Exception:
        raise HttpError(400, "잘못된 요청이에요.")
    if not isinstance(data, dict):
        raise HttpError(400, "잘못된 요청이에요.")
    return data


# ============================================================ 프로필 (주소가 바뀌어도 설정·기록 유지)
PROFILE_ID_RE = re.compile(r"^[^\s<>\"'&]{1,16}$")
PIN_RE = re.compile(r"^\d{4,8}$")
PROFILE_FAILS = {}            # 아이디 -> {"n": 틀린 횟수, "until": 잠금 해제 시각, "inflight": 확인 중인 시도}
PROFILE_FAIL_LOCK = threading.Lock()
PROFILE_MAX_BYTES = 128 * 1024
PROFILE_MAX_COUNT = 100
PROFILE_MAX_TOKENS = 20


def load_profiles():
    with FILE_LOCK:
        d = read_json(PROFILES_FILE, {})
    return d if isinstance(d, dict) else {}


def save_profiles(d):
    with FILE_LOCK:
        write_json_atomic(PROFILES_FILE, d)


def pin_hash(pin, salt):
    return hashlib.pbkdf2_hmac("sha256", pin.encode(), bytes.fromhex(salt), 120_000).hex()


def token_hash(tok):
    return hashlib.sha256(tok.encode()).hexdigest()


def _attempt_begin(key):
    """비밀번호 확인 시작: 1분에 5번까지만 (동시에 여러 번 보내도 못 넘게 '확인 중'도 셈)"""
    now = time.time()
    with PROFILE_FAIL_LOCK:
        f = PROFILE_FAILS.setdefault(key, {"n": 0, "until": 0, "inflight": 0})
        if f["until"] > now:
            raise HttpError(429, f"비밀번호를 여러 번 틀렸어요. {int(f['until'] - now) + 1}초 뒤에 다시 해 주세요.")
        if f["n"] + f["inflight"] >= 5:
            raise HttpError(429, "잠시 후 다시 해 주세요.")
        f["inflight"] += 1


def _attempt_end(key, wrong):
    with PROFILE_FAIL_LOCK:
        f = PROFILE_FAILS.get(key)
        if not f:
            return
        f["inflight"] = max(0, f["inflight"] - 1)
        if wrong:
            f["n"] += 1
            if f["n"] >= 5:          # 5번 틀리면 1분 잠금
                f["n"], f["until"] = 0, time.time() + 60
        elif f["inflight"] == 0 and f["until"] <= time.time():
            PROFILE_FAILS.pop(key, None)
        else:
            f["n"] = 0


def profile_find(headers, profiles):
    tok = headers.get("x-profile-token", "")
    if not tok:
        raise HttpError(401, "프로필에 로그인되어 있지 않아요.")
    th = token_hash(tok)
    for key, pr in profiles.items():
        toks = pr.get("tokens", [])
        if th in toks:
            return key, pr, th
    raise HttpError(401, "프로필 로그인이 만료됐어요. 다시 불러와 주세요.")


def _touch_token(pr, th):
    """최근에 쓴 토큰을 맨 뒤로 (오래 안 쓴 토큰부터 밀려나게). 바뀌었으면 True"""
    toks = pr.get("tokens", [])
    if toks and toks[-1] == th:
        return False
    pr["tokens"] = [t for t in toks if t != th] + [th]
    return True


def _best_score(v):
    try:
        return float(json.loads(v).get("score", 0))
    except Exception:
        return -1.0


def profile_login(data):
    pid = str(data.get("id", "")).strip()
    pin = str(data.get("pin", "")).strip()
    create = bool(data.get("create"))
    if not PROFILE_ID_RE.match(pid):
        raise HttpError(400, "아이디는 공백 없이 1~16글자로 정해 주세요.")
    if not PIN_RE.match(pin):
        raise HttpError(400, "비밀번호는 숫자 4~8자리로 정해 주세요.")
    key = pid.lower()
    _attempt_begin(key)
    wrong = False
    try:
        # 파일 잠금은 짧게: 읽기만 하고, 오래 걸리는 해시 계산은 잠금 밖에서
        profiles = load_profiles()
        pr = profiles.get(key)
        if pr is None:
            if not create:
                raise HttpError(404, "그런 아이디가 없어요. 처음이라면 '새 프로필 만들기'를 눌러 주세요.")
            if len(profiles) >= PROFILE_MAX_COUNT:
                raise HttpError(400, "프로필이 너무 많아요. 방장에게 정리를 부탁해 주세요.")
            salt = secrets.token_hex(16)
            ph = pin_hash(pin, salt)
        else:
            if create:
                raise HttpError(409, "이미 있는 아이디예요. 내 프로필이면 '불러오기'를 눌러 주세요.")
            if not secrets.compare_digest(pin_hash(pin, pr["salt"]), pr["pin"]):
                wrong = True
                raise HttpError(403, "비밀번호가 달라요.")
        tok = secrets.token_urlsafe(24)
        now = time.time()
        with FILE_LOCK:
            profiles = load_profiles()
            cur = profiles.get(key)
            if create:
                if cur is not None:
                    raise HttpError(409, "이미 있는 아이디예요. 내 프로필이면 '불러오기'를 눌러 주세요.")
                cur = {"id": pid, "salt": salt, "pin": ph, "data": {}, "tokens": [], "created": now, "updated": 0}
                profiles[key] = cur
            elif cur is None:
                raise HttpError(404, "그런 아이디가 없어요.")
            cur["tokens"] = (cur.get("tokens", []) + [token_hash(tok)])[-PROFILE_MAX_TOKENS:]
            save_profiles(profiles)
    finally:
        _attempt_end(key, wrong)
    log(("프로필 생성:" if create else "프로필 불러오기:"), pid)
    return {"token": tok, "id": cur["id"], "data": cur.get("data", {}), "updated": cur.get("updated", 0), "created": create}


def profile_get(headers):
    with FILE_LOCK:
        profiles = load_profiles()
        _, pr, th = profile_find(headers, profiles)
        if _touch_token(pr, th):
            save_profiles(profiles)
    return {"id": pr["id"], "data": pr.get("data", {}), "updated": pr.get("updated", 0)}


def profile_put(headers, body):
    if len(body) > PROFILE_MAX_BYTES:
        raise HttpError(413, "저장할 내용이 너무 커요.")
    data = json_body(body)
    new = data.get("data")
    if not isinstance(new, dict) or not all(isinstance(k, str) and isinstance(v, str) for k, v in new.items()):
        raise HttpError(400, "잘못된 요청이에요.")
    with FILE_LOCK:
        profiles = load_profiles()
        _, pr, th = profile_find(headers, profiles)
        old = pr.get("data", {}) if isinstance(pr.get("data"), dict) else {}
        merged = dict(old)
        server_wins = {}
        for k, v in new.items():
            # 최고 기록은 덮어쓰지 않고 더 높은 쪽을 남김 (오래된 탭·기기가 새 기록을 지우지 않게)
            if k.startswith("best_") and k in old and _best_score(old[k]) > _best_score(v):
                server_wins[k] = old[k]
                continue
            merged[k] = v
        for k, v in old.items():
            if k.startswith("best_") and k not in new:
                server_wins[k] = v
        if len(json.dumps(merged, ensure_ascii=False).encode()) > PROFILE_MAX_BYTES * 1.5:
            raise HttpError(413, "저장할 내용이 너무 커요.")
        pr["data"] = merged
        pr["updated"] = time.time()
        _touch_token(pr, th)
        save_profiles(profiles)
    return {"ok": True, "updated": pr["updated"], "data": server_wins}


def profile_logout(headers):
    with FILE_LOCK:
        profiles = load_profiles()
        _, pr, th = profile_find(headers, profiles)
        pr["tokens"] = [t for t in pr.get("tokens", []) if t != th]
        save_profiles(profiles)
    return {"ok": True}


async def api(method, path, headers, body):
    parts = [unquote(p) for p in path.split("/") if p][1:]  # 'api' 제거
    loop = asyncio.get_running_loop()

    if parts == ["whoami"]:
        host = is_host(headers)
        out = {"host": host, "cloud": CLOUD}
        if host and CLOUD:
            out["worker"] = worker_status()
        return out

    if parts == ["health"]:
        # 자동 업데이트가 '지금 다시 켜도 되는지' 확인 (방에 사람이 있으면 미룸)
        busy = any(r.players for r in ROOMS.values())
        return {"ok": True, "busy": busy, "clients": len(CLIENTS), "cloud": CLOUD}

    if parts == ["avatar", "ai", "choose"] and method == "POST":
        if not CLOUD:
            raise HttpError(400, "클라우드 서버에서만 쓰는 기능이에요.")
        return av_choose(headers, json_body(body) if body else {})
    if parts == ["avatar", "ai"]:
        if not CLOUD:
            raise HttpError(400, "클라우드 서버에서만 쓰는 기능이에요.")
        if method == "POST":
            return av_request(headers, json_body(body) if body else {})
        if method == "GET":
            return av_status(headers)

    if parts and parts[0] == "worker":
        require_host(headers)
        if not CLOUD:
            raise HttpError(400, "클라우드 서버에서만 쓰는 기능이에요.")
        data = json_body(body) if body else {}
        WORKER["seen"] = time.time()
        WORKER["version"] = str(data.get("version", ""))[:20]
        if "ai" in data:
            WORKER["ai"] = bool(data.get("ai"))
        if "avatar" in data:
            WORKER["avatar"] = bool(data.get("avatar"))
        if parts == ["worker", "poll"] and method == "POST":
            j = claim_job()
            if not j and data.get("avatar"):         # 곡 작업이 없을 때만 캐릭터 그림 (그림 도구가 있는 엔진만)
                a = av_claim()
                if a:
                    return {"job": {"id": a["id"], "kind": "avatar", "avatar": a["avatar"], "title": f"캐릭터: {a['name']}",
                                    "desc": a.get("desc", ""), "strength": a.get("strength", "mid"),
                                    "useLook": a.get("useLook", True), "ref": av_ref_b64(a),
                                    "refExt": (a.get("ref") or ".jpg").rsplit(".", 1)[-1], "mode": a.get("mode", "all"),
                                    "illust": av_cur_illust(a) if a.get("mode") == "pixel" else None}}
            return {"job": {"id": j["id"], "vid": j["vid"], "title": j["title"], "keepEdited": j["keepEdited"],
                            "keepTitle": j["keepTitle"], "aiOnly": bool(j.get("aiOnly"))} if j else None}
        aj = AVJOBS.get(str(data.get("jobId", "")))
        if aj:
            if parts == ["worker", "progress"] and method == "POST":
                if aj["stage"] in AV_PENDING:
                    aj.update(stage="working", msg=str(data.get("msg", ""))[:200], claimedAt=time.time())
                    notify_all({"type": "avjobs"})
                return {"ok": aj["stage"] in AV_PENDING}
            if parts == ["worker", "fail"] and method == "POST":
                if aj["stage"] in AV_PENDING:
                    aj.update(stage="error", msg=str(data.get("msg", "실패"))[:300], finished=time.time())
                    av_drop_ref(aj)
                    save_avqueue()
                    notify_all({"type": "avjobs"})
                    log("AI 캐릭터 실패:", aj["name"], aj["msg"])
                return {"ok": True}
            if parts == ["worker", "done"] and method == "POST":
                if aj["stage"] not in AV_PENDING:
                    return {"ok": False, "msg": "취소됐거나 없는 작업이에요."}
                await loop.run_in_executor(EXECUTOR, av_finish, aj, data.get("images"))
                return {"ok": aj["stage"] == "done", "msg": aj["msg"]}
        j = JOBS.get(str(data.get("jobId", "")))
        if parts == ["worker", "progress"] and method == "POST":
            if j and j.get("pc") and j["stage"] in PENDING:
                stage = str(data.get("stage", ""))
                j.update(stage=stage if stage in PENDING else j["stage"], msg=("PC: " + str(data.get("msg", "")))[:200],
                         claimedAt=time.time())
                notify_all({"type": "jobs"})
            return {"ok": bool(j and j["stage"] in PENDING)}     # False면 취소된 작업 → 엔진이 멈춤
        if parts == ["worker", "fail"] and method == "POST":
            if j and j.get("pc") and j["stage"] in PENDING:
                j.update(stage="error", msg=str(data.get("msg", "실패"))[:400], finished=time.time())
                jobs_changed()
                log("PC 채보 실패:", j["title"], j["msg"])
            return {"ok": True}
        if parts == ["worker", "done"] and method == "POST":
            if not j or not j.get("pc") or j["stage"] not in PENDING:
                return {"ok": False, "msg": "취소됐거나 없는 작업이에요."}
            if j.get("aiOnly"):
                j.update(stage="upload", msg="AI 채보 저장하는 중...")
                notify_all({"type": "jobs"})
                await loop.run_in_executor(EXECUTOR, finish_ai_job, j, data.get("ai"))
                return {"ok": j["stage"] == "done", "msg": j["msg"]}
            try:
                res = clean_result(data.get("res"))
            except (KeyError, TypeError, ValueError) as e:
                j.update(stage="error", msg=f"분석 결과가 잘못됐어요: {e}"[:300], finished=time.time())
                jobs_changed()
                raise HttpError(400, str(e))
            meta = clean_meta(data.get("meta"), j["vid"])
            j.update(stage="upload", msg="저장하는 중...")
            notify_all({"type": "jobs"})
            await loop.run_in_executor(EXECUTOR, finish_pc_job, j, meta, res)
            return {"ok": j["stage"] == "done", "msg": j["msg"]}
        raise HttpError(404, "없는 주소예요.")

    if parts == ["ai", "batch"] and method == "POST":
        # 예전 곡들도 AI 채보 만들기: AI 채보가 없는 곡을 대기열에 (all=true면 전부 다시)
        require_host(headers)
        if not CLOUD:
            raise HttpError(400, "클라우드 서버에서만 쓰는 기능이에요.")
        data = json_body(body) if body else {}
        n = 0
        ids = data.get("ids")
        if isinstance(ids, list):      # 고른 곡만 (곡 화면의 ✦ AI 버튼) — 이미 있어도 새로 만듦
            for vid in ids[:200]:
                song = load_song(str(vid)) if VID_RE.match(str(vid)) else None
                if song:
                    enqueue_pc(song["id"], title=song.get("title", song["id"]), ai_only=True)
                    n += 1
            return {"ok": True, "queued": n, "aiReady": WORKER["ai"], "online": worker_online()}
        for p in sorted(SONGS.glob("*.json"), key=lambda p: p.stat().st_mtime):
            song = load_song(p.stem) if VID_RE.match(p.stem) else None
            ai = song.get("ai") if song else None
            if not song or (ai and not data.get("all") and not (data.get("old") and ai.get("gen", 1) < 2)):
                continue
            enqueue_pc(song["id"], title=song.get("title", song["id"]), batch=True, ai_only=True)
            n += 1
        return {"ok": True, "queued": n, "aiReady": WORKER["ai"], "online": worker_online()}

    if parts == ["jobs"] and method == "GET":
        require_host(headers)
        return {"jobs": recent_jobs(), "worker": worker_status() if CLOUD else None, "cloud": CLOUD}
    if len(parts) == 3 and parts[0] == "jobs" and parts[2] == "retry" and method == "POST":
        # 실패한 작업만 다시 (AI 작업이면 AI 채보만, 아니면 기존 채보)
        require_host(headers)
        j = JOBS.get(parts[1])
        if not j or not j.get("pc"):
            raise HttpError(404, "작업을 찾을 수 없어요.")
        if j.get("aiOnly"):
            if not load_song(j["vid"]):
                raise HttpError(404, "곡이 없어요.")
            nj = enqueue_pc(j["vid"], title=j.get("title", ""), ai_only=True)
        else:
            nj = enqueue_pc(j["vid"], j.get("keepEdited", False), j.get("keepTitle", False), j.get("title", ""), j.get("by", ""))
        if nj is not j:
            JOBS.pop(j["id"], None)    # 실패한 줄은 새 작업으로 바꿔치기
            jobs_changed()
        return {"ok": True, "jobId": nj["id"]}
    if len(parts) == 2 and parts[0] == "jobs" and method == "DELETE":
        require_host(headers)
        j = JOBS.get(parts[1])
        if j and j.get("pc") and j["stage"] in PENDING:
            j.update(stage="canceled", msg="취소됨", finished=time.time())
            with FILE_LOCK:      # 승인했던 신청은 다시 '대기'로
                reqs = load_requests()
                for r in reqs:
                    if r.get("vid") == j["vid"]:
                        r.pop("state", None)
                save_requests(reqs)
            jobs_changed()
            notify_all({"type": "requests"})
        return {"ok": True}

    if parts == ["admin", "import"] and method == "POST":
        require_host(headers)
        data = json_body(body)
        return await loop.run_in_executor(None, import_item, data)

    if parts == ["songs"]:
        if method == "GET":
            return {"songs": list_songs()}
        if method == "POST":
            require_host(headers)
            data = json_body(body)
            vid = parse_video_id(data.get("url", ""))
            if not vid:
                raise HttpError(400, "유튜브 링크를 인식하지 못했어요.")
            if not data.get("regenerate") and song_path(vid).exists():
                return {"exists": True, "songId": vid}
            if CLOUD:
                old = load_song(vid)
                title = old.get("title") if old else ""
                if not title:
                    title, _ = await loop.run_in_executor(None, fetch_title, vid)
                j = enqueue_pc(vid, title=title or vid, by="호스트")
                return {"jobId": j["id"], "queued": True, "title": j["title"]}
            for j in list(JOBS.values()):
                if j["vid"] == vid and j["stage"] not in ("done", "error"):
                    return {"jobId": j["id"]}
            jid = secrets.token_hex(6)
            JOBS[jid] = {"id": jid, "vid": vid, "stage": "queued", "msg": "대기 중...", "songId": None,
                         "created": time.time()}
            loop.run_in_executor(EXECUTOR, run_job, jid, vid)
            log("채보 생성 요청:", vid)
            return {"jobId": jid}

    if parts == ["batch"]:
        if method == "GET":
            return batch_state()
        require_host(headers)
        if method == "POST":
            data = json_body(body)
            with BATCH_LOCK:
                if BATCH["running"]:
                    raise HttpError(409, "이미 전체 다시 만들기가 진행 중이에요.")
                ids = [s["id"] for s in list_songs()]
                if not ids:
                    raise HttpError(400, "다시 만들 곡이 없어요.")
                ids.reverse()   # 오래된 곡부터
                BATCH.update(running=True, total=len(ids), done=0, ok=0, failed=[], current="", cancel=False,
                             keepEdited=bool(data.get("keepEdited", True)), started=time.time(), finished=0)
            threading.Thread(target=run_batch_cloud if CLOUD else run_batch, args=(ids, BATCH["keepEdited"]), daemon=True).start()
            log(f"전체 다시 만들기 시작: {len(ids)}곡")
            batch_notify()
            return batch_state()
        if method == "DELETE":
            if BATCH["running"]:
                BATCH["cancel"] = True
                batch_notify()
            return batch_state()

    if parts == ["requests"]:
        if method == "GET":
            return {"requests": load_requests()}
        if method == "POST":
            data = json_body(body)
            vid = parse_video_id(data.get("url", ""))
            if not vid:
                raise HttpError(400, "유튜브 링크를 인식하지 못했어요.")
            if song_path(vid).exists():
                raise HttpError(400, "이미 곡 목록에 있는 곡이에요.")
            reqs = load_requests()
            if any(r["vid"] == vid for r in reqs):
                raise HttpError(400, "이미 신청된 곡이에요.")
            if len(reqs) >= 50:
                raise HttpError(400, "신청함이 꽉 찼어요. 호스트가 정리할 때까지 기다려 주세요.")
            if not is_host(headers) and not request_rate_ok(headers.get("x-lb-ip", "")):
                raise HttpError(429, "곡 신청은 10분에 5곡까지예요. 잠시 후 다시 신청해 주세요.")
            title, channel = await loop.run_in_executor(None, fetch_title, vid)
            req = {"id": secrets.token_hex(5), "vid": vid, "title": title or vid, "channel": channel,
                   "by": str(data.get("name", "")).strip()[:16] or "이름없음", "at": time.time()}
            with FILE_LOCK:
                reqs = load_requests()
                if any(r.get("vid") == vid for r in reqs):
                    raise HttpError(400, "이미 신청된 곡이에요.")
                reqs.append(req)
                save_requests(reqs)
            log("곡 신청:", req["by"], req["title"])
            notify_all({"type": "requests", "new": req})
            return req
    if len(parts) == 3 and parts[0] == "requests" and parts[2] == "approve" and method == "POST":
        # 클라우드: 승인한 신청만 PC 채보 엔진 대기열로 (신청이 저절로 곡이 되지 않음)
        require_host(headers)
        if not CLOUD:
            raise HttpError(400, "클라우드 서버에서만 쓰는 기능이에요.")
        with FILE_LOCK:
            reqs = load_requests()
            r = next((x for x in reqs if x.get("id") == parts[1]), None)
            if not r:
                raise HttpError(404, "신청을 찾을 수 없어요.")
            r["state"] = "queued"
            save_requests(reqs)
        j = enqueue_pc(r["vid"], title=r.get("title") or r["vid"], by=r.get("by", ""))
        notify_all({"type": "requests"})
        return {"jobId": j["id"], "queued": True}
    if len(parts) == 2 and parts[0] == "requests" and method == "DELETE":
        require_host(headers)
        with FILE_LOCK:
            left = [r for r in load_requests() if r.get("id") != parts[1]]
            save_requests(left)
        notify_all({"type": "requests"})
        return {"ok": True}

    if parts == ["profile", "login"] and method == "POST":
        data = json_body(body)
        return await loop.run_in_executor(None, profile_login, data)
    if parts == ["profile"] and method == "GET":
        return await loop.run_in_executor(None, profile_get, headers)
    if parts == ["profile"] and method == "PUT":
        return await loop.run_in_executor(None, profile_put, headers, body)
    if parts == ["profile", "logout"] and method == "POST":
        return await loop.run_in_executor(None, profile_logout, headers)
    if parts == ["scores"] and method == "POST":
        return submit_score(json_body(body))
    if len(parts) == 2 and parts[0] == "scores" and method == "GET":
        if not VID_RE.match(parts[1]):
            raise HttpError(400, "잘못된 곡 ID")
        return load_scores(parts[1])

    if len(parts) == 2 and parts[0] == "jobs":
        j = JOBS.get(parts[1])
        if not j:
            raise HttpError(404, "작업을 찾을 수 없어요.")
        return {k: j[k] for k in ("id", "stage", "msg", "songId")}

    if len(parts) >= 2 and parts[0] == "songs":
        sid = parts[1]
        if not VID_RE.match(sid):
            raise HttpError(400, "잘못된 곡 ID")
        song = load_song(sid)
        if song is None:
            raise HttpError(404, "곡이 없어요.")
        if len(parts) == 3 and parts[2] == "dens" and method == "GET":
            return song_dens(song)
        if len(parts) == 2:
            if method == "GET":
                song["_hl"] = song_hl(song)   # 하이라이트 모드 구간 (파일에는 저장 안 함)
                if isinstance(song.get("ai"), dict) and "raw" in song["ai"]:
                    song["ai"] = {k: v for k, v in song["ai"].items() if k != "raw"}   # AI 원본은 서버에만 (다시 다듬을 때 씀)
                song.pop("onsets", None)      # 소리 위치도 서버에서만 씀
                if song.get("aiOff") and isinstance(song.get("ai"), dict):   # 호스트가 '모두 기존 채보로' 정한 곡
                    song["ai"] = dict(song["ai"], fit=dict(song["ai"].get("fit") or {}, rec=False))
                return song
            if method == "DELETE":
                require_host(headers)
                song_path(sid).unlink(missing_ok=True)
                scores_path(sid).unlink(missing_ok=True)
                notify_all({"type": "songs"})
                log("곡 삭제:", song.get("title"))
                return {"ok": True}
            if method == "PATCH":
                require_host(headers)
                data = json_body(body)
                if "bpm" in data or "offset" in data:
                    song.pop("beats", None)   # 박자를 직접 고쳤으면 자동 분석한 박 위치는 버림
                try:
                    bpm = float(data["bpm"]) if "bpm" in data else None
                    off = float(data["offset"]) if "offset" in data else None
                except (TypeError, ValueError):
                    raise HttpError(400, "BPM/첫 박 값이 숫자가 아니에요.")
                if (bpm is not None and not math.isfinite(bpm)) or (off is not None and not math.isfinite(off)):
                    raise HttpError(400, "BPM/첫 박 값이 올바르지 않아요.")
                if bpm is not None:
                    song["bpm"] = max(30.0, min(400.0, bpm))
                if off is not None:
                    song["offset"] = round(max(-30.0, min(30.0, off)), 3)
                if "title" in data and str(data["title"]).strip():
                    song["title"] = str(data["title"]).strip()[:200]
                if "aiOff" in data:          # 이 곡은 모두 기존 채보가 기본 (AI가 안 맞는 곡) — 칩으로 각자 켤 수는 있음
                    if data["aiOff"]:
                        song["aiOff"] = True
                    else:
                        song.pop("aiOff", None)
                if "noteShift" in data:      # 이 곡 노트 전체 타이밍 (ms, +면 늦게) — 호스트가 곡마다 미세 조정
                    try:
                        song["noteShift"] = int(max(-150, min(150, round(float(data["noteShift"])))))
                    except (TypeError, ValueError):
                        raise HttpError(400, "노트 타이밍 값이 올바르지 않아요.")
                need_reguess = False
                if "artist" in data:
                    a = str(data["artist"] or "").strip()[:80]
                    if a:
                        song["artist"], song["artistSrc"], song["artistAt"] = a, "manual", time.time()
                        learn_from_manual(song, a)
                        need_reguess = True
                    else:   # 비우면 자동으로 되돌림
                        known, order = artist_knowledge()
                        song["artist"], song["artistSrc"] = artistlib.guess(None, song.get("title", ""), song.get("channel", ""),
                                                                            known=known, chan_order=order)
                save_song(song)
                if need_reguess:   # 저장한 다음에, 배운 걸로 다른 곡들도 다시 판단
                    loop.run_in_executor(None, reguess_all)
                return song_summary(song)
        if len(parts) == 3 and parts[2] == "ai" and method in ("PUT", "DELETE"):
            # AI 채보: 기본 채보와 따로 저장 (지우면 원래대로). 호스트 PC의 AI 채보 도구가 보냄
            require_host(headers)
            if method == "PUT":
                return await loop.run_in_executor(EXECUTOR, save_ai, sid, json_body(body))
            if method == "DELETE":
                had = song.pop("ai", None) is not None
                if had:
                    save_song(song)
                    notify_all({"type": "songs"})
                    log("AI 채보 삭제:", song.get("title"))
                return {"ok": True, "removed": had}
        if len(parts) == 4 and parts[2] == "charts" and method == "PUT":
            require_host(headers)
            diff = parts[3]
            if diff not in chartgen.DIFFS:
                raise HttpError(400, "잘못된 난이도")
            data = json_body(body)
            keys = 6 if data.get("keys") in (6, "6") else 4
            ck = charts_key(keys)
            try:
                song.setdefault(ck, {})[diff] = validate_notes(data.get("notes"), keys)
            except (KeyError, TypeError, ValueError) as e:
                raise HttpError(400, str(e) or "노트 형식이 잘못됐어요.")
            song.setdefault("edited", {})[diff if keys == 4 else f"6-{diff}"] = time.time()
            save_song(song)
            log("채보 저장:", song.get("title"), f"{keys}키", diff, len(song[ck][diff]))
            return {"ok": True, "count": len(song[ck][diff]), "stars": chartgen.star_rating(song[ck][diff], keys)}

    raise HttpError(404, "없는 주소예요.")


def serve_static(path):
    rel = "index.html" if path in ("/", "") else path.lstrip("/")
    if rel.startswith("static/"):
        rel = rel[len("static/"):]
    target = (STATIC / rel).resolve()
    if STATIC not in target.parents and target != STATIC:
        raise HttpError(404, "Not found")
    if not target.is_file():
        raise HttpError(404, "Not found")
    ctype = mimetypes.guess_type(str(target))[0] or "application/octet-stream"
    if ctype.startswith("text/") or ctype in ("application/javascript",):
        ctype += "; charset=utf-8"
    if target.suffix == ".js":
        ctype = "text/javascript; charset=utf-8"
    return ctype, target.read_bytes()


async def write_response(writer, status, ctype, data, extra=None):
    head = [f"HTTP/1.1 {status} {STATUS_TEXT.get(status, 'OK')}",
            f"Content-Type: {ctype}", f"Content-Length: {len(data)}",
            *([] if "Cache-Control" in (extra or {}) else ["Cache-Control: no-cache"]), "Connection: close",
            "X-Content-Type-Options: nosniff"]
    for k, v in (extra or {}).items():
        head.append(f"{k}: {v}")
    writer.write(("\r\n".join(head) + "\r\n\r\n").encode("latin-1") + data)
    await writer.drain()


async def handle_conn(reader, writer):
    try:
        line = await asyncio.wait_for(reader.readline(), 20)
        if not line:
            return
        try:
            method, target, _ = line.decode("latin-1").split(" ", 2)
        except ValueError:
            return
        headers = {}
        for _ in range(100):
            h = await asyncio.wait_for(reader.readline(), 20)
            if h in (b"\r\n", b"\n", b""):
                break
            k, _, v = h.decode("latin-1").partition(":")
            headers[k.strip().lower()] = v.strip()
        else:
            await write_response(writer, 400, "text/plain", b"too many headers")
            return
        path = target.split("?", 1)[0]
        # 접속한 곳(IP): 이 컴퓨터의 Caddy를 거쳐 왔으면 Caddy가 붙여 준 값, 아니면 직접 연결한 주소
        peer = (writer.get_extra_info("peername") or ("",))[0]
        fwd = headers.pop("x-forwarded-for", "")
        headers.pop("x-lb-ip", None)
        headers["x-lb-ip"] = fwd.split(",")[-1].strip() if fwd and peer in ("127.0.0.1", "::1") else peer

        if path == "/ws" and headers.get("upgrade", "").lower() == "websocket":
            await ws_session(reader, writer, headers)
            return

        try:
            length = int(headers.get("content-length", "0") or 0)
        except ValueError:
            length = -1
        if length < 0:
            await write_response(writer, 400, "text/plain", b"bad content-length")
            return
        if length > 4_000_000:
            await write_response(writer, 413, "text/plain", b"too large")
            return
        body = await asyncio.wait_for(reader.readexactly(length), 30) if length else b""

        try:
            if path.startswith("/api/"):
                res = await api(method, path, headers, body)
                await write_response(writer, 200, "application/json; charset=utf-8",
                                     json.dumps(res, ensure_ascii=False).encode("utf-8"))
            elif method in ("GET", "HEAD") and path.startswith("/avatars/"):
                r = serve_avatar(path)
                if not r:
                    raise HttpError(404, "Not found")
                await write_response(writer, 200, r[0], r[1], {"Cache-Control": "public, max-age=31536000, immutable"})
            elif method in ("GET", "HEAD"):
                ctype, data = serve_static(path)
                await write_response(writer, 200, ctype, data)
            else:
                raise HttpError(405, "Method not allowed")
        except HttpError as e:
            await write_response(writer, e.status, "application/json; charset=utf-8",
                                 json.dumps({"error": e.msg}, ensure_ascii=False).encode("utf-8"))
        except Exception as e:
            traceback.print_exc()
            await write_response(writer, 500, "application/json; charset=utf-8",
                                 json.dumps({"error": "서버 오류: " + str(e)[:200]}, ensure_ascii=False).encode("utf-8"))
    except (asyncio.TimeoutError, asyncio.IncompleteReadError, ConnectionError, ValueError):
        pass
    finally:
        try:
            writer.close()
        except Exception:
            pass


# ============================================================ WebSocket
WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"


def _unmask(data, key):
    n = len(data)
    if n == 0:
        return data
    k = (key * (n // 4 + 1))[:n]
    return (int.from_bytes(data, "little") ^ int.from_bytes(k, "little")).to_bytes(n, "little")


def ws_frame(payload: bytes, opcode=1):
    n = len(payload)
    head = bytes([0x80 | opcode])
    if n < 126:
        head += bytes([n])
    elif n < 65536:
        head += bytes([126]) + n.to_bytes(2, "big")
    else:
        head += bytes([127]) + n.to_bytes(8, "big")
    return head + payload


class Client:
    _ids = 0

    def __init__(self, writer):
        Client._ids += 1
        self.id = Client._ids
        self.writer = writer
        self.name = f"플레이어{self.id}"
        self.room = None
        self.state = "idle"     # idle | loading | loaded | playing | done
        self.result = None
        self.live = {"score": 0, "combo": 0, "acc": 100.0}
        self.avatar = None
        self.title = ""         # 업적 칭호 (이름 옆에 표시)
        self.diff = "normal"    # 멀티에서 각자 고르는 난이도/키
        self.keys = 4
        self.pending = None     # 게임 중에 바꾼 난이도/키 (판이 끝나면 적용)
        self.last_seen = time.time()
        self.closed = False

    def send(self, obj):
        if self.closed:
            return
        try:
            tr = self.writer.transport
            if tr.is_closing() or tr.get_write_buffer_size() > 2_000_000:
                self.closed = True
                tr.close()
                return
            self.writer.write(ws_frame(json.dumps(obj, ensure_ascii=False).encode("utf-8")))
        except Exception:
            self.closed = True


async def ws_session(reader, writer, headers):
    key = headers.get("sec-websocket-key", "")
    accept = base64.b64encode(hashlib.sha1((key + WS_GUID).encode()).digest()).decode()
    writer.write(("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                  f"Sec-WebSocket-Accept: {accept}\r\n\r\n").encode())
    await writer.drain()
    client = Client(writer)
    CLIENTS[client.id] = client
    client.send({"type": "welcome", "id": client.id})
    buf = b""
    msg_op = None
    try:
        while True:
            h = await asyncio.wait_for(reader.readexactly(2), 60)
            fin = h[0] & 0x80
            op = h[0] & 0x0F
            masked = h[1] & 0x80
            n = h[1] & 0x7F
            if n == 126:
                n = int.from_bytes(await reader.readexactly(2), "big")
            elif n == 127:
                n = int.from_bytes(await reader.readexactly(8), "big")
            if n > 1_000_000:
                break
            mkey = await reader.readexactly(4) if masked else b""
            payload = await reader.readexactly(n) if n else b""
            if masked:
                payload = _unmask(payload, mkey)
            if op == 8:  # close
                try:
                    writer.write(ws_frame(b"", 8))
                except Exception:
                    pass
                break
            if op == 9:  # ping
                writer.write(ws_frame(payload, 10))
                client.last_seen = time.time()
                continue
            client.last_seen = time.time()
            if op == 10:
                continue
            if op in (1, 2):
                buf, msg_op = payload, op
            elif op == 0:
                buf += payload
                if len(buf) > 1_000_000:
                    break
            if fin and msg_op == 1:
                client.last_seen = time.time()
                try:
                    msg = json.loads(buf.decode("utf-8"), parse_constant=_no_nan)
                    if isinstance(msg, dict):
                        handle_msg(client, msg)
                except Exception:
                    traceback.print_exc()
                buf = b""
    except (asyncio.TimeoutError, asyncio.IncompleteReadError, ConnectionError):
        pass
    finally:
        client.closed = True
        CLIENTS.pop(client.id, None)
        leave_room(client)
        try:
            writer.close()
        except Exception:
            pass


# ============================================================ 멀티플레이 방
CLIENTS = {}
ROOMS = {}


class Room:
    def __init__(self, code, leader):
        self.code = code
        self.leader = leader.id
        self.players = {}           # id -> Client
        self.song_id = None
        self.song_title = ""
        self.diff = "normal"
        self.keys = 4
        self.hl = False             # 하이라이트 모드 (방장이 켜면 모두 후렴 구간만)
        self.cur_hl = False         # 지금 진행 중인 판이 하이라이트 모드인지
        self.ai = True              # AI 채보 사용 (곡에 있으면). 방장이 끄면 모두 기존 채보
        self.phase = "lobby"        # lobby | preparing | playing
        self.game_no = 0
        self.timer = None

    def state(self):
        return {
            "type": "room", "code": self.code, "leader": self.leader, "phase": self.phase,
            "songId": self.song_id, "songTitle": self.song_title, "diff": self.diff, "keys": self.keys, "hl": self.hl, "ai": self.ai,
            "players": [{"id": c.id, "name": c.name, "state": c.state, "avatar": c.avatar, "title": c.title,
                         "diff": c.diff, "keys": c.keys} for c in self.players.values()],
        }

    def roster(self):
        return [{"id": c.id, "name": c.name, "avatar": c.avatar, "title": c.title, "diff": c.diff, "keys": c.keys}
                for c in self.players.values()]

    def broadcast(self, obj, exclude=None):
        for c in list(self.players.values()):
            if c is not exclude:
                c.send(obj)

    def push(self):
        self.broadcast(self.state())


def new_code():
    while True:
        code = "".join(random.choice("ABCDEFGHJKLMNPQRSTUVWXYZ") for _ in range(4))
        if code not in ROOMS:
            return code


def leave_room(client):
    room = client.room
    if not room:
        return
    room.players.pop(client.id, None)
    client.room = None
    client.state = "idle"
    if client.pending:   # 게임 중에 바꿔 둔 난이도/키는 방을 나가면 바로 적용
        client.diff, client.keys = client.pending
        client.pending = None
    if not room.players:
        if room.timer:
            room.timer.cancel()
        ROOMS.pop(room.code, None)
        log(f"방 {room.code} 닫힘")
        return
    if room.leader == client.id:
        room.leader = next(iter(room.players))
    room.broadcast({"type": "chat", "system": True, "text": f"{client.name} 님이 나갔어요."})
    room.push()
    check_progress(room)


def check_progress(room):
    """준비 완료/게임 종료 확인."""
    if room.phase == "preparing":
        if all(c.state in ("loaded", "error") for c in room.players.values()):
            start_game(room)
    elif room.phase == "playing":
        if all(c.state in ("done", "error") for c in room.players.values()):
            finish_game(room)


def start_game(room):
    if room.phase != "preparing":
        return
    if room.timer:
        room.timer.cancel()
    room.phase = "playing"
    for c in room.players.values():
        if c.state == "loaded":
            c.state = "playing"
    at = int(time.time() * 1000) + 3500
    room.broadcast({"type": "start", "at": at, "game": room.game_no})
    room.push()
    song = load_song(room.song_id) or {}
    limit = float(song.get("duration", 600)) + 60
    loop = asyncio.get_running_loop()
    g = room.game_no
    room.timer = loop.call_later(limit, lambda: room.game_no == g and room.phase == "playing" and finish_game(room))
    check_progress(room)   # 모두 로딩 실패했으면 바로 끝냄


def finish_game(room):
    if room.phase != "playing":
        return
    if room.timer:
        room.timer.cancel()
        room.timer = None
    room.phase = "lobby"
    results = []
    for c in room.players.values():
        r = c.result or {"score": c.live.get("score", 0),
                         "acc": 0 if c.state == "error" else c.live.get("acc", 0),
                         "maxCombo": 0, "incomplete": True}
        results.append(dict(r, id=c.id, name=c.name, avatar=c.avatar, title=c.title, diff=c.diff, keys=c.keys))
        c.state = "idle"
        c.result = None
    for c in room.players.values():   # 게임 중에 바꿔 둔 난이도/키 적용 (결과는 플레이한 난이도로 표시)
        if c.pending:
            c.diff, c.keys = c.pending
            c.pending = None
    results.sort(key=lambda r: -r.get("score", 0))
    room.broadcast({"type": "results", "results": results, "songTitle": room.song_title, "diff": room.diff, "keys": room.keys,
                    "hl": room.cur_hl})
    room.push()


def set_my_diff(c, m):
    """메시지의 diff/keys 로 내 난이도를 바꿈. 바뀌었으면 True.
    방이 게임 중이면 바로 바꾸지 않고 기억해 뒀다가 판이 끝나면 적용(다음 판부터)."""
    diff = m.get("diff") if isinstance(m.get("diff"), str) and m.get("diff") in chartgen.DIFFS else None
    keys = m.get("keys") if m.get("keys") in (4, 6) and not isinstance(m.get("keys"), bool) else None
    if diff is None and keys is None:
        return False
    if c.room and c.room.phase != "lobby":
        c.pending = (diff or (c.pending or (c.diff, c.keys))[0], keys or (c.pending or (c.diff, c.keys))[1])
        return False
    changed = False
    if diff and diff != c.diff:
        c.diff = diff
        changed = True
    if keys and keys != c.keys:
        c.keys = keys
        changed = True
    return changed


def handle_msg(c, m):
    t = m.get("type")
    room = c.room

    if t == "ping":
        c.send({"type": "pong", "c": m.get("c"), "s": time.time() * 1000})
        return
    if t == "hello":
        name = str(m.get("name", "")).strip()[:16]
        if name:
            c.name = name
        av = m.get("avatar")
        if isinstance(av, dict):   # 캐릭터: 짧은 값만 받아서 저장 (화면에서 다시 검사함)
            c.avatar = {str(k)[:12]: (v if isinstance(v, int) and 0 <= v < 100 else str(v)[:12])
                        for k, v in list(av.items())[:12] if isinstance(v, (int, str))}
        if "title" in m:
            c.title = str(m.get("title") or "").strip()[:16]
        set_my_diff(c, m)
        if room:
            room.push()
        return
    if t == "mydiff":
        # 게임 중이면 기억해 뒀다가 판이 끝날 때 적용
        if set_my_diff(c, m) and room:
            room.push()
        return
    if t == "create":
        leave_room(c)
        r = Room(new_code(), c)
        ROOMS[r.code] = r
        r.players[c.id] = c
        c.room = r
        log(f"방 {r.code} 생성 ({c.name})")
        r.push()
        return
    if t == "join":
        code = str(m.get("code", "")).strip().upper()
        r = ROOMS.get(code)
        if not r:
            c.send({"type": "error", "msg": "그런 방이 없어요."})
            return
        if r.phase != "lobby":
            c.send({"type": "error", "msg": "게임이 진행 중이에요. 끝나면 다시 들어와 주세요."})
            return
        if len(r.players) >= 8:
            c.send({"type": "error", "msg": "방이 꽉 찼어요 (최대 8명)."})
            return
        if c.room is r:
            r.push()
            return
        leave_room(c)
        r.players[c.id] = c
        c.room = r
        r.broadcast({"type": "chat", "system": True, "text": f"{c.name} 님이 들어왔어요."})
        r.push()
        return
    if t == "leave":
        leave_room(c)
        c.send({"type": "left"})
        return
    if t == "chat" and room:
        text = str(m.get("text", "")).strip()[:200]
        if text:
            room.broadcast({"type": "chat", "name": c.name, "text": text})
        return
    if not room:
        return

    if t == "select" and room.leader == c.id and room.phase == "lobby":
        set_my_diff(c, m)
        sid = str(m.get("songId", ""))
        song = load_song(sid) if VID_RE.match(sid) else None
        if not song:
            c.send({"type": "error", "msg": "곡을 찾을 수 없어요."})
            return
        room.song_id = sid
        room.song_title = song.get("title", sid)
        if isinstance(m.get("diff"), str) and m["diff"] in chartgen.DIFFS:
            room.diff = m["diff"]
        if m.get("keys") in (4, 6):
            room.keys = m["keys"]
        if "ai" in m:                      # 방장이 그 곡에서 고른 AI 채보 사용 여부 (곡마다)
            room.ai = bool(m.get("ai"))
        room.push()
        return
    if t == "aimode" and room.leader == c.id and room.phase == "lobby":
        room.ai = bool(m.get("on"))
        room.push()
        return
    if t == "hlmode" and room.leader == c.id and room.phase == "lobby":
        room.hl = bool(m.get("on"))
        room.push()
        return
    if t == "start" and room.leader == c.id and room.phase == "lobby":
        if not room.song_id:
            c.send({"type": "error", "msg": "먼저 곡을 골라 주세요."})
            return
        hl_range = None
        if room.hl:
            song = load_song(room.song_id)
            hl_range = song_hl(song) if song else None
            if not hl_range:
                c.send({"type": "error", "msg": "이 곡은 하이라이트 구간을 찾지 못했어요. 하이라이트 모드를 끄고 시작해 주세요."})
                return
        room.phase = "preparing"
        room.cur_hl = bool(hl_range)
        room.game_no += 1
        for p in room.players.values():
            p.state = "loading"
            p.result = None
            p.live = {"score": 0, "combo": 0, "acc": 100.0}
        roster = room.roster()
        for p in room.players.values():   # 난이도/키는 사람마다 달라서 각자에게 보냄
            p.send({"type": "prepare", "songId": room.song_id, "diff": p.diff, "keys": p.keys,
                    "game": room.game_no, "players": roster, "hl": hl_range, "ai": room.ai})
        room.push()
        loop = asyncio.get_running_loop()
        g = room.game_no
        room.timer = loop.call_later(25, lambda: room.game_no == g and start_game(room))
        return
    if t == "loaded" and room.phase == "preparing":
        c.state = "loaded" if not m.get("error") else "error"
        room.push()
        check_progress(room)
        return
    if t == "loaded" and m.get("error") and room.phase == "playing":
        # 25초가 지나 먼저 시작된 뒤 로딩에 실패한 경우
        c.state = "error"
        room.push()
        check_progress(room)
        return
    if t == "progress" and room.phase == "playing":
        try:
            c.live = {"score": int(m.get("score", 0)), "combo": int(m.get("combo", 0)),
                      "acc": float(m.get("acc", 0))}
            out = {"type": "progress", "id": c.id, **c.live}
            # 관전 화면용: 곡 위치, 누르고 있는 레인, 최근 판정, 레인 배치(미러/랜덤), 피버, 일시정지
            if isinstance(m.get("t"), (int, float)):
                out["t"] = round(float(m["t"]), 3)
            out["p"] = int(m.get("p", 0)) & 63
            h = m.get("h")
            if isinstance(h, list):
                out["h"] = [[int(x[0]) % 6, int(x[1]) % 6] for x in h[:16]
                            if isinstance(x, list) and len(x) == 2]
            mp = m.get("m")
            if isinstance(mp, list) and len(mp) in (4, 6):
                out["m"] = [int(x) % 6 for x in mp]
            out["f"] = bool(m.get("f"))
            out["z"] = bool(m.get("z"))
        except (TypeError, ValueError):
            return
        room.broadcast(out, exclude=c)
        return
    if t == "finish" and room.phase == "playing":
        r = m.get("result")
        try:
            if not isinstance(r, dict):
                raise TypeError
            acc = float(r.get("acc", 0))
            c.result = {
                "score": max(0, min(1_000_000, int(r.get("score", 0)))), "acc": acc if math.isfinite(acc) else 0.0,
                "maxCombo": int(r.get("maxCombo", 0)), "rank": str(r.get("rank", ""))[:3],
                "counts": {k: int(v) for k, v in (r.get("counts") or {}).items() if k in ("perfect", "great", "good", "miss")},
                "incomplete": bool(r.get("incomplete")),
            }
        except (TypeError, ValueError, AttributeError, OverflowError):
            # 망가진 결과라도 '끝남'으로 처리해서 판이 멈추지 않게
            c.result = {"score": c.live.get("score", 0), "acc": 0.0, "maxCombo": 0, "incomplete": True}
        c.state = "done"
        room.push()
        check_progress(room)
        return


async def reaper():
    """응답 없는 연결 정리."""
    while True:
        await asyncio.sleep(10)
        now = time.time()
        for c in list(CLIENTS.values()):
            if not c.closed:
                try:
                    c.writer.write(ws_frame(b"lb", 9))   # 브라우저가 JS와 상관없이 pong으로 답함
                except Exception:
                    pass
            if now - c.last_seen > 45:
                c.closed = True
                try:
                    c.writer.transport.close()
                except Exception:
                    pass
        # 오래된 작업 기록 정리
        for jid, j in list(JOBS.items()):
            if j["stage"] in ("done", "error") and now - j["created"] > 3600:
                JOBS.pop(jid, None)


# ============================================================ 시작
def local_ips():
    import socket
    ips = set()
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ips.add(s.getsockname()[0])
        s.close()
    except Exception:
        pass
    return sorted(ips)


async def main():
    global MAIN_LOOP
    MAIN_LOOP = asyncio.get_running_loop()
    server = await asyncio.start_server(handle_conn, BIND, PORT)
    asyncio.create_task(reaper())
    def _migrate():
        try:
            restore_basic_from_backup()   # 기존 채보 먼저 원래대로 (AI 채보 박자 맞추기가 기존 채보를 기준으로 씀)
        except Exception:
            traceback.print_exc()
        migrate_ai_accents()
    if CLOUD:
        load_avqueue()
        load_queue()                      # 대기열을 먼저 불러온 다음 (되돌리기가 대기열에 곡을 넣을 수 있어서)
    threading.Thread(target=_migrate, daemon=True).start()
    if CLOUD:
        print(f"링크비트 클라우드 서버 실행 중 · {BIND}:{PORT} · 데이터 {DATA}", flush=True)
        async with server:
            await server.serve_forever()
        return
    threading.Thread(target=run_artist_refresh, daemon=True).start()
    print()
    print("=" * 56)
    print("  링크비트 서버가 켜졌어요!")
    print(f"  내 PC에서:      http://localhost:{PORT}")
    for ip in local_ips():
        print(f"  같은 와이파이:  http://{ip}:{PORT}")
    print("  친구 초대는 README.md 의 '친구와 함께하기'를 보세요.")
    print("  끄려면 이 창을 닫으세요.")
    print("=" * 56)
    print()
    if os.environ.get("LINKBEAT_NO_BROWSER") != "1":
        webbrowser.open(f"http://localhost:{PORT}/?host={HOST_KEY}")
    async with server:
        await server.serve_forever()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
    except OSError as e:
        print(f"서버를 켜지 못했어요: {e}")
        print(f"이미 링크비트가 켜져 있거나 {PORT} 포트를 다른 프로그램이 쓰고 있어요.")
