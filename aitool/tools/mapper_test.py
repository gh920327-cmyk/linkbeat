"""
새 AI(Mapperatorinator) 시험 — 지금 쓰는 MuG 도구는 그대로 두고, 곡 하나를 새 AI로 만들어서 그 곡의 AI 채보로 올려 봄
 - --try <링크>    : 새 AI로 4키 채보를 별점 몇 단계로 만들고, 기존 채보 ★에 가까운 걸 난이도마다 골라 서버에 올림
 - --resend <링크> : 새 AI로 만들어 둔 걸 다시 올림 (out_mapper 폴더)
 원래 MuG 채보로 되돌리기: 14_원래AI채보로되돌리기.bat (= linkbeat_ai.py --upload <링크>, out 폴더의 MuG 채보를 다시 올림)

Mapperatorinator: https://github.com/OliBomby/Mapperatorinator (MIT) — 시험 결과물은 out_mapper\\<곡ID>\\ 에만 저장
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
# 새 AI에게 줄 osu! 별점 후보 (osu!mania 별점). 링크비트 ★로 바꿔 보고 기존 채보와 가까운 걸 고름
SRS = [1.3, 1.9, 2.5, 3.1, 3.8]
BY = "Mapperatorinator V32"
SAY = L.say


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
    r = subprocess.run([str(MPY), str(REPO / "inference.py")] + args, cwd=str(REPO), env=env)
    new = [p for p in out_dir.glob("*.osu") if p not in before]
    if r.returncode != 0 or not new:
        SAY(f"  ⚠ 별점 {sr} 실패 (코드 {r.returncode})")
        return None
    SAY(f"  별점 {sr} 완성 ({time.time() - t0:.0f}초)")
    return max(new, key=lambda p: p.stat().st_mtime)


def cmd_try(link):
    import chartgen
    if not MPY.exists() or not (REPO / "inference.py").exists():
        raise SystemExit("새 AI가 아직 안 깔려 있어요. 12_새AI설치.bat 을 먼저 실행해 주세요.")
    srv = L.get_server(need_key=True)
    vid = L.parse_vid(link) or link.strip()
    song = srv.call("GET", f"songs/{vid}")
    title = song.get("title", vid)
    basic = song.get("charts") or {}
    targets = {d: chartgen.star_rating(basic[d], 4) for d in L.DIFF_ORDER if basic.get(d)}
    if not targets:
        raise SystemExit("이 곡에는 4키 기본 채보가 없어요.")
    duration = float(song.get("duration") or 900)
    SAY(f"\n[1/4] 곡: {title}")
    SAY("\n[2/4] 오디오 받는 중")
    wdir = L.WORK / ("mp_" + vid)
    wav, _ = L.download_audio(vid, wdir)
    odir = OUTM / vid
    if odir.exists():
        shutil.rmtree(odir, ignore_errors=True)
    odir.mkdir(parents=True, exist_ok=True)
    SAY(f"\n[3/4] 새 AI로 채보 쓰는 중 — 별점 {len(SRS)}단계 (처음 한 번은 모델 받기 · 박자 찾기 때문에 더 걸려요)")
    made, ref = [], None
    for k, sr in enumerate(SRS):
        SAY(f"\n  ── {k + 1}/{len(SRS)}: osu 별점 {sr} ──")
        p = run_one(wav, odir / f"sr{sr:.1f}", sr, ref=ref)
        if p is None and ref is None:
            SAY("  박자 찾기를 빠른 방식으로 바꿔서 다시 해 볼게요")
            p = run_one(wav, odir / f"sr{sr:.1f}", sr, ref=None, super_timing=False)
        if p is None:
            continue
        if ref is None:
            ref = p             # 첫 채보의 박자를 나머지 난이도에도 그대로 씀 (난이도끼리 박자가 같게)
        dst = odir / f"sr{sr:.1f}_m.osu"
        shutil.copy2(p, dst)
        made.append(dst)
    if not made:
        raise SystemExit("새 AI가 채보를 하나도 못 만들었어요. 위 메시지를 캡처해서 보내 주세요.")
    cands = []
    for p in made:
        notes = [n for n in L.osu_to_notes(p) if n["t"] <= duration + 1]
        if len(notes) >= 20:
            cands.append((chartgen.star_rating(notes, 4), notes, p.stem))
    if not cands:
        raise SystemExit("새 AI가 만든 채보가 비어 있어요.")
    active = L.active_secs(cands, duration)
    chosen = L.pick_for_diffs(cands, L.relative_targets(targets), active)
    ds = [d for d in L.DIFF_ORDER if d in chosen]           # 후보가 모자라서 위 난이도가 더 쉬워지면 별 순서대로 다시 배치
    chosen = dict(zip(ds, sorted((chosen[d] for d in ds), key=lambda c: c[0])))
    body = {"charts": {d: c[1] for d, c in chosen.items()}, "by": BY, "style": "rc"}
    (odir / "upload.json").write_text(json.dumps(body, ensure_ascii=False), encoding="utf-8")
    summary = {"vid": vid, "title": title, "at": time.time(), "model": BY, "targets": targets,
               "chosen": {d: {"file": c[2], "stars": c[0], "notes": len(c[1])} for d, c in chosen.items()},
               "candidates": [{"file": c[2], "stars": c[0], "notes": len(c[1])} for c in sorted(cands, key=lambda c: c[0])]}
    (odir / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=1), encoding="utf-8")
    SAY("\n[4/4] 서버에 'AI 채보'로 올리는 중 (기본 채보는 그대로)")
    L.upload(srv, vid, body)
    shutil.rmtree(wdir, ignore_errors=True)
    SAY("\n완료! 난이도별 비교 (★ = 링크비트 별점)")
    SAY("  난이도      기본 채보          새 AI 채보")
    for d in L.DIFF_ORDER:
        if d in chosen:
            SAY(f"  {L.DIFF_KO[d]:<6}  ★{targets[d]:4.1f} {len(basic[d]):5d}노트   ★{chosen[d][0]:4.1f} {len(chosen[d][1]):5d}노트")
    SAY("\n게임을 새로고침하고 이 곡을 쳐 보세요. 원래 AI 채보로 돌리려면 14_원래AI채보로되돌리기.bat")


def cmd_resend(link):
    vid = L.parse_vid(link) or link.strip()
    p = OUTM / vid / "upload.json"
    if not p.exists():
        raise SystemExit("이 곡은 새 AI로 만든 게 없어요.")
    r = L.upload(L.get_server(need_key=True), vid, json.loads(p.read_text(encoding="utf-8")))
    SAY(f"새 AI 채보를 다시 올렸어요: {r.get('counts')}")


def main():
    ap = argparse.ArgumentParser(description="새 AI(Mapperatorinator) 시험")
    ap.add_argument("--try", dest="try_", default="")
    ap.add_argument("--resend", default="")
    argv = sys.argv[1:]
    for i, x in enumerate(argv[:-1]):                 # '-'로 시작하는 곡 ID
        if x in ("--try", "--resend") and argv[i + 1].startswith("-"):
            argv[i:i + 2] = [f"{x}={argv[i + 1]}"]
            break
    a = ap.parse_args(argv)
    try:
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
