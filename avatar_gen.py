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


BANNED = ("nsfw", "nude", "naked", "sex", "nipple", "breast", "cleavage", "underwear", "panties", "lingerie", "bikini",
          "erotic", "hentai", "gore", "blood", "loli", "shota", "child", "explicit", "questionable", "sensitive")


def clean_tags(text, limit=30):
    """영어 태그만 남김 (이상한 글자·성인 태그는 뺌)"""
    import re
    out = []
    for t in re.split(r"[,\n]+", str(text).lower()):
        t = re.sub(r"[^a-z0-9 _()'\-:.]", "", t).strip(" .")
        if not t or len(t) > 40 or any(b in t for b in BANNED):
            continue
        if t not in out:
            out.append(t)
    return ", ".join(out[:limit])


def prompts(a, desc="", use_look=True):
    g, look = tags(a)
    parts = [p for p in (f"({desc}:1.15)" if desc else "", look if use_look or not desc else "") if p]
    who = ", ".join(parts)
    illust = (f"{g}, solo, {who}, upper body, looking at viewer, music, rhythm game, dynamic pose, "
              f"colorful, vibrant, gradient background, safe, {QUALITY}")
    chibi = (f"{g}, solo, chibi, super deformed, 2.5 heads tall, cute, {who}, full body, standing, front view, arms at sides, "
             f"game sprite, simple background, white background, plain white background, no background, thick outline, flat color, cel shading, safe, {QUALITY}")
    chibi_neg = NEG + (", shadow, drop shadow, ground, floor, gradient background, colored background, scenery, border, frame, "
                       "multiple views, character sheet, reference sheet, close-up, portrait, cropped feet, text")
    return (illust, NEG, 896, 1152), (chibi, chibi_neg, 1024, 1024)


# ------------------------------------------------------------------ 글 → 영어 태그 (PC의 Ollama)
OLLAMA = "http://127.0.0.1:11434"
TAG_SYSTEM = ("You turn a character description (often Korean) into English Danbooru-style tags for an anime image model. "
              "Output ONLY lowercase comma-separated tags, at most 25: hair, eyes, face, expression, clothing, colors, accessories, "
              "props, mood. No sentences, no explanations, no real person names, no sexual content.")


