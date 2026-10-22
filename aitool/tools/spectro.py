"""
링크비트 채보 점검 그림 — 노래 소리와 채보를 한 그림에 겹쳐 그려요 (AI가 '눈으로 듣고' 채보를 점검할 수 있게)

한 줄 = 8초, 한 장 = 4줄(32초). 줄마다 위에서부터:
  1) 스펙트로그램 (낮은 소리 아래 · 높은 소리 위, 밝을수록 큰 소리)
  2) 소리별 소리 시작 위치: 드럼 · 베이스 · 나머지(피아노·기타 등) · 보컬 (점이 진할수록 셈)
  3) AI 채보 4줄 (파랑, 강타는 노랑) · 기존 채보 4줄 (주황)
  세로선: 흰 점선 = 1초, 회색 = 박 (분석한 박자)
  줄 왼쪽 위 숫자 = 그 줄이 시작하는 시각(초)

필요한 것: numpy · librosa (AI 채보 도구 가상환경에 이미 있음). 그림은 PNG로 직접 써요 (다른 부품 없음)
"""
import json
import struct
import zlib
from pathlib import Path

PX_PER_SEC = 200          # 5ms = 1칸
ROW_SEC = 8
ROWS_PER_IMG = 4
SPEC_H = 128
STEM_H = 12
LANE_H = 10
PAD = 6
STEMS = ("drums", "bass", "other", "vocals")
STEM_COL = {"drums": (255, 110, 110), "bass": (120, 200, 255), "other": (140, 255, 160), "vocals": (255, 200, 120)}
AI_COL, ACC_COL, BASIC_COL = (90, 190, 255), (255, 230, 90), (255, 150, 70)

# 3×5 숫자 글꼴 (줄 시작 시각 표시용)
FONT = {
    "0": "111101101101111", "1": "010110010010111", "2": "111001111100111", "3": "111001111001111",
    "4": "101101111001001", "5": "111100111001111", "6": "111100111101111", "7": "111001001001001",
    "8": "111101111101111", "9": "111101111001111", "s": "000011100001110", ".": "000000000000010",
}


def save_png(path, rgb):
    """RGB(높이×폭×3, uint8) → PNG 파일"""
    import numpy as np
    h, w, _ = rgb.shape
    raw = b"".join(b"\x00" + rgb[y].astype(np.uint8).tobytes() for y in range(h))

    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) + \
        chunk(b"IDAT", zlib.compress(raw, 6)) + chunk(b"IEND", b"")
    Path(path).write_bytes(png)


