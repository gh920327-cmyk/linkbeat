"""
링크비트 AI 캐릭터 그리기 — 호스트 PC의 ComfyUI(파이썬)로 실행돼요 (채보 엔진 worker.py가 부름)
 - 캐릭터 설정(머리·옷·액세서리…) → 애니풍 일러스트 1장 + 꼬마 전신 1장을 ComfyUI로 그림
 - 꼬마 전신은 배경을 지우고 작게 줄여서 도트(픽셀) 캐릭터로 만듦
 - ComfyUI가 이미 켜져 있으면(8188) 그걸 쓰고, 아니면 잠깐 따로 켰다가(8190) 끝나면 끔
 - 기존 워크플로·설정은 건드리지 않음 (그림은 API로만 요청하고, 만든 파일은 가져온 뒤 지움)

사용: python avatar_gen.py --comfy <ComfyUI_windows_portable 폴더> --spec spec.json --out <폴더>
진행 상황은 한 줄 JSON {"p": "..."} 로 출력, 끝나면 <폴더>/illust.webp · pixel.png
"""
import argparse
import io
import json
import os
import random
import subprocess
import sys
import time
import urllib.parse
import urllib.request
import uuid
from pathlib import Path

CKPT = "animagine-xl-4.0.safetensors"
USER_PORT, OWN_PORT = 8188, 8190

GENDER = {"girl": "1girl", "boy": "1boy, male focus"}
HAIR = {"short": "short hair", "long": "long hair", "twin": "twintails", "spiky": "spiked hair", "bob": "bob cut"}
HAIR_COLOR = ["black hair", "brown hair", "blonde hair", "pink hair", "blue hair", "purple hair", "white hair", "orange hair"]
EYES = {"dot": "round eyes", "happy": "happy, smile, closed eyes", "sparkle": "sparkling eyes, open mouth", "sleepy": "half-closed eyes, sleepy"}
OUTFIT = {"hoodie": "hoodie", "jacket": "jacket", "dress": "dress"}
OUTFIT_COLOR = ["blue", "pink", "mint green", "yellow", "grey", "red", "purple", "black"]
ACC = {"none": "", "phones": "headphones", "cap": "baseball cap", "ribbon": "hair ribbon", "cat": "cat ears", "glasses": "glasses"}
SKIN = ["", "", "tan", "dark skin"]
QUALITY = "masterpiece, high score, great score, absurdres"
NEG = ("lowres, bad anatomy, bad hands, text, error, missing finger, extra digits, fewer digits, cropped, worst quality, "
       "low quality, low score, bad score, average score, signature, watermark, username, blurry, nsfw")


def say(msg):
    print(json.dumps({"p": msg}, ensure_ascii=False), flush=True)


def idx(lst, v, d=0):
    return lst[v] if isinstance(v, int) and 0 <= v < len(lst) else lst[d]


def tags(a):
    """캐릭터 설정 → 그림 설명(태그)"""
    g = GENDER.get(a.get("gender"), GENDER["girl"])
    outfit = f"{idx(OUTFIT_COLOR, a.get('outfitColor'))} {OUTFIT.get(a.get('outfit'), 'hoodie')}"
    parts = [HAIR.get(a.get("hair"), "twintails"), idx(HAIR_COLOR, a.get("hairColor"), 3), EYES.get(a.get("eyes"), ""),
             outfit, ACC.get(a.get("acc"), ""), idx(SKIN, a.get("skin"))]
    return g, ", ".join(p for p in parts if p)


def prompts(a):
    g, look = tags(a)
    illust = (f"{g}, solo, {look}, upper body, looking at viewer, smile, music, rhythm game, dynamic pose, "
              f"colorful, vibrant, neon lights, gradient background, {QUALITY}")
    chibi = (f"{g}, solo, chibi, super deformed, 2.5 heads tall, cute, {look}, full body, standing, front view, arms at sides, "
             f"game sprite, simple background, white background, thick outline, flat color, cel shading, {QUALITY}")
    chibi_neg = NEG + ", shadow, gradient background, scenery, multiple views, character sheet, reference sheet, close-up, portrait, cropped feet"
    return (illust, NEG, 896, 1152), (chibi, chibi_neg, 1024, 1024)