def _ollama(path, body=None, timeout=10):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(OLLAMA + path, data=data, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8") or "{}")


def start_ollama(comfy_root):
    """꺼져 있으면 켜기: LB_OLLAMA_EXE → ComfyUI가 있는 드라이브의 Ollama\\ollama.exe → 기본 설치 위치"""
    try:
        _ollama("/api/tags", timeout=3)
        return None
    except Exception:
        pass
    drive = Path(comfy_root).anchor or ""
    cands = [os.environ.get("LB_OLLAMA_EXE", ""), str(Path(drive) / "Ollama" / "ollama.exe"),
             os.path.expandvars(r"%LOCALAPPDATA%\Programs\Ollama\ollama.exe")]
    exe = next((c for c in cands if c and Path(c).is_file()), None)
    if not exe:
        return None
    env = dict(os.environ)
    models = Path(exe).parent / "models"
    if models.is_dir() and not env.get("OLLAMA_MODELS"):
        env["OLLAMA_MODELS"] = str(models)
    flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    proc = subprocess.Popen([exe, "serve"], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=flags)
    for _ in range(30):
        time.sleep(1)
        try:
            _ollama("/api/tags", timeout=3)
            return proc
        except Exception:
            pass
    proc.terminate()
    return None


def desc_to_tags(desc, comfy_root):
    """원하는 모습(글) → 영어 태그. 영어로 쓴 건 그대로, 한글은 Ollama로 바꿈 (끝나면 모델을 메모리에서 내림)"""
    desc = str(desc or "").strip()[:200]
    if not desc:
        return ""
    if all(ord(c) < 128 for c in desc):
        return clean_tags(desc)
    proc = start_ollama(comfy_root)
    try:
        names = [m.get("name", "") for m in _ollama("/api/tags").get("models", [])]
        if not names:
            raise RuntimeError("Ollama에 모델이 없어요.")
        model = next((n for n in names if n.startswith("qwen")), names[0])
        say("원하는 모습을 그림용 말로 바꾸는 중...")
        r = _ollama("/api/chat", {"model": model, "stream": False, "think": False, "keep_alive": 0,
                                  "options": {"temperature": 0.2},
                                  "messages": [{"role": "system", "content": TAG_SYSTEM}, {"role": "user", "content": desc}]}, timeout=180)
        text = (r.get("message") or {}).get("content", "")
        import re
        text = re.sub(r"<think>.*?</think>", "", text, flags=re.S)
        tags_ = clean_tags(text)
        say(f"그림 설명: {tags_[:120]}")
        return tags_
    except Exception as e:
        say(f"원하는 모습을 바꾸지 못해서 캐릭터 설정으로만 그려요 ({str(e)[:80]})")
        return ""
    finally:
        if proc:
            proc.terminate()


def workflow(pos, neg, w, h, seed, prefix, ref=None, ref_w=0.0, base=None, denoise=1.0):
    wf = {
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
    if ref and ref_w > 0:       # 참고 사진: IP-Adapter(SDXL)로 분위기·생김새를 따라감
        wf["8"] = {"class_type": "LoadImage", "inputs": {"image": ref}}
        wf["9"] = {"class_type": "IPAdapterModelLoader", "inputs": {"ipadapter_file": IPA_FILE}}
        wf["10"] = {"class_type": "CLIPVisionLoader", "inputs": {"clip_name": CLIPV_FILE}}
        wf["11"] = {"class_type": "IPAdapterAdvanced", "inputs": {"model": ["1", 0], "ipadapter": ["9", 0], "image": ["8", 0],
                                                                 "clip_vision": ["10", 0], "weight": ref_w, "weight_type": "linear",
                                                                 "combine_embeds": "concat", "start_at": 0.0, "end_at": 1.0,
                                                                 "embeds_scaling": "V only"}}
        wf["5"]["inputs"]["model"] = ["11", 0]
    if base:                    # 동작 그림: 기본 자세 그림에서 출발 (같은 구도·같은 색)
        wf["12"] = {"class_type": "LoadImage", "inputs": {"image": base}}
        wf["13"] = {"class_type": "VAEEncode", "inputs": {"pixels": ["12", 0], "vae": ["1", 2]}}
        wf["5"]["inputs"]["latent_image"] = ["13", 0]
        wf["5"]["inputs"]["denoise"] = denoise
        del wf["4"]
    return wf


IPA_FILE = "ip-adapter-plus_sdxl_vit-h.safetensors"
CLIPV_FILE = "CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors"
REF_WEIGHT = {"low": (0.45, 0.3), "mid": (0.65, 0.45), "high": (0.85, 0.6)}   # (일러스트, 꼬마 도트)


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

    def upload(self, path, prefix="linkbeat_ref"):
        """그림(참고 사진·기본 자세)을 ComfyUI input 폴더에 올림 → LoadImage에 넣을 이름 (끝나면 지움)"""
        boundary = uuid.uuid4().hex
        name = f"{prefix}_{uuid.uuid4().hex[:8]}{Path(path).suffix or '.jpg'}"
        body = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"image\"; filename=\"{name}\"\r\n"
                f"Content-Type: application/octet-stream\r\n\r\n").encode() + Path(path).read_bytes() + \
            f"\r\n--{boundary}\r\nContent-Disposition: form-data; name=\"overwrite\"\r\n\r\ntrue\r\n--{boundary}--\r\n".encode()
        req = urllib.request.Request(self.base + "/upload/image", data=body,
                                     headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})
        with urllib.request.urlopen(req, timeout=60) as r:
            d = json.loads(r.read().decode("utf-8"))
        self.uploaded = getattr(self, "uploaded", []) + [self.root / "ComfyUI" / "input" / d.get("subfolder", "") / d["name"]]
        return f"{d['subfolder']}/{d['name']}" if d.get("subfolder") else d["name"]

    def cleanup(self):
        for f in getattr(self, "uploaded", []):
            try:
                if "linkbeat_ref_" in f.name:
                    f.unlink()
            except OSError:
                pass

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
# 동작 그림 순서 (게임의 캐릭터 동작과 같은 순서): 기본 · 치기(왼) · 치기(오른, 뒤집기) · 점프 · 슬픔
FRAMES = ("idle", "left", "right", "up", "sad")
POSES = {   # 기본 자세 그림에서 출발해 동작만 바꿈 (denoise가 클수록 많이 바뀜)
    "hit": ("standing, front view, one arm raised, fist pump, energetic, open mouth, smile", 0.6),
    "up": ("jumping, both arms up, arms raised, very happy, open mouth, closed eyes, front view", 0.66),
    "sad": ("standing, front view, sad, closed eyes, frown, sweatdrop, slumped shoulders, arms at sides", 0.5),
}


