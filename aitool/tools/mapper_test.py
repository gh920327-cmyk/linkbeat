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


def run_one(audio, out_dir, sr, ref=None, super_timing=True):
    """새 AI 한 번 돌리기 → 만든 .osu 경로 (실패하면 None). ref 가 있으면 그 박자(타이밍)를 그대로 씀"""
    out_dir.mkdir(parents=True, exist_ok=True)
    q = lambda p: "'" + str(p).replace("\\", "/") + "'"      # Hydra 값 (경로는 / 로)
    args = [f"audio_path={q(audio)}", f"output_path={q(out_dir)}",
            "gamemode=3", "keycount=4", f"difficulty={sr}", "year=2023",
            "hold_note_ratio=0.05", "scroll_speed_ratio=0", "max_batch_size=16"]
    if ref:
        args += [f"beatmap_path={q(ref)}", "in_context=[TIMING]", "output_type=[MAP]"]
    else:
        args += ["output_type=[TIMING,MAP]", f"super_timing={'true' if super_timing else 'false'}"]
    env = dict(os.environ, PYTHONIOENCODING="utf-8", HF_HOME=str(M / "hf"),
               PATH=os.pathsep.join([str(ROOT / "bin"), os.environ.get("PATH", "")]))
    before = set(out_dir.glob("*.osu"))
    t0 = time.time()
    r = subprocess.run([str(MPY), str(REPO / "inference.py")] + args, cwd=str(REPO), env=env)   # 콘솔·출력은 부모 것 그대로 (실행기 안에서는 창 없이)
    new = [p for p in out_dir.glob("*.osu") if p not in before]
    if r.returncode != 0 or not new:
        SAY(f"  ⚠ 별점 {sr} 실패 (코드 {r.returncode})")
        return None
    SAY(f"  별점 {sr} 완성 ({time.time() - t0:.0f}초)")
    return max(new, key=lambda p: p.stat().st_mtime)


def generate(wav, odir):
    """별점 단계마다 새 AI로 채보 → [.osu 경로]. 첫 채보의 박자를 나머지 난이도에도 그대로 씀 (난이도끼리 박자가 같게)"""
    if odir.exists():
        shutil.rmtree(odir, ignore_errors=True)
    odir.mkdir(parents=True, exist_ok=True)
    made, ref = [], None
    for k, sr in enumerate(SRS):
        SAY(f"AI가 채보 쓰는 중... 새 AI {k + 1}/{len(SRS)} (osu 별점 {sr}{' · 박자 찾는 중' if ref is None else ''})")
        p = run_one(wav, odir / f"sr{sr:.1f}", sr, ref=ref)
        if p is None and ref is None:
            SAY("  박자 찾기를 빠른 방식으로 바꿔서 다시 해 볼게요")
            p = run_one(wav, odir / f"sr{sr:.1f}", sr, ref=None, super_timing=False)
        if p is None:
            continue
        if ref is None:
            ref = p
        dst = odir / f"sr{sr:.1f}_m.osu"
        shutil.copy2(p, dst)
        made.append(dst)
    return made


def choose(made, targets, duration):
    """만든 후보 → 난이도마다 기존 채보 ★에 가까운 것 (위 난이도가 더 쉬워지지 않게) → (body, chosen, cands)"""
    import chartgen
    cands = []
    for p in made:
        notes = [n for n in L.osu_to_notes(p) if n["t"] <= duration + 1]
        if len(notes) >= 20:
            cands.append((chartgen.star_rating(notes, 4), notes, p.stem))
    if not cands:
        raise RuntimeError("새 AI가 만든 채보가 비어 있어요.")
    active = L.active_secs(cands, duration)
    chosen = L.pick_for_diffs(cands, L.relative_targets(targets), active)
    ds = [d for d in L.DIFF_ORDER if d in chosen]           # 후보가 모자라서 위 난이도가 더 쉬워지면 별 순서대로 다시 배치
    chosen = dict(zip(ds, sorted((chosen[d] for d in ds), key=lambda c: c[0])))
    body = {"charts": {d: c[1] for d, c in chosen.items()}, "by": BY, "style": "rc"}
    return body, chosen, cands


def save(odir, vid, title, targets, body, chosen, cands):
    (odir / "upload.json").write_text(json.dumps(body, ensure_ascii=False), encoding="utf-8")
    summary = {"vid": vid, "title": title, "at": time.time(), "model": BY, "targets": targets,
               "chosen": {d: {"file": c[2], "stars": c[0], "notes": len(c[1])} for d, c in chosen.items()},
               "candidates": [{"file": c[2], "stars": c[0], "notes": len(c[1])} for c in sorted(cands, key=lambda c: c[0])]}
    (odir / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=1), encoding="utf-8")


def make_body(vid, wav, targets, duration, title=""):
    """실행기(채보 엔진)용: 받은 오디오(wav) + 기존 채보 ★ → 서버에 보낼 body (올리는 건 실행기가 함)"""
    odir = OUTM / vid
    made = generate(wav, odir)
    if not made:
        raise RuntimeError("새 AI가 채보를 하나도 못 만들었어요.")
    body, chosen, cands = choose(made, targets, duration)
    save(odir, vid, title, targets, body, chosen, cands)
    SAY(f"  {len(cands)}개 만들었어요")
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
        made = generate(wav, odir)
        if not made:
            raise RuntimeError("새 AI가 채보를 하나도 못 만들었어요.")
        body, chosen, cands = choose(made, targets, duration)
        save(odir, vid, title, targets, body, chosen, cands)
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
    SAY(f"새 AI로 바꿀 곡: {len(todo)}곡 (곡마다 7~8분) — 중간에 창을 닫아도 다시 실행하면 이어서 해요")
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


def main():
    ap = argparse.ArgumentParser(description="새 AI(Mapperatorinator) 채보")
    ap.add_argument("--try", dest="try_", default="")
    ap.add_argument("--resend", default="")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--all-undo", action="store_true")
    ap.add_argument("--skip", nargs="*", default=[])
    argv = sys.argv[1:]
    for i, x in enumerate(argv[:-1]):                 # '-'로 시작하는 곡 ID
        if x in ("--try", "--resend") and argv[i + 1].startswith("-"):
            argv[i:i + 2] = [f"{x}={argv[i + 1]}"]
            break
    tail = []
    if "--skip" in argv:                               # 그 뒤는 전부 곡 ID ('-'로 시작하는 ID도 그대로)
        k = argv.index("--skip")
        argv, tail = argv[:k + 1], argv[k + 1:]
    a = ap.parse_args(argv)
    if tail:
        a.skip = tail
    try:
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