def workflow(pos, neg, w, h, seed, prefix):
    return {
        "1": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": CKPT}},
        "2": {"class_type": "CLIPTextEncode", "inputs": {"text": pos, "clip": ["1", 1]}},
        "3": {"class_type": "CLIPTextEncode", "inputs": {"text": neg, "clip": ["1", 1]}},
        "4": {"class_type": "EmptyLatentImage", "inputs": {"width": w, "height": h, "batch_size": 1}},
        "5": {"class_type": "KSampler", "inputs": {"seed": seed, "steps": 28, "cfg": 5.0, "sampler_name": "euler_ancestral",
                                                  "scheduler": "normal", "denoise": 1.0, "model": ["1", 0],
                                                  "positive": ["2", 0], "negative": ["3", 0], "latent_image": ["4", 0]}},
        "6": {"class_type": "VAEDecode", "inputs": {"samples": ["5", 0], "vae": ["1", 2]}},
        "7": {"class_type": "SaveImage", "inputs": {"images": ["6", 0], "filename_prefix": prefix}},
    }


# ------------------------------------------------------------------ ComfyUI
class Comfy:
    def __init__(self, root):
        self.root = Path(root)
        self.proc = None
        self.base = None

    def _alive(self, port):
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{port}/system_stats", timeout=3) as r:
                return r.status == 200
        except Exception:
            return False

    def start(self):
        if self._alive(USER_PORT):
            self.base = f"http://127.0.0.1:{USER_PORT}"
            say("켜져 있는 ComfyUI를 써요")
            return
        if self._alive(OWN_PORT):
            self.base = f"http://127.0.0.1:{OWN_PORT}"
            return
        py = self.root / "python_embeded" / "python.exe"
        main = self.root / "ComfyUI" / "main.py"
        if not py.exists() or not main.exists():
            raise RuntimeError("ComfyUI를 찾을 수 없어요.")
        say("ComfyUI 켜는 중... (처음엔 1~2분)")
        flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        log = open(self.root / "linkbeat_comfy.log", "w", encoding="utf-8", errors="replace")
        self.proc = subprocess.Popen([str(py), "-s", str(main), "--windows-standalone-build", "--disable-auto-launch",
                                      "--listen", "127.0.0.1", "--port", str(OWN_PORT)],
                                     cwd=str(self.root), stdout=log, stderr=subprocess.STDOUT, creationflags=flags)
        t0 = time.time()
        while time.time() - t0 < 300:
            if self.proc.poll() is not None:
                raise RuntimeError("ComfyUI가 켜지다가 꺼졌어요 (linkbeat_comfy.log 확인).")
            if self._alive(OWN_PORT):
                self.base = f"http://127.0.0.1:{OWN_PORT}"
                return
            time.sleep(2)
        raise RuntimeError("ComfyUI가 5분 안에 켜지지 않았어요.")

    def stop(self):
        if self.proc and self.proc.poll() is None:
            self.proc.terminate()
            try:
                self.proc.wait(20)
            except Exception:
                self.proc.kill()

    def _json(self, path, body=None, timeout=30):
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(self.base + path, data=data, headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8") or "{}")

    def run(self, wf, label):
        """워크플로 하나 실행 → PNG 바이트 (ComfyUI output 폴더에 남은 파일은 지움)"""
        r = self._json("/prompt", {"prompt": wf, "client_id": uuid.uuid4().hex})
        pid = r.get("prompt_id")
        if not pid:
            raise RuntimeError(f"ComfyUI가 요청을 받지 않았어요: {str(r)[:200]}")
        t0 = time.time()
        while time.time() - t0 < 600:
            h = self._json(f"/history/{pid}")
            item = h.get(pid)
            if item:
                st = item.get("status") or {}
                if st.get("status_str") == "error":
                    msgs = [m for m in st.get("messages", []) if m and m[0] == "execution_error"]
                    raise RuntimeError("ComfyUI 오류: " + (str(msgs[0][1].get("exception_message", ""))[:200] if msgs else ""))
                for out in (item.get("outputs") or {}).values():
                    for im in out.get("images") or []:
                        q = urllib.parse.urlencode({"filename": im["filename"], "subfolder": im.get("subfolder", ""), "type": im.get("type", "output")})
                        with urllib.request.urlopen(f"{self.base}/view?{q}", timeout=60) as rr:
                            data = rr.read()
                        try:      # 우리가 만든 파일만 지움
                            f = self.root / "ComfyUI" / "output" / im.get("subfolder", "") / im["filename"]
                            if "linkbeat_avatar" in str(f):
                                f.unlink()
                        except OSError:
                            pass
                        return data
            say(f"{label} 그리는 중... ({int(time.time() - t0)}초)")
            time.sleep(2)
        raise RuntimeError("그림이 10분 안에 끝나지 않았어요.")


# ------------------------------------------------------------------ 도트로 만들기
def pixelize(png, height=64, colors=24):
    """꼬마 전신 그림 → 배경 지우고 작게 줄인 도트 캐릭터 (투명 배경 PNG, 1픽셀 외곽선)"""
    import numpy as np
    from PIL import Image
    im = Image.open(io.BytesIO(png)).convert("RGB")
    W0, H0 = im.size
    S = 256
    small = np.asarray(im.resize((S, S), Image.LANCZOS)).astype(np.int16)
    near = (small.min(axis=2) > 222) & ((small.max(axis=2) - small.min(axis=2)) < 28)
    bg = np.zeros_like(near)
    bg[0, :], bg[-1, :], bg[:, 0], bg[:, -1] = near[0, :], near[-1, :], near[:, 0], near[:, -1]
    for _ in range(S * 2):                      # 가장자리에서 이어진 흰 바탕만 (옷의 흰 부분은 남김)
        grow = bg.copy()
        grow[1:, :] |= bg[:-1, :]
        grow[:-1, :] |= bg[1:, :]
        grow[:, 1:] |= bg[:, :-1]
        grow[:, :-1] |= bg[:, 1:]
        grow &= near
        if (grow == bg).all():
            break
        bg = grow
    fg = ~bg
    ys, xs = np.where(fg)
    if len(ys) < 200:
        raise RuntimeError("캐릭터를 찾지 못했어요 (바탕만 그려졌어요).")
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    sx, sy = W0 / S, H0 / S
    box = (int(x0 * sx), int(y0 * sy), int(x1 * sx), int(y1 * sy))
    crop = im.crop(box)
    mask = Image.fromarray((fg[y0:y1, x0:x1] * 255).astype("uint8")).resize(crop.size, Image.NEAREST)
    h = height
    w = max(8, round(h * crop.size[0] / crop.size[1]))
    if w > height * 1.2:                         # 너무 넓으면 폭 기준
        w = int(height * 1.2)
        h = max(8, round(w * crop.size[1] / crop.size[0]))
    ca = np.asarray(crop).copy()
    cm = np.asarray(mask) > 0
    if cm.any():
        ca[~cm] = ca[cm].mean(axis=0).astype("uint8")   # 줄일 때 흰 바탕이 가장자리에 번지지 않게
    rgb = Image.fromarray(ca).resize((w, h), Image.BOX)
    alpha = np.asarray(mask.resize((w, h), Image.BOX)) > 110
    arr = np.asarray(rgb).copy()
    if alpha.any():
        arr[~alpha] = arr[alpha].mean(axis=0).astype("uint8")   # 바탕 색이 색 줄이기에 끼지 않게
    q = Image.fromarray(arr).quantize(colors=colors, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).convert("RGB")
    qa = np.asarray(q)
    out = np.zeros((h + 2, w + 2, 4), dtype="uint8")
    out[1:-1, 1:-1, :3] = qa
    out[1:-1, 1:-1, 3] = alpha * 255
    a = out[:, :, 3] > 0
    edge = np.zeros_like(a)
    edge[1:, :] |= a[:-1, :]
    edge[:-1, :] |= a[1:, :]
    edge[:, 1:] |= a[:, :-1]
    edge[:, :-1] |= a[:, 1:]
    edge &= ~a
    out[edge] = (27, 20, 48, 255)                # 외곽선 (기존 도트 캐릭터와 같은 색)
    buf = io.BytesIO()
    Image.fromarray(out, "RGBA").save(buf, "PNG", optimize=True)
    return buf.getvalue()


def to_webp(png, quality=88):
    from PIL import Image
    buf = io.BytesIO()
    Image.open(io.BytesIO(png)).convert("RGB").save(buf, "WEBP", quality=quality, method=5)
    return buf.getvalue()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--comfy", required=True)
    ap.add_argument("--spec", required=True)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    spec = json.loads(Path(a.spec).read_text(encoding="utf-8"))
    av = spec.get("avatar") or {}
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    (il_p, il_n, il_w, il_h), (ch_p, ch_n, ch_w, ch_h) = prompts(av)
    comfy = Comfy(a.comfy)
    try:
        comfy.start()
        seed = random.randint(1, 2 ** 31)
        say("일러스트 그리는 중...")
        il = comfy.run(workflow(il_p, il_n, il_w, il_h, seed, "linkbeat_avatar/illust"), "일러스트")
        (out / "illust.webp").write_bytes(to_webp(il))
        say("도트용 꼬마 캐릭터 그리는 중...")
        ch = comfy.run(workflow(ch_p, ch_n, ch_w, ch_h, seed + 1, "linkbeat_avatar/chibi"), "꼬마 캐릭터")
        (out / "pixel.png").write_bytes(pixelize(ch))
        say("완성!")
    finally:
        comfy.stop()


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(json.dumps({"error": str(e)[:300]}, ensure_ascii=False), flush=True)
        sys.exit(1)
