"""
새 AI(Mapperatorinator) 채보 — 지금 쓰는 MuG 도구·MuG 채보(out 폴더)는 그대로 두고, 새 AI로 만든 건 out_mapper 에 따로
 - --try <링크>     : 곡 하나를 새 AI로 만들어서 그 곡의 AI 채보로 올림
 - --all [--skip ..]: 서버의 곡 전부 (이미 새 AI로 만든 곡·지정 곡 빼고). 중간에 꺼도 다시 실행하면 이어서
 - --all-undo       : --all 로 바꾼 곡을 전부 원래 MuG 채보(out 폴더)로 다시 올림
 - --resend <링크>  : 새 AI로 만들어 둔 걸 다시 올림
 실행기(✦ AI·새 곡)는 linkbeat_ai.py --gen 이 이 파일의 make_body 를 씀 (새 AI가 깔려 있으면)
 곡 하나 되돌리기: 14_원래AI채보로되돌리기.bat (= linkbeat_ai.py --upload <링크>)

Mapperatorinator: https://github.com/OliBomby/Mapperatorinator (MIT)
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
import time
import traceback
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import linkbeat_ai as L  # noqa: E402  (서버 연결·오디오 받기·.osu 읽기·난이도 고르기는 지금 도구 것을 그대로 씀)

ROOT = L.ROOT
M = ROOT / "mapper"
REPO = M / "repo"
MPY = M / "venv" / "Scripts" / "python.exe"
OUTM = ROOT / "out_mapper"
RUN_FILE = OUTM / "_last_run.json"     # 전체 바꾸기 진행 상황 (중간에 꺼져도 이어서)
# 새 AI에게 줄 osu! 별점 후보 (osu!mania 별점). 링크비트 ★로 바꿔 보고 기존 채보와 가까운 걸 고름
SRS = [1.3, 1.9, 2.5, 3.1, 3.8]
BY = "Mapperatorinator V32"
SAY = L.say


def ready():
    """새 AI가 깔려 있는지 (settings.json 의 "engine": "mug" 이면 안 씀)"""
    if str(L.load_settings().get("engine", "")).lower() == "mug":
        return False
    return MPY.exists() and (REPO / "inference.py").exists()


def mapper_mode():
    """settings.json 의 mapperMode: 'seq'(지금 방식, 기본) / 'server'(동시에 도는 난이도를 AI 하나가 묶어서) / 'parallel'(조각을 32개씩 한꺼번에)
    — 19_AI방식바꾸기.bat 으로 바꿈. 18_AI속도시험.bat 으로 세 방식 시간을 같은 곡으로 재 볼 수 있음"""
    v = L.load_settings().get("mapperMode")
    return v if v in ("seq", "server", "parallel") else "seq"


def mapper_args(audio, out_dir, sr, ref=None, super_timing=True, server=False, parallel=False, timing_only=False):
    q = lambda p: "'" + str(p).replace("\\", "/") + "'"      # Hydra 값 (경로는 / 로)
    args = [f"audio_path={q(audio)}", f"output_path={q(out_dir)}",
            "gamemode=3", "keycount=4", f"difficulty={sr}", "year=2023",
            "hold_note_ratio=0.05", "scroll_speed_ratio=0", "max_batch_size=16"]
    if ref:
        args += [f"beatmap_path={q(ref)}", "in_context=[TIMING]", "output_type=[MAP]"]
    else:
        args += ["output_type=[TIMING]" if timing_only else "output_type=[TIMING,MAP]", f"super_timing={'true' if super_timing else 'false'}"]
    if server:
        args += ["use_server=true"]          # 동시에 도는 여러 난이도의 요청을 AI 하나가 묶어서 계산
    if parallel:
        args += ["parallel=true"]            # 곡 조각들을 차례로 말고 32개씩 한꺼번에 (앞 조각을 안 보고 씀)
    env = dict(os.environ, PYTHONIOENCODING="utf-8", HF_HOME=str(M / "hf"),
               PATH=os.pathsep.join([str(ROOT / "bin"), os.environ.get("PATH", "")]))
    return [str(MPY), str(REPO / "inference.py")] + args, env


def newest_osu(out_dir, before=()):
    new = [p for p in out_dir.glob("*.osu") if p not in before]
    return max(new, key=lambda p: p.stat().st_mtime) if new else None


def run_one(audio, out_dir, sr, ref=None, super_timing=True, parallel=False):
    """새 AI 한 번 돌리기 → 만든 .osu 경로 (실패하면 None). ref 가 있으면 그 박자(타이밍)를 그대로 씀"""
    out_dir.mkdir(parents=True, exist_ok=True)
    cmd, env = mapper_args(audio, out_dir, sr, ref, super_timing, parallel=parallel)
    before = set(out_dir.glob("*.osu"))
    t0 = time.time()
    r = subprocess.run(cmd, cwd=str(REPO), env=env)   # 콘솔·출력은 부모 것 그대로 (실행기 안에서는 창 없이)
    p = newest_osu(out_dir, before)
    if r.returncode != 0 or p is None:
        SAY(f"  ⚠ 별점 {sr} 실패 (코드 {r.returncode})")
        return None
    SAY(f"  별점 {sr} 완성 ({time.time() - t0:.0f}초)")
    return p


def gpu_free_mb():
    """그래픽카드 남은 메모리(MB) — 모르면 None"""
    try:
        flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        r = subprocess.run(["nvidia-smi", "--query-gpu=memory.free", "--format=csv,noheader,nounits"],
                           capture_output=True, text=True, timeout=15, creationflags=flags)
        return int(r.stdout.strip().splitlines()[0])
    except Exception:
        return None


BUSY_3D = 15.0      # 다른 프로그램들의 그래픽카드 3D 사용률 합(%)이 이 이상이면 '게임 중'
BUSY_UTIL = 25.0    # (윈도우 카운터를 못 읽을 때) 시작 전 그래픽카드 전체 사용률이 이 이상이면 '게임 중'


def gpu_3d_load(secs=1.0):
    """윈도우 성능 카운터: 모든 프로그램의 그래픽카드 3D 사용률 합(%) — 게임·링크비트 화면·3D 프로그램.
    AI 채보는 계산(Compute)만 써서 여기 안 잡힘 → 우리가 돌리는 중에도 다른 게임을 알아볼 수 있음. 못 읽으면 None"""
    if os.name != "nt":
        return None
    try:
        import ctypes
        from ctypes import wintypes as wt
        pdh = ctypes.WinDLL("pdh.dll")
        for f in ("PdhOpenQueryW", "PdhAddEnglishCounterW", "PdhCollectQueryData", "PdhGetFormattedCounterArrayW", "PdhCloseQuery"):
            getattr(pdh, f).restype = wt.DWORD

        class FMT(ctypes.Structure):
            _fields_ = [("CStatus", wt.DWORD), ("doubleValue", ctypes.c_double)]

        class ITEM(ctypes.Structure):
            _fields_ = [("szName", wt.LPWSTR), ("FmtValue", FMT)]
        q, c = wt.HANDLE(), wt.HANDLE()
        if pdh.PdhOpenQueryW(None, None, ctypes.byref(q)) != 0:
            return None
        try:
            # 영어 이름으로 추가 (한국어 윈도우에서도 됨)
            if pdh.PdhAddEnglishCounterW(q, "\\GPU Engine(*engtype_3D)\\Utilization Percentage", None, ctypes.byref(c)) != 0:
                return None
            pdh.PdhCollectQueryData(q)
            time.sleep(secs)
            pdh.PdhCollectQueryData(q)
            size, count = wt.DWORD(0), wt.DWORD(0)
            r = pdh.PdhGetFormattedCounterArrayW(c, 0x200, ctypes.byref(size), ctypes.byref(count), None)   # 0x200 = 실수
            if r == 0:
                return 0.0
            if r != 0x800007D2:          # PDH_MORE_DATA (버퍼 크기를 알려 줌)
                return None
            buf = ctypes.create_string_buffer(size.value)
            if pdh.PdhGetFormattedCounterArrayW(c, 0x200, ctypes.byref(size), ctypes.byref(count), buf) != 0:
                return None
            items = ctypes.cast(buf, ctypes.POINTER(ITEM))
            return sum(max(0.0, items[i].FmtValue.doubleValue) for i in range(count.value) if items[i].FmtValue.CStatus in (0, 1))
        finally:
            pdh.PdhCloseQuery(q)
    except Exception:
        return None


def gpu_util():
    """그래픽카드 전체 사용률(%) — 모르면 None (AI 채보를 돌리기 전에만 의미 있음)"""
    try:
        flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        r = subprocess.run(["nvidia-smi", "--query-gpu=utilization.gpu", "--format=csv,noheader,nounits"],
                           capture_output=True, text=True, timeout=15, creationflags=flags)
        return float(r.stdout.strip().splitlines()[0])
    except Exception:
        return None


def host_playing():
    """방장이 지금 링크비트에서 곡을 치는 중인지 (서버에 물어봄)"""
    try:
        srv = L.get_server(need_key=False)
        return bool(srv.key) and bool(srv.call("GET", "host/playing", timeout=5).get("playing"))
    except Exception:
        return False


def busy_reason(before_start=False):
    """'게임 중'이면 그 이유, 아니면 None — 링크비트 플레이 중이거나 다른 게임·3D 프로그램이 그래픽카드를 쓰는 중"""
    if host_playing():
        return "링크비트 플레이 중"
    load = gpu_3d_load()
    if load is not None:
        return f"게임 중 (그래픽 3D {load:.0f}%)" if load >= BUSY_3D else None
    if before_start:                                   # 윈도우 카운터를 못 읽으면 시작 전 전체 사용률로만
        u = gpu_util()
        if u is not None and u >= BUSY_UTIL:
            return f"그래픽카드 사용 중 ({u:.0f}%)"
    return None


def parallel_jobs():
    """나머지 난이도를 동시에 몇 개까지 만들지 → (개수, 고정인지)
    settings.json 의 "mapperJobs"(1~4)가 있으면 그 값으로 고정, 없으면 그래픽카드 남은 메모리로 (한 개에 약 2GB, 다른 프로그램 몫 1.5GB)
    — 게임 중(링크비트·다른 게임)이면 이 개수와 상관없이 하나씩 (run_many 가 수시로 확인)"""
    v = L.load_settings().get("mapperJobs")
    if v is not None:
        try:
            return max(1, min(4, int(v))), True
        except (TypeError, ValueError):
            pass
    free = gpu_free_mb()
    return (2 if free is None else max(1, min(4, (free - 1500) // 2000))), False


def run_many(audio, odir, srs, ref, jobs, auto=True, server=False):
    """박자(ref)가 정해진 뒤 나머지 난이도를 jobs 개씩 동시에 — 그래픽카드가 한 번에 한 글자씩 쓰느라 놀고 있는 시간을 채움.
    auto: 새로 시작하기 전마다 게임 중인지 다시 봄 → 게임 중이면 하나씩 (이미 돌던 건 마저 끝냄), 끝나면 다시 동시에
    실패한 건(메모리 부족 등) 끝나고 하나씩 다시 → {별점: .osu 경로}"""
    flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    pending, running, got, failed = list(srs), {}, {}, []
    t0 = time.time()
    busy = busy_reason(before_start=True) if auto else None
    checked, said = time.time(), busy
    if busy:
        SAY(f"  {busy}이라 하나씩 만들어요 (게임이 끝나면 다음 것부터 동시에)")
    while pending or running:
        if auto and pending and running and time.time() - checked > 5:     # 하나 이상 돌고 있을 때 더 늘려도 되는지
            busy, checked = busy_reason(), time.time()
            if busy != said:
                SAY(f"  {busy}이라 지금 것만 마저 하고 하나씩 만들어요" if busy else "  게임이 끝나서 다시 동시에 만들어요")
                said = busy
        limit = 1 if busy else jobs
        while pending and len(running) < limit:
            sr = pending.pop(0)
            d = odir / f"sr{sr:.1f}"
            d.mkdir(parents=True, exist_ok=True)
            cmd, env = mapper_args(audio, d, sr, ref, server=server)
            log = open(d / "run.log", "wb")
            proc = subprocess.Popen(cmd, cwd=str(REPO), env=env, stdout=log, stderr=subprocess.STDOUT, creationflags=flags)
            running[sr] = (proc, log, d, time.time())
        time.sleep(0.5)
        for sr, (proc, log, d, t1) in list(running.items()):
            if proc.poll() is None:
                continue
            log.close()
            del running[sr]
            p = newest_osu(d)
            if proc.returncode == 0 and p is not None:
                got[sr] = p
                SAY(f"AI가 채보 쓰는 중... 새 AI {1 + len(got)}/{len(SRS)} 완성 (별점 {sr} · {time.time() - t1:.0f}초)")
            else:
                tail = (d / "run.log").read_bytes()[-600:].decode("utf-8", "replace").strip().splitlines()[-1:] if (d / "run.log").exists() else []
                SAY(f"  ⚠ 별점 {sr} 동시 만들기 실패 (코드 {proc.returncode}) {tail[0][:120] if tail else ''}")
                failed.append(sr)
    for sr in failed:                                  # 동시에 하다 실패한 것만 하나씩 (예전 방식)
        SAY(f"AI가 채보 쓰는 중... 별점 {sr} 다시 (혼자)")
        p = run_one(audio, odir / f"sr{sr:.1f}", sr, ref=ref)
        if p is not None:
            got[sr] = p
    SAY(f"  나머지 {len(srs)}개 난이도 {time.time() - t0:.0f}초")
    return got


def timing_ref(wav, odir):
    """박자(타이밍)만 먼저 찾기 → 박자만 든 .osu (실패하면 None) — 'parallel' 방식에서 모든 난이도가 이걸 씀"""
    d = odir / "timing"
    d.mkdir(parents=True, exist_ok=True)
    cmd, env = mapper_args(wav, d, SRS[0], timing_only=True)
    before = set(d.glob("*.osu"))
    t0 = time.time()
    r = subprocess.run(cmd, cwd=str(REPO), env=env)
    p = newest_osu(d, before)
    if r.returncode != 0 or p is None:
        SAY(f"  ⚠ 박자만 찾기 실패 (코드 {r.returncode}) — 지금 방식으로 할게요")
        return None
    SAY(f"  박자 찾기 {time.time() - t0:.0f}초")
    return p


def generate(wav, odir, mode=None):
    """별점 단계마다 새 AI로 채보 → [.osu 경로]. 첫 채보의 박자를 나머지 난이도에도 그대로 씀 (난이도끼리 박자가 같게)
    mode (없으면 settings 의 mapperMode):
      seq      첫 채보(박자 찾기 포함)는 혼자, 나머지는 그래픽카드 메모리에 맞춰 동시에 (지금 방식)
      server   위와 같지만 동시에 도는 난이도들의 계산을 AI 하나가 묶어서
      parallel 박자만 먼저 찾고, 난이도마다 곡 조각들을 32개씩 한꺼번에 (조각이 앞 조각을 안 보고 씀)"""
    mode = mode or mapper_mode()
    if odir.exists():
        shutil.rmtree(odir, ignore_errors=True)
    odir.mkdir(parents=True, exist_ok=True)
    t_start = time.time()
    made, ref = {}, None
    rest = list(SRS)
    if mode == "parallel":
        SAY(f"AI가 채보 쓰는 중... 박자 찾는 중 (빠른 방식)")
        tref = timing_ref(wav, odir)
        if tref is not None:
            for k, sr in enumerate(SRS):
                SAY(f"AI가 채보 쓰는 중... 새 AI {k + 1}/{len(SRS)} (osu 별점 {sr} · 한꺼번에)")
                p = run_one(wav, odir / f"sr{sr:.1f}", sr, ref=tref, parallel=True)
                if p is not None:
                    made[sr] = p
            rest = []
            ref = tref
    while rest and ref is None:                        # 박자를 찾을 때까지 (보통 첫 번째에서 끝남)
        sr = rest.pop(0)
        SAY(f"AI가 채보 쓰는 중... 새 AI {len(made) + 1}/{len(SRS)} (osu 별점 {sr} · 박자 찾는 중)")
        p = run_one(wav, odir / f"sr{sr:.1f}", sr, ref=None)
        if p is None:
            SAY("  박자 찾기를 빠른 방식으로 바꿔서 다시 해 볼게요")
            p = run_one(wav, odir / f"sr{sr:.1f}", sr, ref=None, super_timing=False)
        if p is not None:
            ref = p
            made[sr] = p
    if rest and ref is not None and mode == "server":
        SAY(f"AI가 채보 쓰는 중... 나머지 {len(rest)}개 난이도 (AI 하나가 묶어서 동시에)")
        made.update(run_many(wav, odir, rest, ref, len(rest), auto=True, server=True))
        rest = []
    if rest and ref is not None:
        jobs, fixed = parallel_jobs()
        if jobs > 1:
            SAY(f"AI가 채보 쓰는 중... 나머지 {len(rest)}개 난이도 (한가하면 {min(jobs, len(rest))}개씩 동시에)")
            made.update(run_many(wav, odir, rest, ref, jobs, auto=not fixed))
        else:
            for k, sr in enumerate(rest):
                SAY(f"AI가 채보 쓰는 중... 새 AI {len(made) + 1}/{len(SRS)} (osu 별점 {sr})")
                p = run_one(wav, odir / f"sr{sr:.1f}", sr, ref=ref)
                if p is not None:
                    made[sr] = p
    out = []
    for sr in SRS:
        if sr in made:
            dst = odir / f"sr{sr:.1f}_m.osu"
            shutil.copy2(made[sr], dst)
            out.append(dst)
    (odir / "mode.json").write_text(json.dumps({"mode": mode, "secs": round(time.time() - t_start)}), encoding="utf-8")
    return out


def ai_end_of(made, duration=None):
    """새 AI 후보 전부 중 가장 늦게 시작하는 노트 (초) — 그 뒤는 노래가 끝난 걸로 봄 (마지막 긴 화음의 울림은 노래 끝)"""
    end = None
    for p in made:
        for n in L.osu_to_notes(p):
            if duration and n["t"] > duration + 1:
                continue
            end = n["t"] if end is None else max(end, n["t"])
    return end


def choose(made, targets, duration, quiet=()):
    """만든 후보 → 난이도마다 기존 채보 ★에 가까운 것 (위 난이도가 더 쉬워지지 않게) → (body, chosen, cands)
    quiet: 소리 없는 구간 — 그 안의 노트는 빼고 고름 (서버도 같은 구간을 모든 채보에 적용)"""
    import chartgen
    cands = []
    for p in made:
        notes = [n for n in L.osu_to_notes(p) if n["t"] <= duration + 1 and not L.in_spans(n["t"], quiet)]
        if len(notes) >= 20:
            cands.append((chartgen.star_rating(notes, 4), notes, p.stem))
    if not cands:
        raise RuntimeError("새 AI가 만든 채보가 비어 있어요.")
    active = L.active_secs(cands, duration)
    chosen = L.pick_for_diffs(cands, L.relative_targets(targets), active)
    ds = [d for d in L.DIFF_ORDER if d in chosen]           # 후보가 모자라서 위 난이도가 더 쉬워지면 별 순서대로 다시 배치
    chosen = dict(zip(ds, sorted((chosen[d] for d in ds), key=lambda c: c[0])))
    body = {"charts": {d: c[1] for d, c in chosen.items()}, "by": BY, "style": "rc"}
    if quiet:
        body["quiet"] = [list(x) for x in quiet]
    return body, chosen, cands


def find_quiet(wav, made, duration):
    """소리 없는 구간 (실패해도 채보는 그대로 만듦)"""
    try:
        q = L.quiet_spans(wav, duration, ai_end_of(made, duration))
        if q:
            SAY(f"  소리 없는 구간 {len(q)}곳 ({sum(min(b, duration) - max(a, 0) for a, b in q):.1f}초) — 노트를 넣지 않아요")
        return q
    except Exception as e:
        SAY(f"  (소리 없는 구간은 못 찾았어요: {e})")
        return []


def save(odir, vid, title, targets, body, chosen, cands, secs=None):
    (odir / "upload.json").write_text(json.dumps(body, ensure_ascii=False), encoding="utf-8")
    summary = {"vid": vid, "title": title, "at": time.time(), "model": BY, "targets": targets,
               "secs": round(secs) if secs else None, "quiet": body.get("quiet") or [],
               "chosen": {d: {"file": c[2], "stars": c[0], "notes": len(c[1])} for d, c in chosen.items()},
               "candidates": [{"file": c[2], "stars": c[0], "notes": len(c[1])} for c in sorted(cands, key=lambda c: c[0])]}
    (odir / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=1), encoding="utf-8")


def make_body(vid, wav, targets, duration, title=""):
    """실행기(채보 엔진)용: 받은 오디오(wav) + 기존 채보 ★ → 서버에 보낼 body (올리는 건 실행기가 함)"""
    odir = OUTM / vid
    t0 = time.time()
    made = generate(wav, odir)
    if not made:
        raise RuntimeError("새 AI가 채보를 하나도 못 만들었어요.")
    quiet = find_quiet(wav, made, duration)
    body, chosen, cands = choose(made, targets, duration, quiet)
    save(odir, vid, title, targets, body, chosen, cands, time.time() - t0)
    SAY(f"  {len(cands)}개 만들었어요 ({time.time() - t0:.0f}초)")
    return body


def make_song(srv, vid):
    """곡 하나: 서버에서 곡 정보 → 오디오 받기 → 새 AI → 서버에 올림 → (targets, basic, chosen)"""
    import chartgen
    song = srv.call("GET", f"songs/{vid}")
    title = song.get("title", vid)
    basic = song.get("charts") or {}
    targets = {d: chartgen.star_rating(basic[d], 4) for d in L.DIFF_ORDER if basic.get(d)}
    if not targets:
        raise SystemExit("이 곡에는 4키 기본 채보가 없어요.")
    duration = float(song.get("duration") or 900)
    SAY(f"\n곡: {title}")
    SAY("오디오 받는 중")
    wdir = L.WORK / ("mp_" + vid)
    try:
        wav, _ = L.download_audio(vid, wdir)
        odir = OUTM / vid
        t0 = time.time()
        made = generate(wav, odir)
        if not made:
            raise RuntimeError("새 AI가 채보를 하나도 못 만들었어요.")
        quiet = find_quiet(wav, made, duration)
        body, chosen, cands = choose(made, targets, duration, quiet)
        save(odir, vid, title, targets, body, chosen, cands, time.time() - t0)
        SAY("서버에 'AI 채보'로 올리는 중 (기본 채보는 그대로)")
        L.upload(srv, vid, body)
    finally:
        shutil.rmtree(wdir, ignore_errors=True)
    return targets, basic, chosen


def say_table(targets, basic, chosen):
    SAY("  난이도      기본 채보          새 AI 채보")
    for d in L.DIFF_ORDER:
        if d in chosen:
            SAY(f"  {L.DIFF_KO[d]:<6}  ★{targets[d]:4.1f} {len(basic[d]):5d}노트   ★{chosen[d][0]:4.1f} {len(chosen[d][1]):5d}노트")


def need_installed():
    if not MPY.exists() or not (REPO / "inference.py").exists():
        raise SystemExit("새 AI가 아직 안 깔려 있어요. 12_새AI설치.bat 을 먼저 실행해 주세요.")


def cmd_try(link):
    need_installed()
    srv = L.get_server(need_key=True)
    vid = L.parse_vid(link) or link.strip()
    targets, basic, chosen = make_song(srv, vid)
    SAY("\n완료! 난이도별 비교 (★ = 링크비트 별점)")
    say_table(targets, basic, chosen)
    SAY("\n게임을 새로고침하고 이 곡을 쳐 보세요. 원래 AI 채보로 돌리려면 14_원래AI채보로되돌리기.bat")


def cmd_all(skip):
    """서버의 곡 전부를 새 AI로 (지정 곡·이미 새 AI로 만든 곡 빼고). 곡마다 끝나면 기록 → 다시 실행하면 이어서"""
    need_installed()
    srv = L.get_server(need_key=True)
    skip = {L.parse_vid(x) or x for x in skip}
    run = {}
    if RUN_FILE.exists():
        try:
            run = json.loads(RUN_FILE.read_text(encoding="utf-8"))
        except Exception:
            run = {}
    if not run or run.get("finished"):
        lst = srv.call("GET", "songs").get("songs", [])
        ids = [s["id"] for s in lst if s.get("id") not in skip]
        already = [v for v in ids if (OUTM / v / "upload.json").exists()]
        run = {"ids": [v for v in ids if v not in already], "done": [], "failed": {}, "kept": already, "at": time.time()}
        if already:
            SAY(f"이미 새 AI로 만든 곡 {len(already)}개는 건너뛰어요. (다시 만들려면 13번으로 곡마다)")
    else:
        SAY("지난번에 하다 만 게 있어서 이어서 해요.")
    OUTM.mkdir(parents=True, exist_ok=True)

    def save_run():
        RUN_FILE.write_text(json.dumps(run, ensure_ascii=False, indent=1), encoding="utf-8")
    save_run()
    todo = [v for v in run["ids"] if v not in run["done"] and v not in run["failed"]]
    SAY(f"새 AI로 바꿀 곡: {len(todo)}곡 (곡마다 4~6분) — 중간에 창을 닫아도 다시 실행하면 이어서 해요")
    t0 = time.time()
    for k, vid in enumerate(todo):
        SAY(f"\n========== {k + 1}/{len(todo)}: {vid} ==========")
        try:
            targets, basic, chosen = make_song(srv, vid)
            say_table(targets, basic, chosen)
            run["done"].append(vid)
        except SystemExit as e:
            run["failed"][vid] = str(e)[:200]
            SAY(f"  건너뜀: {e}")
        except Exception as e:
            traceback.print_exc()
            run["failed"][vid] = str(e)[:200]
            SAY(f"  건너뜀: {e}")
        save_run()
        left = len(todo) - k - 1
        if left:
            SAY(f"  남은 곡 {left}개 · 예상 {int((time.time() - t0) / (k + 1) * left / 60) + 1}분")
    run["finished"] = True
    save_run()
    SAY(f"\n끝! {len(run['done'])}곡을 새 AI로 바꿨어요. 게임을 새로고침하면 반영돼요.")
    if run["failed"]:
        SAY(f"못 만든 곡 {len(run['failed'])}개 (원래 AI 채보 그대로):")
        for v, e in run["failed"].items():
            SAY(f"  {v}: {e[:100]}")
    SAY("되돌리려면 16_전체원래AI채보로되돌리기.bat (곡 하나는 14번)")


def cmd_all_undo():
    """--all 로 바꾼 곡을 전부 원래 MuG 채보(out 폴더)로 다시 올림"""
    srv = L.get_server(need_key=True)
    run = json.loads(RUN_FILE.read_text(encoding="utf-8")) if RUN_FILE.exists() else {}
    ids = run.get("done") or []
    if not ids:
        SAY("새 AI로 전체 바꾸기를 한 곡이 없어요.")
        return
    n = 0
    for vid in ids:
        p = L.OUT / vid / "upload.json"
        if not p.exists():
            SAY(f"  원래 AI 채보가 없어서 그대로 둬요: {vid}")
            continue
        try:
            L.upload(srv, vid, json.loads(p.read_text(encoding="utf-8")))
            n += 1
            SAY(f"  되돌렸어요: {vid}")
        except SystemExit:
            raise
        except Exception as e:
            SAY(f"  건너뜀: {vid} ({e})")
    SAY(f"\n{n}곡을 원래 AI 채보로 되돌렸어요. 게임을 새로고침하면 반영돼요.")


def cmd_resend(link):
    vid = L.parse_vid(link) or link.strip()
    p = OUTM / vid / "upload.json"
    if not p.exists():
        raise SystemExit("이 곡은 새 AI로 만든 게 없어요.")
    r = L.upload(L.get_server(need_key=True), vid, json.loads(p.read_text(encoding="utf-8")))
    SAY(f"새 AI 채보를 다시 올렸어요: {r.get('counts')}")


SPEED = OUTM / "_speed"
SPEED_BACKUP = ROOT / "backup_speed"
MODES = [("seq", "지금 방식"), ("server", "2번 (난이도 묶어서)"), ("parallel", "1번 (조각 한꺼번에)")]
WORKING = ("claimed", "info", "download", "analyze", "ai", "upload")


def wait_idle(srv):
    """엔진이 채보를 만드는 중이거나 게임 중이면 끝날 때까지 기다림 (같이 돌면 시간이 섞여서 비교가 안 됨)"""
    said = ""
    while True:
        try:
            busy = [j for j in srv.call("GET", "jobs", timeout=15).get("jobs", []) if j.get("stage") in WORKING]
        except Exception:
            busy = []
        why = f"엔진이 '{(busy[0].get('title') or '')[:30]}' 채보를 만드는 중" if busy else busy_reason(before_start=True)
        if not why:
            return
        if why != said:
            SAY(f"  {why}이라 끝날 때까지 기다려요... (30초마다 다시 봐요)")
            said = why
        time.sleep(30)


def chart_stats(chosen):
    return {d: {"stars": round(c[0], 1), "notes": len(c[1])} for d, c in chosen.items()}


def cmd_speed(ids):
    """속도 시험: 같은 곡을 세 방식(지금 / 2번 / 1번)으로 만들어 걸린 시간·별점·노트 수 비교 → 1번 방식 채보는 게임에 잠깐 올림"""
    import chartgen
    need_installed()
    srv = L.get_server(need_key=True)
    ids = [L.parse_vid(x) or x.strip() for x in ids if x.strip()]
    if not ids:                                        # 비우면 최근에 AI 채보를 만든 곡 2개
        sums = sorted((p for p in OUTM.glob("*/summary.json") if not p.parent.name.startswith("_")),
                      key=lambda p: -p.stat().st_mtime)
        ids = [p.parent.name for p in sums][:2]
    SAY(f"속도 시험: {len(ids)}곡 × 3가지 방식 (곡마다 15~20분쯤)")
    rows = []
    for vid in ids:
        song = srv.call("GET", f"songs/{vid}")
        title = song.get("title", vid)
        basic = song.get("charts") or {}
        targets = {d: chartgen.star_rating(basic[d], 4) for d in L.DIFF_ORDER if basic.get(d)}
        duration = float(song.get("duration") or 900)
        wdir = L.WORK / ("speed_" + vid)
        res = {}
        try:
            SAY(f"\n========== {title} ==========")
            SAY("오디오 받는 중")
            wav, _ = L.download_audio(vid, wdir)
            for mode, name in MODES:
                wait_idle(srv)
                SAY(f"\n--- {name} ---")
                odir = SPEED / vid / mode
                t0 = time.time()
                try:
                    made = generate(wav, odir, mode)
                except Exception as e:
                    traceback.print_exc()
                    made = []
                    SAY(f"  ⚠ {name} 실패: {e}")
                secs = time.time() - t0
                if not made:
                    res[mode] = {"secs": round(secs), "fail": True}
                    continue
                quiet = find_quiet(wav, made, duration)
                body, chosen, cands = choose(made, targets, duration, quiet)
                save(odir, vid, title, targets, body, chosen, cands, secs)
                res[mode] = {"secs": round(secs), "charts": chart_stats(chosen)}
                SAY(f"  {name}: {secs / 60:.1f}분")
        finally:
            shutil.rmtree(wdir, ignore_errors=True)
        rows.append({"vid": vid, "title": title, "targets": {d: round(v, 1) for d, v in targets.items()}, "res": res})
        pb = SPEED / vid / "parallel" / "upload.json"
        bk, cur = SPEED_BACKUP / vid, OUTM / vid
        if pb.exists() and (cur / "upload.json").exists():   # 1번 방식 채보를 게임에 잠깐 올려서 직접 쳐 보게 (지금 AI 채보는 보관)
            if not bk.exists():
                shutil.copytree(cur, bk)
            L.upload(srv, vid, json.loads(pb.read_text(encoding="utf-8")))
            SAY("  1번 방식 채보를 게임에 올렸어요 (지금 AI 채보는 보관해 뒀어요)")
    SPEED.mkdir(parents=True, exist_ok=True)
    (SPEED / "report.json").write_text(json.dumps({"at": time.time(), "rows": rows}, ensure_ascii=False, indent=1), encoding="utf-8")
    lines = ["", "=" * 60, "속도 시험 결과 (분)", f"{'곡':<28} " + " ".join(f"{n:>14}" for _, n in MODES)]
    for r in rows:
        cells = [("실패" if r["res"].get(m, {}).get("fail") else f"{r['res'][m]['secs'] / 60:.1f}") if m in r["res"] else "-" for m, _ in MODES]
        lines.append(f"{r['title'][:28]:<28} " + " ".join(f"{c:>14}" for c in cells))
        for m, name in MODES:                          # 난이도별 ★·노트 수 (기존 채보 ★ 대비)
            ch = r["res"].get(m, {}).get("charts")
            if ch:
                lines.append(f"    {name:<16} " + " · ".join(f"{L.DIFF_KO.get(d, d)} ★{c['stars']}/{c['notes']}" for d, c in ch.items()))
    lines += ["", "1번 방식 채보를 그 곡들에 올려 뒀어요. 게임을 새로고침하고 AI 채보로 쳐 보세요.",
              "마음에 안 들면 19_AI속도시험되돌리기.bat 으로 원래 AI 채보로 돌아가요.",
              "결과 파일: out_mapper\\_speed\\report.json"]
    (SPEED / "report.txt").write_text("\n".join(lines), encoding="utf-8")
    for x in lines:
        SAY(x)


def cmd_speed_undo():
    bks = [bk for bk in sorted(SPEED_BACKUP.glob("*")) if (bk / "upload.json").exists()] if SPEED_BACKUP.exists() else []
    if not bks:
        SAY("되돌릴 곡이 없어요.")
        return
    srv = L.get_server(need_key=True)
    n = 0
    for bk in bks:
        up = bk / "upload.json"
        L.upload(srv, bk.name, json.loads(up.read_text(encoding="utf-8")))
        cur = OUTM / bk.name
        if cur.exists():
            shutil.rmtree(cur)
        shutil.copytree(bk, cur)
        shutil.rmtree(bk)
        n += 1
        SAY(f"  되돌렸어요: {bk.name}")
    SAY(f"\n{n}곡을 원래 AI 채보로 되돌렸어요. 게임을 새로고침하면 반영돼요." if n else "되돌릴 곡이 없어요.")


def cmd_mode(mode):
    names = dict(MODES)
    if mode not in names:
        SAY(f"지금 방식: {names[mapper_mode()]}")
        SAY("  1 = 지금 방식 · 2 = 난이도 묶어서 · 3 = 조각 한꺼번에")
        mode = {"1": "seq", "2": "server", "3": "parallel"}.get(input("번호: ").strip(), "")
        if mode not in names:
            SAY("바꾸지 않았어요.")
            return
    st = L.load_settings()
    st["mapperMode"] = mode
    L.save_settings(st)
    SAY(f"앞으로 새 곡 AI 채보는 '{names[mode]}'으로 만들어요. (실행기를 다시 켤 필요 없어요)")


def main():
    ap = argparse.ArgumentParser(description="새 AI(Mapperatorinator) 채보")
    ap.add_argument("--try", dest="try_", default="")
    ap.add_argument("--resend", default="")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--all-undo", action="store_true")
    ap.add_argument("--skip", nargs="*", default=[])
    ap.add_argument("--speed", nargs="*", default=None, help="속도 시험 (곡 링크/ID, 비우면 최근 2곡)")
    ap.add_argument("--speed-undo", action="store_true")
    ap.add_argument("--mode", nargs="?", const="", default=None, help="AI 채보 방식 바꾸기 (seq/server/parallel)")
    argv = sys.argv[1:]
    for i, x in enumerate(argv[:-1]):                 # '-'로 시작하는 곡 ID
        if x in ("--try", "--resend") and argv[i + 1].startswith("-"):
            argv[i:i + 2] = [f"{x}={argv[i + 1]}"]
            break
    tail, speed = [], None
    if "--speed" in argv:                              # 그 뒤는 전부 곡 링크/ID (띄어쓰기·쉼표로 여러 개, '-'로 시작해도 됨)
        k = argv.index("--speed")
        argv, speed = argv[:k + 1], [y for x in argv[k + 1:] for y in x.replace(",", " ").split()]
    if "--skip" in argv:                               # 그 뒤는 전부 곡 ID ('-'로 시작하는 ID도 그대로)
        k = argv.index("--skip")
        argv, tail = argv[:k + 1], argv[k + 1:]
    a = ap.parse_args(argv)
    if tail:
        a.skip = tail
    if speed is not None:
        a.speed = speed
    try:
        if a.speed is not None:
            cmd_speed(a.speed)
            return
        if a.speed_undo:
            cmd_speed_undo()
            return
        if a.mode is not None:
            cmd_mode(a.mode)
            return
        if a.all_undo:
            cmd_all_undo()
            return
        if a.all:
            cmd_all(a.skip)
            return
        if a.resend:
            cmd_resend(a.resend)
            return
        link = a.try_ or input("새 AI로 만들어 볼 곡의 유튜브 링크 (게임에 있는 곡): ").strip()
        cmd_try(link)
    except SystemExit:
        raise
    except KeyboardInterrupt:
        SAY("\n멈췄어요.")
    except Exception as e:
        traceback.print_exc()
        SAY(f"\n문제가 생겼어요: {e}\n위 메시지를 캡처해서 보내 주세요.")
        sys.exit(1)


if __name__ == "__main__":
    main()