def _fg_mask(im, S=256):
    """캐릭터 부분 찾기: 테두리에서 바탕 색을 알아내고, 테두리와 이어진 '바탕 색에 가깝고 매끈한' 곳을 모두 지움
    (흰 바탕이 아니어도·연한 그라데이션이어도 지워지고, 외곽선 안쪽 같은 색 옷은 남음) + 작은 부스러기 지움"""
    import numpy as np
    from PIL import Image
    small = np.asarray(im.resize((S, S), Image.LANCZOS)).astype(np.float32)
    border = np.concatenate([small[0], small[-1], small[:, 0], small[:, -1]])
    bgc = np.median(border, axis=0)
    dist = np.sqrt(((small - bgc) ** 2).sum(axis=2))
    gy = np.abs(np.diff(small, axis=0, append=small[-1:])).sum(axis=2)
    gx = np.abs(np.diff(small, axis=1, append=small[:, -1:])).sum(axis=2)
    smooth = np.maximum(gx, gy) < 36
    near = (dist < 34) | ((dist < 95) & smooth)
    bg = np.zeros_like(near)
    bg[0, :], bg[-1, :], bg[:, 0], bg[:, -1] = near[0, :], near[-1, :], near[:, 0], near[:, -1]
    for _ in range(S * 3):
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
    # 덩어리마다 크기를 재서, 가장 큰 덩어리의 3%보다 작은 부스러기(바탕 얼룩·글자)는 지움
    lab = np.zeros((S, S), dtype=np.int32)
    sizes = [0]
    for y0 in range(S):
        for x0 in range(S):
            if fg[y0, x0] and not lab[y0, x0]:
                n = len(sizes)
                stack, cnt = [(y0, x0)], 0
                lab[y0, x0] = n
                while stack:
                    y, x = stack.pop()
                    cnt += 1
                    for yy, xx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
                        if 0 <= yy < S and 0 <= xx < S and fg[yy, xx] and not lab[yy, xx]:
                            lab[yy, xx] = n
                            stack.append((yy, xx))
                sizes.append(cnt)
    if len(sizes) > 1:
        big = max(sizes)
        keep = np.array([False] + [c >= big * 0.03 for c in sizes[1:]])
        fg = keep[lab]
    return fg