def text(img, x, y, s, col=(230, 230, 240), k=2):
    for ch in s:
        g = FONT.get(ch)
        if g:
            for i, b in enumerate(g):
                if b == "1":
                    yy, xx = y + (i // 3) * k, x + (i % 3) * k
                    img[yy:yy + k, xx:xx + k] = col
        x += 4 * k


def colormap(v):
    """0~1 → 검정·보라·주황·노랑"""
    import numpy as np
    stops = np.array([[8, 8, 16], [70, 20, 110], [200, 60, 80], [255, 170, 40], [255, 250, 200]], dtype=np.float32)
    v = np.clip(v, 0, 1) * (len(stops) - 1)
    i = np.minimum(v.astype(int), len(stops) - 2)
    f = (v - i)[..., None]
    return (stops[i] * (1 - f) + stops[i + 1] * f).astype(np.uint8)


def render(wav, song, out_dir, diffs=("hard",), stems=None, title=""):
    """wav(22050Hz 모노) + 서버 곡 데이터 → out_dir에 PNG 여러 장 + index.json. 만든 파일 목록을 돌려줌"""
    import numpy as np
    import librosa
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    y, sr = librosa.load(str(wav), sr=22050, mono=True)
    dur = len(y) / sr
    hop = 256
    mel = librosa.feature.melspectrogram(y=y, sr=sr, n_fft=2048, hop_length=hop, n_mels=SPEC_H, fmax=11000)
    db = librosa.power_to_db(mel, ref=np.max)
    spec = np.clip((db + 70) / 70, 0, 1)[::-1]          # 위가 높은 소리
    fps = sr / hop
    if stems and stems.get("beats"):
        beats = stems["beats"]
    else:
        _, bf = librosa.beat.beat_track(y=y, sr=sr, hop_length=512)
        beats = list(librosa.frames_to_time(bf, sr=sr, hop_length=512))
    shift = float(song.get("noteShift") or 0) / 1000
    ai = (song.get("ai") or {}).get("charts") or {}
    basic = song.get("charts") or {}
    row_h = SPEC_H + PAD + STEM_H * len(STEMS) + PAD + LANE_H * 4 + 3 + LANE_H * 4 + PAD * 2
    W = PX_PER_SEC * ROW_SEC
    files = []
    n_img = int(np.ceil(dur / (ROW_SEC * ROWS_PER_IMG)))
    for d in diffs:
        ain = sorted(ai.get(d) or [], key=lambda n: n["t"])
        bn = sorted(basic.get(d) or [], key=lambda n: n["t"])
        for k in range(n_img):
            img = np.zeros((row_h * ROWS_PER_IMG, W, 3), dtype=np.uint8)
            img[:] = (14, 16, 26)
            for r in range(ROWS_PER_IMG):
                t0 = (k * ROWS_PER_IMG + r) * ROW_SEC
                if t0 >= dur:
                    break
                oy = r * row_h
                # 1) 스펙트로그램
                cols = np.clip(((t0 + np.arange(W) / PX_PER_SEC) * fps).astype(int), 0, spec.shape[1] - 1)
                img[oy:oy + SPEC_H] = colormap(spec[:, cols])
                y1 = oy + SPEC_H + PAD
                # 2) 소리별 시작 위치
                for si, name in enumerate(STEMS):
                    yy = y1 + si * STEM_H
                    img[yy + STEM_H - 1, :] = (30, 34, 50)
                    st = (stems or {}).get("stems", {}).get(name)
                    if not st:
                        continue
                    for t, strength, _ in st["on"]:
                        if t0 <= t < t0 + ROW_SEC:
                            x = int((t - t0) * PX_PER_SEC)
                            a = min(1.0, 0.25 + 0.75 * float(strength))
                            img[yy + 1:yy + STEM_H - 2, max(0, x - 2):x + 3] = (np.array(STEM_COL[name]) * a).astype(np.uint8)
                y2 = y1 + STEM_H * len(STEMS) + PAD
                # 3) 채보 (AI · 기존)
                for base_y, notes, col in ((y2, ain, AI_COL), (y2 + LANE_H * 4 + 3, bn, BASIC_COL)):
                    for ln in range(4):
                        img[base_y + ln * LANE_H + LANE_H - 1, :] = (30, 34, 50)
                    for n in notes:
                        t = float(n["t"]) + shift
                        if t > t0 + ROW_SEC:
                            break
                        dd = float(n.get("d", 0) or 0)
                        if t + dd < t0:
                            continue
                        ln = int(n.get("l", 0)) % 4
                        yy = base_y + ln * LANE_H
                        x = int((t - t0) * PX_PER_SEC)
                        c = ACC_COL if (n.get("a") and col == AI_COL) else col
                        if dd > 0:
                            x2 = int((t + dd - t0) * PX_PER_SEC)
                            img[yy + 3:yy + LANE_H - 4, max(0, x):max(0, min(W, x2))] = (np.array(c) * 0.5).astype(np.uint8)
                        if 0 <= x < W:
                            img[yy + 1:yy + LANE_H - 2, max(0, x - 2):x + 3] = c
                # 세로선: 박(회색) · 1초(흰 점선)
                for b in beats:
                    if t0 <= b < t0 + ROW_SEC:
                        x = int((b - t0) * PX_PER_SEC)
                        img[oy + SPEC_H:oy + row_h - PAD, x] = np.maximum(img[oy + SPEC_H:oy + row_h - PAD, x], 70)
                for s in range(ROW_SEC + 1):
                    x = min(W - 1, s * PX_PER_SEC)
                    img[oy:oy + row_h - PAD:3, x] = (200, 200, 210)
                text(img, 4, oy + 4, f"{t0}s")
                for s in range(2, ROW_SEC, 2):
                    text(img, s * PX_PER_SEC + 3, oy + 4, f"{t0 + s}", col=(170, 170, 185), k=1)
            name = f"{d}_{k * ROWS_PER_IMG * ROW_SEC:03d}.png"
            save_png(out_dir / name, img)
            files.append(name)
    idx = {"title": title or song.get("title", ""), "duration": round(dur, 2), "rowSec": ROW_SEC, "rowsPerImage": ROWS_PER_IMG,
           "noteShiftMs": float(song.get("noteShift") or 0), "diffs": list(diffs), "files": files,
           "aiNotes": {d: len((ai.get(d) or [])) for d in diffs}, "basicNotes": {d: len((basic.get(d) or [])) for d in diffs},
           "legend": "row: spectrogram | drums bass other vocals onsets | AI chart 4 lanes (blue, yellow=accent) | basic chart 4 lanes (orange)"}
    (out_dir / "index.json").write_text(json.dumps(idx, ensure_ascii=False, indent=1), encoding="utf-8")
    return files