def pixel_sheet(pngs, height=64, colors=24):
    """꼬마 그림 여러 장(기본·치기·점프·슬픔) → 같은 크기·같은 발 위치·같은 색 팔레트의 도트 동작 그림들
    → (기본 한 장 PNG, 동작 줄 PNG [기본·치기 왼·치기 오른(뒤집기)·점프·슬픔])"""
    import numpy as np
    from PIL import Image
    ims = [Image.open(io.BytesIO(b)).convert("RGB") for b in pngs]
    W0, H0 = ims[0].size
    S = 256
    masks = [_fg_mask(im, S) for im in ims]
    if masks[0].sum() < 200:
        raise RuntimeError("캐릭터를 찾지 못했어요 (바탕만 그려졌어요).")
    for i in range(1, len(masks)):              # 동작 그림이 망가졌으면(캐릭터가 없거나 너무 다르면) 기본 자세로
        if masks[i].sum() < masks[0].sum() * 0.4 or masks[i].sum() > masks[0].sum() * 2.5:
            ims[i], masks[i] = ims[0], masks[0]
    union = np.logical_or.reduce(masks)
    ys, xs = np.where(union)
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    sx, sy = W0 / S, H0 / S
    box = (int(x0 * sx), int(y0 * sy), int(x1 * sx), int(y1 * sy))
    cw, ch = box[2] - box[0], box[3] - box[1]
    h = height
    w = max(8, round(h * cw / ch))
    if w > height * 1.3:
        w = int(height * 1.3)
        h = max(8, round(w * ch / cw))
    frames, pal = [], None
    for im, m in zip(ims, masks):
        crop = im.crop(box)
        mask = Image.fromarray((m[y0:y1, x0:x1] * 255).astype("uint8")).resize(crop.size, Image.NEAREST)
        ca = np.asarray(crop).copy()
        cm = np.asarray(mask) > 0
        if cm.any():
            ca[~cm] = ca[cm].mean(axis=0).astype("uint8")   # 줄일 때 흰 바탕이 가장자리에 번지지 않게
        rgb = Image.fromarray(ca).resize((w, h), Image.BOX)
        alpha = np.asarray(mask.resize((w, h), Image.BOX)) > 110
        arr = np.asarray(rgb).copy()
        if alpha.any():
            arr[~alpha] = arr[alpha].mean(axis=0).astype("uint8")
        img = Image.fromarray(arr)
        if pal is None:                             # 색 팔레트는 기본 자세에서 정하고 모든 동작에 같이 씀 (색 깜빡임 방지)
            pal = img.quantize(colors=colors, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
            q = pal
        else:
            q = img.quantize(palette=pal, dither=Image.Dither.NONE)
        out = np.zeros((h + 2, w + 2, 4), dtype="uint8")
        out[1:-1, 1:-1, :3] = np.asarray(q.convert("RGB"))
        out[1:-1, 1:-1, 3] = alpha * 255
        a = out[:, :, 3] > 0
        edge = np.zeros_like(a)
        edge[1:, :] |= a[:-1, :]
        edge[:-1, :] |= a[1:, :]
        edge[:, 1:] |= a[:, :-1]
        edge[:, :-1] |= a[:, 1:]
        edge &= ~a
        out[edge] = (27, 20, 48, 255)               # 외곽선 (기존 도트 캐릭터와 같은 색)
        frames.append(Image.fromarray(out, "RGBA"))
    base = frames[0]
    hit = frames[1] if len(frames) > 1 else base
    up = frames[2] if len(frames) > 2 else base
    sad = frames[3] if len(frames) > 3 else base
    seq = [base, hit, hit.transpose(Image.FLIP_LEFT_RIGHT), up, sad]
    fw, fh = base.size
    sheet = Image.new("RGBA", (fw * len(seq), fh), (0, 0, 0, 0))
    for i, f in enumerate(seq):
        sheet.paste(f, (i * fw, 0))

    def png(im):
        buf = io.BytesIO()
        im.save(buf, "PNG", optimize=True)
        return buf.getvalue()
    return png(base), png(sheet)


def pixelize(png, height=64, colors=24):
    """꼬마 전신 그림 한 장 → 도트 한 장 (예전 방식, 시험용)"""
    return pixel_sheet([png], height, colors)[0]


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
    desc = desc_to_tags(spec.get("desc", ""), a.comfy)          # ComfyUI보다 먼저 (그래픽카드 메모리가 겹치지 않게)
    (il_p, il_n, il_w, il_h), (ch_p, ch_n, ch_w, ch_h) = prompts(av, desc, spec.get("useLook", True) is not False)
    ref = spec.get("ref") if spec.get("ref") and Path(spec["ref"]).is_file() else None
    rw = REF_WEIGHT.get(spec.get("strength"), REF_WEIGHT["mid"])
    comfy = Comfy(a.comfy)
    try:
        comfy.start()
        ref_name = comfy.upload(ref) if ref else None
        seed = random.randint(1, 2 ** 31)
        if spec.get("mode") != "pixel":           # pixel: 일러스트는 그대로 두고 도트만
            say("일러스트 그리는 중..." + (" (참고 사진 반영)" if ref_name else ""))
            il = comfy.run(workflow(il_p, il_n, il_w, il_h, seed, "linkbeat_avatar/illust", ref_name, rw[0]), "일러스트")
            (out / "illust.webp").write_bytes(to_webp(il))
        say("도트용 꼬마 캐릭터 그리는 중...")
        ch = comfy.run(workflow(ch_p, ch_n, ch_w, ch_h, seed + 1, "linkbeat_avatar/chibi", ref_name, rw[1]), "꼬마 캐릭터")
        base_file = out / "chibi_base.png"
        base_file.write_bytes(ch)
        base_name = comfy.upload(base_file, "linkbeat_ref_base")
        poses = []
        for k, (key, (pose, dn)) in enumerate(POSES.items()):     # 같은 캐릭터로 동작만 바꿔 그림 (생김새는 IP-Adapter로 붙잡음)
            say(f"동작 그리는 중... ({k + 1}/{len(POSES)})")
            pp = ch_p.replace("full body, standing, front view, arms at sides", "full body, " + pose)
            try:
                poses.append(comfy.run(workflow(pp, ch_n, ch_w, ch_h, seed + 1, f"linkbeat_avatar/pose_{key}",
                                                base_name, 0.8, base=base_name, denoise=dn), "동작"))
            except Exception as e:
                say(f"동작 하나를 못 그렸어요 ({str(e)[:60]}) — 기본 자세로 대신해요")
                poses.append(ch)
        one, sheet = pixel_sheet([ch] + poses)
        (out / "pixel.png").write_bytes(one)
        (out / "sheet.png").write_bytes(sheet)
        say("완성!")
    finally:
        comfy.cleanup()
        comfy.stop()


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(json.dumps({"error": str(e)[:300]}, ensure_ascii=False), flush=True)
        sys.exit(1)
