"""
링크비트 AI 캐릭터 그리기 — 호스트 PC의 ComfyUI(파이썬)로 실행돼요 (채보 엔진 worker.py가 부름)
 - 캐릭터 설정(머리·옷·액세서리…) → 애니풍 일러스트 1장 + 꼬마 전신 1장을 ComfyUI로 그림
 - 꼬마 전신은 배경을 지우고 흰 테두리 스티커로, 얼굴만 다시 그려 표정 6가지 (기본·웃음·신남·놀람·슬픔·깜빡임)
 - ComfyUI가 이미 켜져 있으면(8188) 그걸 쓰고, 아니면 잠깐 따로 켰다가(8190) 끝나면 끔
 - 기존 워크플로·설정은 건드리지 않음 (그림은 API로만 요청하고, 만든 파일은 가져온 뒤 지움)

사용: python avatar_gen.py --comfy <ComfyUI_windows_portable 폴더> --spec spec.json --out <폴더>
진행 상황은 한 줄 JSON {"p": "..."} 로 출력, 끝나면 <폴더>/illust.webp · sticker.webp · pixel.png(작은 그림)
"""
import argparse
import io
import json
import os
import random
import re
import subprocess
import sys
import time
import urllib.error
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


def prompts(a, desc="", use_look=True, extra=""):
    g, look = tags(a)
    parts = [p for p in (f"({desc}:1.15)" if desc else "", look if use_look else "") if p]   # 설정 반영을 끄면 예전 캐릭터 칸은 안 씀
    who = ", ".join(parts) or ("" if extra else "original character")
    # 일러스트: 가슴 위 초상 + 손은 화면 밖 (애니 모델이 손을 자주 망가뜨려서 손이 안 나오는 구도로)
    illust = (f"{g}, solo, {who}, portrait, upper body, hands out of frame, looking at viewer, music, "
              f"colorful, vibrant, gradient background, safe, {QUALITY}")
    illust_neg = NEG + (", bad hands, extra hands, extra arms, deformed hands, malformed hands, fused fingers, too many fingers, "
                        "holding, hand up, hands up, v, peace sign")
    key = key_color(f"{extra}, {who}")
    if extra:           # 일러스트에서 읽은 생김새 (머리 길이·색, 눈 색, 옷, 장식) → 꼬마가 일러스트를 닮게
        who = f"({extra}:1.2)" + (f", {who}" if who else "")
    # 꼬마: 머리만 크게 나오지 않게 (전신이 그림 가운데에 작게, 머리·몸 비율은 보통 꼬마 정도)
    chibi = (f"{g}, solo, chibi, super deformed, detailed eyes, beautiful detailed face, clear facial features, "
             f"cute, {who}, full body, standing, front view, arms at sides, "
             f"game sprite, simple background, ({key} background:1.45), solid color background, flat background, thick outline, "
             f"flat color, cel shading, safe, {QUALITY}")
    chibi_neg = NEG + (", shadow, drop shadow, ground, floor, white background, gradient background, detailed background, scenery, "
                       "border, frame, multiple views, character sheet, reference sheet, close-up, portrait, upper body, bust, "
                       "head only, oversized head, cropped, cropped legs, cropped feet, text")
    return (illust, illust_neg, 896, 1152), (chibi, chibi_neg, 832, 1216), key


KEY_HUE = {"green": 120, "blue": 220, "pink": 315}


KEY_CLASH = {"green": ("green", "mint", "emerald", "lime", "olive", "teal", "jade"),
             "blue": ("blue", "navy", "cyan", "teal", "aqua", "azure", "sky"),
             "pink": ("pink", "magenta", "purple", "violet", "fuchsia", "rose", "lavender")}


def key_color(who):
    """꼬마 그림 바탕색 (크로마키): 캐릭터에 없는 진한 색 — 보통 초록, 캐릭터에 초록이 있으면 파랑, 그다음 분홍
    (셋 다 있으면 캐릭터에 가장 적게 나오는 색)"""
    w = who.lower()
    clash = {k: sum(w.count(t) for t in ts) for k, ts in KEY_CLASH.items()}
    for k in ("green", "blue", "pink"):
        if not clash[k]:
            return k
    return min(("green", "blue", "pink"), key=lambda k: clash[k])


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


def workflow(pos, neg, w, h, seed, prefix, ref=None, ref_w=0.0, base=None, denoise=1.0, ref_end=1.0,
             face=None, face_w=0.0, face_end=0.6, ref_start=0.0, face_start=0.0, mask=None):
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
                                                                 "combine_embeds": "concat", "start_at": ref_start, "end_at": ref_end,
                                                                 "embeds_scaling": "V only"}}
        wf["5"]["inputs"]["model"] = ["11", 0]
    if face and face_w > 0:     # 얼굴 고정: 일러스트 얼굴을 IP-Adapter 얼굴 전용(SDXL)으로 — 약하게·앞부분만 (꼬마 비율·표정은 주문대로)
        if "10" not in wf:
            wf["10"] = {"class_type": "CLIPVisionLoader", "inputs": {"clip_name": CLIPV_FILE}}
        wf["14"] = {"class_type": "LoadImage", "inputs": {"image": face}}
        wf["15"] = {"class_type": "IPAdapterModelLoader", "inputs": {"ipadapter_file": IPA_FACE_FILE}}
        wf["16"] = {"class_type": "IPAdapterAdvanced", "inputs": {"model": wf["5"]["inputs"]["model"], "ipadapter": ["15", 0],
                                                                 "image": ["14", 0], "clip_vision": ["10", 0], "weight": face_w,
                                                                 "weight_type": "linear", "combine_embeds": "concat",
                                                                 "start_at": face_start, "end_at": face_end, "embeds_scaling": "V only"}}
        wf["5"]["inputs"]["model"] = ["16", 0]
    if base:                    # 동작 그림: 기본 자세 그림에서 출발 (같은 구도·같은 색)
        wf["12"] = {"class_type": "LoadImage", "inputs": {"image": base}}
        wf["13"] = {"class_type": "VAEEncode", "inputs": {"pixels": ["12", 0], "vae": ["1", 2]}}
        wf["5"]["inputs"]["latent_image"] = ["13", 0]
        wf["5"]["inputs"]["denoise"] = denoise
        del wf["4"]
        if mask:                # 마스크(투명한 곳)만 다시 그림 — 표정 바꾸기
            wf["17"] = {"class_type": "LoadImage", "inputs": {"image": mask}}
            wf["18"] = {"class_type": "SetLatentNoiseMask", "inputs": {"samples": ["13", 0], "mask": ["17", 1]}}
            wf["5"]["inputs"]["latent_image"] = ["18", 0]
    return wf


IPA_FILE = "ip-adapter-plus_sdxl_vit-h.safetensors"
IPA_FACE_FILE = "ip-adapter-plus-face_sdxl_vit-h.safetensors"   # 얼굴 전용 (애니 얼굴에도 잘 맞음)
FACE_W = 0.45
CLIPV_FILE = "CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors"
REF_WEIGHT = {"low": (0.45, 0.2), "mid": (0.65, 0.3), "high": (0.85, 0.4)}   # (일러스트, 꼬마 도트 — 사진 바탕색이 묻어나지 않게 약하게)


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
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.loads(r.read().decode("utf-8") or "{}")
        except urllib.error.HTTPError as e:      # 워크플로가 틀렸으면 ComfyUI가 이유를 알려 줌 (어떤 모델·노드가 없는지)
            try:
                d = json.loads(e.read().decode("utf-8", "replace") or "{}")
            except Exception:
                d = {}
            why = [str((d.get("error") or {}).get("message", ""))]
            for ne in (d.get("node_errors") or {}).values():
                for er in ne.get("errors") or []:
                    why.append(f"{ne.get('class_type', '')}: {er.get('message', '')} {er.get('details', '')}".strip())
            raise RuntimeError(f"ComfyUI가 요청을 거절했어요 ({e.code}): " + " / ".join(w for w in why if w)[:240])

    def files(self, node, field):
        """ComfyUI에 설치된 모델 파일 목록 (노드가 없으면 빈 목록)"""
        try:
            info = self._json(f"/object_info/{node}").get(node) or {}
            v = ((info.get("input") or {}).get("required") or {}).get(field) or []
            if v and isinstance(v[0], list):
                return set(v[0])
            if v and v[0] == "COMBO" and len(v) > 1:
                return set((v[1] or {}).get("options") or [])
        except Exception:
            pass
        return set()

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
                if st.get("completed") or st.get("status_str") == "success":
                    raise RuntimeError("ComfyUI가 그림 없이 끝났어요.")
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


def _key_mask(im, key, S=256):
    """크로마키: 바탕색(진한 초록 등)과 색상이 같고 채도가 높은 곳 중 테두리와 이어진 곳만 바탕"""
    return _keep_big(~_key_bg(im, key, S))


def _key_bg(im, key, S=256):
    """테두리와 이어진 바탕색(크로마키) 부분 (True=바탕)"""
    import numpy as np
    from PIL import Image
    hsv = np.asarray(im.resize((S, S), Image.LANCZOS).convert("HSV")).astype(np.float32)
    hue = hsv[:, :, 0] * 360 / 255
    dh = np.abs((hue - KEY_HUE[key] + 180) % 360 - 180)
    near = (dh < 32) & (hsv[:, :, 1] > 95) & (hsv[:, :, 2] > 55)
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
    return bg


def _keep_big(fg):
    """덩어리마다 크기를 재서, 가장 큰 덩어리의 3%보다 작은 부스러기(바탕 얼룩·글자)는 지움"""
    import numpy as np
    S0, S1 = fg.shape
    lab = np.zeros(fg.shape, dtype=np.int32)
    sizes = [0]
    for y0 in range(S0):
        for x0 in range(S1):
            if fg[y0, x0] and not lab[y0, x0]:
                n = len(sizes)
                stack, cnt = [(y0, x0)], 0
                lab[y0, x0] = n
                while stack:
                    y, x = stack.pop()
                    cnt += 1
                    for yy, xx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
                        if 0 <= yy < S0 and 0 <= xx < S1 and fg[yy, xx] and not lab[yy, xx]:
                            lab[yy, xx] = n
                            stack.append((yy, xx))
                sizes.append(cnt)
    if len(sizes) <= 1:
        return fg
    big = max(sizes)
    keep = np.array([False] + [c >= big * 0.03 for c in sizes[1:]])
    return keep[lab]


def _despill(arr, key, edge):
    """가장자리에 번진 바탕색 빼기: 바탕색 쪽 색상이면 채도를 낮춤"""
    import numpy as np
    from PIL import Image
    hsv = np.asarray(Image.fromarray(arr).convert("HSV")).astype(np.float32)
    hue = hsv[:, :, 0] * 360 / 255
    dh = np.abs((hue - KEY_HUE[key] + 180) % 360 - 180)
    spill = edge & (dh < 45) & (hsv[:, :, 1] > 35)
    if spill.any():
        g = arr.astype(np.float32).mean(axis=2, keepdims=True)
        arr = np.where(spill[:, :, None], (arr * 0.35 + g * 0.65), arr).astype("uint8")
    return arr


def _solid(fg):
    """캐릭터가 한 덩어리로 꽉 찼는지 (구멍·조각이 많으면 False)"""
    import numpy as np
    ys, xs = np.where(fg)
    if not len(ys):
        return False
    box = (ys.max() - ys.min() + 1) * (xs.max() - xs.min() + 1)
    return fg.sum() / box > 0.35


_ORT = {}


def ai_prob(im, model):
    """배경 제거 AI(isnet-anime, onnx): 캐릭터일 확률 그림 (L, 1024×1024 — rembg와 같은 방식)"""
    import numpy as np
    import onnxruntime as ort
    from PIL import Image
    key = (str(model), id(im))
    if _ORT.get("last", (None,))[0] == key:
        return _ORT["last"][1]
    sess = _ORT.get(model)
    if sess is None:
        sess = _ORT[model] = ort.InferenceSession(str(model), providers=["CPUExecutionProvider"])
    x = np.asarray(im.convert("RGB").resize((1024, 1024), Image.LANCZOS)).astype(np.float32)
    x = x / max(float(x.max()), 1e-6)
    x = (x - np.array([0.485, 0.456, 0.406], dtype=np.float32)) / 1.0
    x = x.transpose(2, 0, 1)[None].astype(np.float32)
    pred = sess.run(None, {sess.get_inputs()[0].name: x})[0][:, 0, :, :]
    pred = (pred - pred.min()) / max(float(pred.max() - pred.min()), 1e-6)
    out = Image.fromarray((np.squeeze(pred) * 255).astype("uint8"), "L")
    _ORT["last"] = (key, out)
    return out


def ai_mask(im, model, S=256):
    """배경 제거 AI: 캐릭터 부분 마스크 (S×S, True=캐릭터)"""
    import numpy as np
    from PIL import Image
    m = ai_prob(im, model).resize((S, S), Image.LANCZOS)
    return np.asarray(m) > 80          # 밝은 머리·피부처럼 애매하게 잡히는 곳도 캐릭터로


ISNET_URL = "https://github.com/danielgatis/rembg/releases/download/v0.0.0/isnet-anime.onnx"


def ensure_isnet(path):
    """배경 제거 AI 모델: 없으면 한 번만 받음 (rembg 공식 배포, 약 170MB) — 실패하면 None"""
    if not path:
        return None
    import importlib.util
    if importlib.util.find_spec("onnxruntime") is None:
        say("배경 제거 AI 프로그램(onnxruntime)이 없어서 바탕색으로 지워요")
        return None
    p = Path(path)
    if p.is_file() and p.stat().st_size > 100_000_000:
        return p
    try:
        p.parent.mkdir(parents=True, exist_ok=True)
        tmp = p.with_suffix(".part")
        say("배경 제거 AI 받는 중... (처음 한 번만, 약 170MB)")
        with urllib.request.urlopen(ISNET_URL, timeout=60) as r, open(tmp, "wb") as f:
            got, last = 0, 0
            while True:
                b = r.read(1 << 20)
                if not b:
                    break
                f.write(b)
                got += len(b)
                if got - last > 20 << 20:
                    last = got
                    say(f"배경 제거 AI 받는 중... {got >> 20}MB")
        if tmp.stat().st_size < 100_000_000:
            raise RuntimeError("받은 파일이 너무 작아요.")
        tmp.replace(p)
        return p
    except Exception as e:
        say(f"배경 제거 AI를 받지 못했어요 ({str(e)[:80]}) — 다른 방법으로 지워요")
        return None


# ------------------------------------------------------------------ 그림 → 생김새 태그 (WD 태거, onnx · 처음 한 번만 받음 약 380MB)
TAGGER_URL = "https://huggingface.co/SmilingWolf/wd-vit-tagger-v3/resolve/main/"
LOOK_KEEP = re.compile(r"(hair|bangs|sidelocks|ahoge|twintails|ponytail|braid|\bbun\b|drill|eyes$|heterochromia|dress|shirt|hoodie|jacket|coat|"
                       r"sweater|cardigan|skirt|shorts|pants|kimono|yukata|uniform|serafuku|sailor|necktie|bowtie|ribbon|\bbow\b|sleeves|gloves|"
                       r"thighhighs|pantyhose|socks|boots|shoes|\bhat\b|beret|\bcap\b|\bhood\b|scarf|cape|capelet|apron|vest|frills|choker|necklace|"
                       r"earrings|jewelry|glasses|eyewear|headphones|headband|halo|wings|horns|ears$|tail$|mask|freckles|mole|hairclip|flower|crown|tiara)")
LOOK_DROP = re.compile(r"(closed eyes|half-closed|looking|eyes visible|hair over|hair between|grab|holding|hand|finger|\barm|\bleg|thigh|breast|"
                       r"cleavage|navel|midriff|shoulder|collarbone|skin|see-through|underwear|\bbra\b|panties|nude|naked|wet|blood|background|"
                       r"sky|cloud|water|tree|field|petals|indoors|outdoors|text|signature|watermark|sweat|tears|blush|smile|mouth|teeth|tongue|"
                       r"\bopen|from |upper body|portrait|close-up|cowboy|full body|sitting|standing|lying|wind|floating|messy|strap slip|off shoulder)")


def ensure_tagger(path):
    """생김새 읽는 AI(WD 태거) 준비: 없으면 한 번만 받음 — 실패하면 None (그러면 그냥 그림)"""
    if not path:
        return None
    import importlib.util
    if importlib.util.find_spec("onnxruntime") is None:
        return None
    d = Path(path)
    need = ("model.onnx", "selected_tags.csv")       # 다 받은 뒤에만 이 이름으로 바꿔 둠 (받다 끊기면 .part로 남음)
    if all((d / f).is_file() and (d / f).stat().st_size > 100 for f in need):
        return d
    try:
        d.mkdir(parents=True, exist_ok=True)
        for f in need:
            if (d / f).is_file() and (d / f).stat().st_size > 100:
                continue
            tmp = d / (f + ".part")
            say(f"생김새 읽는 AI 받는 중... (처음 한 번만, 약 380MB) {f}")
            with urllib.request.urlopen(TAGGER_URL + f, timeout=60) as r, open(tmp, "wb") as fo:
                n = int(r.headers.get("Content-Length") or 0)
                got, last = 0, 0
                while True:
                    b = r.read(1 << 20)
                    if not b:
                        break
                    fo.write(b)
                    got += len(b)
                    if got - last > 40 << 20:
                        last = got
                        say(f"생김새 읽는 AI 받는 중... {got >> 20}MB")
            if (n and tmp.stat().st_size != n) or tmp.stat().st_size < (50_000_000 if f.endswith(".onnx") else 10_000):
                raise RuntimeError("파일을 다 받지 못했어요.")
            tmp.replace(d / f)
        return d
    except Exception as e:
        say(f"생김새 읽는 AI를 받지 못했어요 ({str(e)[:80]}) — 그냥 그려요")
        return None


def look_tags(image_bytes, tagger_dir, thresh=0.35, limit=14):
    """그림에서 생김새 태그만 뽑기 (머리 길이·색, 눈 색, 옷, 장식) — 표정·자세·배경·노출은 뺌"""
    import csv
    import numpy as np
    import onnxruntime as ort
    from PIL import Image
    d = Path(tagger_dir)
    sess = _ORT.get(str(d))
    if sess is None:
        sess = _ORT[str(d)] = ort.InferenceSession(str(d / "model.onnx"), providers=["CPUExecutionProvider"])
    size = sess.get_inputs()[0].shape[1]
    size = size if isinstance(size, int) else 448
    im = Image.open(io.BytesIO(image_bytes)).convert("RGBA")
    bg = Image.new("RGBA", im.size, (255, 255, 255, 255))
    bg.alpha_composite(im)
    im = bg.convert("RGB")
    m = max(im.size)
    sq = Image.new("RGB", (m, m), (255, 255, 255))
    sq.paste(im, ((m - im.width) // 2, (m - im.height) // 2))
    x = np.asarray(sq.resize((size, size), Image.BICUBIC), dtype=np.float32)[:, :, ::-1]      # BGR, 0~255
    pred = sess.run([sess.get_outputs()[0].name], {sess.get_inputs()[0].name: np.ascontiguousarray(x[None])})[0][0]
    with open(d / "selected_tags.csv", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    got = []
    for row, pv in zip(rows, pred):
        if str(row.get("category")) != "0" or pv < thresh:
            continue
        name = row["name"].replace("_", " ")
        if LOOK_KEEP.search(name) and not LOOK_DROP.search(name):
            got.append((float(pv), name))
    got.sort(reverse=True)
    return clean_tags(", ".join(n for _, n in got[:limit]))


def _shift_or(m, r):
    """r칸 안의 이웃 중 하나라도 True면 True (팽창)"""
    import numpy as np
    out = m.copy()
    for dy in range(-r, r + 1):
        for dx in range(-r, r + 1):
            if dy * dy + dx * dx > r * r:
                continue
            sh = np.zeros_like(m)
            ys, ye = max(0, dy), m.shape[0] + min(0, dy)
            xs, xe = max(0, dx), m.shape[1] + min(0, dx)
            sh[ys:ye, xs:xe] = m[ys - dy:ye - dy, xs - dx:xe - dx]
            out |= sh
    return out


def fill_holes(fg, r=3):
    """캐릭터 안쪽 구멍 메우기: 작은 틈을 막은(닫기) 모양으로 바깥 바탕을 찾고, 바깥과 이어지지 않은 투명한 곳은 캐릭터로"""
    import numpy as np
    closed = ~_shift_or(~_shift_or(fg, r), r)          # 닫기 = 팽창 후 침식 (외곽선이 살짝 끊긴 틈을 막음)
    outside = np.zeros_like(fg)
    free = ~closed
    outside[0, :], outside[-1, :], outside[:, 0], outside[:, -1] = free[0, :], free[-1, :], free[:, 0], free[:, -1]
    for _ in range(fg.shape[0] * 3):
        grow = outside.copy()
        grow[1:, :] |= outside[:-1, :]
        grow[:-1, :] |= outside[1:, :]
        grow[:, 1:] |= outside[:, :-1]
        grow[:, :-1] |= outside[:, 1:]
        grow &= free
        if (grow == outside).all():
            break
        outside = grow
    cand = ~outside & ~fg
    # 덩어리마다: 바깥 바탕에 길게 붙은 얇은 조각(닫기로 테두리가 불어난 곳)은 빼고, 안쪽 구멍만 메움
    near_out = _shift_or(outside, 1)
    lab = np.zeros(fg.shape, dtype=np.int32)
    keep = np.zeros(fg.shape, dtype=bool)
    H, W = fg.shape
    n = 0
    for y0 in range(H):
        for x0 in range(W):
            if cand[y0, x0] and not lab[y0, x0]:
                n += 1
                stack, pts = [(y0, x0)], []
                lab[y0, x0] = n
                while stack:
                    y, x = stack.pop()
                    pts.append((y, x))
                    for yy, xx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
                        if 0 <= yy < H and 0 <= xx < W and cand[yy, xx] and not lab[yy, xx]:
                            lab[yy, xx] = n
                            stack.append((yy, xx))
                touch = sum(1 for y, x in pts if near_out[y, x])
                if touch / len(pts) < 0.35:
                    for y, x in pts:
                        keep[y, x] = True
    return fg | keep


def _bg_gaps(im, fg, key, S=256):
    """캐릭터에 둘러싸인 '진짜 빈 곳'(팔과 허리 사이·다리 사이 등)을 찾음: 바탕색(크로마키)과 거의 같은 색으로 매끈하게 칠해진 덩어리
    → 구멍 메우기가 이런 곳까지 캐릭터로 채워서 초록 얼룩이 생기던 문제. 얼굴 높이 가운데(초록 눈동자일 수 있음)는 건드리지 않음"""
    import numpy as np
    from PIL import Image
    none = np.zeros_like(fg)
    if key not in KEY_HUE or not fg.any():
        return none
    small = np.asarray(im.resize((S, S), Image.LANCZOS).convert("RGB")).astype(np.float32)
    ring = np.zeros_like(fg)
    ring[:3, :], ring[-3:, :], ring[:, :3], ring[:, -3:] = True, True, True, True
    samp = small[ring & ~fg]
    if len(samp) < S:
        return none
    bgc = np.median(samp, axis=0)
    h, s, v = np.asarray(Image.fromarray(bgc.reshape(1, 1, 3).astype("uint8")).convert("HSV"))[0, 0].astype(np.float32)
    if abs((h * 360 / 255 - KEY_HUE[key] + 180) % 360 - 180) > 32 or s < 95 or v < 55:
        return none                     # 바탕이 크로마키 색이 아니면(흰 바탕 등) 하지 않음 — 흰 옷·머리가 뚫리지 않게
    dist = np.sqrt(((small - bgc) ** 2).sum(axis=2))
    cand = fg & (dist < 48)
    ys, xs = np.where(fg)
    top, bot, lft, rgt = ys.min(), ys.max(), xs.min(), xs.max()
    fy0, fy1 = top + (bot - top) * 0.18, top + (bot - top) * 0.5           # 얼굴 부분 (2등신: 위쪽 절반의 가운데)
    fx0, fx1 = lft + (rgt - lft) * 0.2, rgt - (rgt - lft) * 0.2
    out = np.zeros_like(fg)
    lab = np.zeros(fg.shape, dtype=np.int32)
    n = 0
    for y0, x0 in zip(*np.where(cand)):
        if lab[y0, x0]:
            continue
        n += 1
        stack, pts = [(y0, x0)], []
        lab[y0, x0] = n
        while stack:
            y, x = stack.pop()
            pts.append((y, x))
            for yy, xx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
                if 0 <= yy < S and 0 <= xx < S and cand[yy, xx] and not lab[yy, xx]:
                    lab[yy, xx] = n
                    stack.append((yy, xx))
        if len(pts) < 12:
            continue
        py, px = np.array(pts).T
        cy, cx = py.mean(), px.mean()
        if fy0 <= cy <= fy1 and fx0 <= cx <= fx1:
            continue
        if small[py, px].std(axis=0).max() > 22:        # 바탕은 한 가지 색으로 매끈함 (무늬·그라데이션이 있으면 캐릭터 쪽)
            continue
        out[py, px] = True
    if out.sum() > fg.sum() * 0.2:      # 너무 많이 지워지면 뭔가 이상한 것 → 그대로 둠
        return none
    return out


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
    return _keep_big(~bg)


def chibi_check(png, key=None, ai_model=None, S=128):
    """꼬마 그림 구도 검사: 전신이 그림 가운데에 작게 들어갔는지 (얼굴만 화면 가득 그리면 도트가 망가짐)
    → (괜찮은지, 이유)"""
    import numpy as np
    from PIL import Image
    im = Image.open(io.BytesIO(png)).convert("RGB")
    m = None
    if ai_model:
        try:
            m = ai_mask(im, ai_model, S)
        except Exception:
            m = None
    if m is None and key in KEY_HUE:
        bg = _key_bg(im, key, S)
        if bg.mean() > 0.2:             # 바탕이 정말 크로마키 색일 때만
            m = ~bg
    if m is None:
        small = np.asarray(im.resize((S, S), Image.LANCZOS)).astype(np.float32)
        border = np.concatenate([small[:2].reshape(-1, 3), small[-2:].reshape(-1, 3), small[:, :2].reshape(-1, 3), small[:, -2:].reshape(-1, 3)])
        if border.std(axis=0).mean() > 18:      # 테두리가 한 가지 바탕색이 아님 → 캐릭터가 그림 밖으로 넘친 것
            return False, "얼굴·몸이 그림 밖으로 넘쳤어요"
        m = _fg_mask(im, S)
    frac = m.mean()
    edge = 3
    sides = [m[:edge].mean(), m[-edge:].mean(), m[:, :edge].mean(), m[:, -edge:].mean()]   # 위·아래·왼·오른 테두리에 캐릭터가 닿은 정도
    touch = sum(1 for v in sides if v > 0.12)
    ys, xs = np.where(m)
    if not len(ys):
        return False, "캐릭터가 없어요"
    hh, ww = (ys.max() - ys.min() + 1) / S, (xs.max() - xs.min() + 1) / S
    if frac > 0.62 or touch >= 3 or (touch >= 2 and sides[0] > 0.12):
        return False, "얼굴·몸이 그림 밖으로 넘쳤어요"
    if frac < 0.04 or hh < 0.4:
        return False, "캐릭터가 너무 작아요"
    if hh < ww * 0.85:
        return False, "전신이 아니에요"
    return True, ""


def shrink_keep_lines(img, size, eye_band=None):
    """작게 줄이기: 보통은 평균색, 선(진한 곳·색이 확 바뀌는 경계)이 칸의 1/5 이상이면 그 선 색을 더 진하게
    (평균으로 줄이면 눈 테두리·입·얼굴 경계가 흐려져서 표정이 안 보임) — 줄이기 전에 대비를 살짝 올리고 선명하게"""
    import numpy as np
    from PIL import Image, ImageEnhance, ImageFilter
    img = ImageEnhance.Contrast(img).enhance(1.12)
    img = img.filter(ImageFilter.UnsharpMask(radius=2, percent=110, threshold=2))
    arr = np.asarray(img).astype(np.float32)
    lum = arr[:, :, 0] * 0.299 + arr[:, :, 1] * 0.587 + arr[:, :, 2] * 0.114
    edge = np.asarray(Image.fromarray(lum.astype("uint8")).filter(ImageFilter.FIND_EDGES)).astype(np.float32)
    line = (lum < 80) | ((edge > 90) & (lum < 130))   # 아주 진한 곳·확실한 경계만 (머리카락 잔결은 빼고)
    if eye_band:            # 눈 높이(얼굴 가운데)에서는 경계를 더 예민하게 → 눈동자·흰자·피부 사이에 테두리
        H, W = lum.shape
        y0, y1 = int(H * eye_band[0]), int(H * eye_band[1])
        x0, x1 = int(W * eye_band[2]), int(W * eye_band[3])
        band = np.zeros_like(line)
        band[y0:y1, x0:x1] = True
        el = band & (edge > 50) & (lum < 175)
        el = np.asarray(Image.fromarray((el * 255).astype("uint8")).filter(ImageFilter.MaxFilter(5))) > 0   # 얇은 경계를 굵게 (줄여도 남게)
        line |= el & band
    line = line.astype(np.float32)
    avg = np.asarray(img.resize(size, Image.BOX)).astype(np.float32)
    cov = np.asarray(Image.fromarray((line * 255).astype("uint8")).resize(size, Image.BOX)).astype(np.float32) / 255
    # 선 부분의 색: 선 픽셀 중 가장 어두운 쪽 평균 → 더 진하게
    dark_arr = arr * line[:, :, None]
    dsum = np.stack([np.asarray(Image.fromarray(dark_arr[:, :, c].astype("uint8")).resize(size, Image.BOX)).astype(np.float32)
                     for c in range(3)], axis=2)
    dcol = dsum / np.maximum(cov[:, :, None], 1e-3)
    dcol = dcol * 0.72 + np.array([20, 14, 36], dtype=np.float32) * 0.28 * (cov[:, :, None] > 0)   # 외곽선 색 쪽으로
    use = cov >= 0.18
    if eye_band:
        h2, w2 = use.shape
        ebm = np.zeros_like(use)
        ebm[int(h2 * eye_band[0]):int(h2 * eye_band[1]) + 1, int(w2 * eye_band[2]):int(w2 * eye_band[3]) + 1] = True
        use |= ebm & (cov >= 0.12)
    # 혼자 튀는 선 점은 지움 (주변 8칸에 선이 하나도 없으면 평균색으로)
    pad = np.pad(use, 1)
    nb = sum(pad[1 + dy:pad.shape[0] - 1 + dy, 1 + dx:pad.shape[1] - 1 + dx] for dy in (-1, 0, 1) for dx in (-1, 0, 1) if dy or dx)
    use = use & (nb >= 1)
    if eye_band:            # 눈 높이의 선은 더 진하게 (눈동자 테두리가 또렷하게)
        h2, w2 = use.shape
        eb = np.zeros_like(use)
        eb[int(h2 * eye_band[0]):int(h2 * eye_band[1]) + 1, int(w2 * eye_band[2]):int(w2 * eye_band[3]) + 1] = True
        dark = dcol * 0.5 + np.array([20, 14, 36], dtype=np.float32) * 0.5
        dcol = np.where((eb & use)[:, :, None], dark, dcol)
    out = np.where(use[:, :, None], dcol, avg)
    return Image.fromarray(np.clip(out, 0, 255).astype("uint8"))


def pixel_sheet(pngs, height=128, colors=32, key=None, ai_model=None):
    """꼬마 그림 여러 장(기본·치기·점프·슬픔) → 같은 크기·같은 발 위치·같은 색 팔레트의 도트 동작 그림들
    → (기본 한 장 PNG, 동작 줄 PNG [기본·치기 왼·치기 오른(뒤집기)·점프·슬픔])"""
    import numpy as np
    from PIL import Image
    ims = [Image.open(io.BytesIO(b)).convert("RGB") for b in pngs]
    W0, H0 = ims[0].size
    S = 256
    masks = None
    if ai_model:                # 1) 배경 제거 AI (캐릭터 모양을 알아보고 잘라냄) — 결과가 이상하면 다음 방법
        try:
            am = [ai_mask(im, ai_model, S) for im in ims]
            border = np.concatenate([am[0][0], am[0][-1], am[0][:, 0], am[0][:, -1]])
            frac = am[0].mean()
            if border.mean() < 0.4 and 0.03 < frac < 0.85:
                if key in KEY_HUE:      # 가장자리에 같이 잡힌 바탕색(초록 테두리)은 빼기
                    am = [m & ~_key_bg(im, key, S) for m, im in zip(am, ims)]
                masks = [_keep_big(m) for m in am]
        except Exception as e:
            say(f"배경 제거 AI를 못 써서 다른 방법으로 지워요 ({str(e)[:80]})")
    if masks is None and key in KEY_HUE:          # 크로마키 바탕으로 그렸으면 그 색만 지움 — 이상하면(캐릭터가 조각나면) 예전 방식
        km = [_key_mask(im, key, S) for im in ims]
        border = np.concatenate([km[0][0], km[0][-1], km[0][:, 0], km[0][:, -1]])
        # 바탕이 정말 그 색으로 칠해졌을 때만 (AI가 흰 바탕으로 그려 버리면 테두리가 바탕으로 안 잡힘 → 예전 방식)
        if border.mean() < 0.3 and km[0].sum() > S * S * 0.04 and _solid(km[0]):
            masks = km
    if masks is None:
        masks = [_fg_mask(im, S) for im in ims]
    masks = [fill_holes(m) for m in masks]     # 캐릭터 안쪽에 생긴 구멍(밝은 머리·얼굴이 바탕으로 잘못 잡힌 곳)은 메움
    masks = [m & ~_bg_gaps(im, m, key, S) for im, m in zip(ims, masks)]    # 단, 바탕색 그대로인 빈 곳(팔·다리 사이)은 다시 투명하게
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
    # 눈 높이: 기본 자세 캐릭터의 위에서 26~46% (2등신이라 머리가 위쪽 절반), 가운데 70%
    ys0, xs0 = np.where(masks[0][y0:y1, x0:x1])
    if len(ys0):
        hh, ww = (y1 - y0), (x1 - x0)
        top, bot = ys0.min() / hh, ys0.max() / hh
        lft, rgt = xs0.min() / ww, xs0.max() / ww
        span, wspan = bot - top, rgt - lft
        eye_band = (top + span * 0.26, top + span * 0.46, lft + wspan * 0.15, rgt - wspan * 0.15)
    else:
        eye_band = None
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
        if key in KEY_HUE:
            near_edge = cm & ~np.asarray(Image.fromarray((cm * 255).astype("uint8")).filter(__import__("PIL.ImageFilter", fromlist=["x"]).MinFilter(17))).astype(bool)
            ca = _despill(ca, key, near_edge)
        if cm.any():
            ca[~cm] = ca[cm].mean(axis=0).astype("uint8")   # 줄일 때 흰 바탕이 가장자리에 번지지 않게
        rgb = shrink_keep_lines(Image.fromarray(ca), (w, h), eye_band)
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
        out[edge] = (18, 12, 32, 255)               # 바깥 외곽선 (진한 남색)
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


def pixelize(png, height=128, colors=32):
    """꼬마 전신 그림 한 장 → 도트 한 장 (예전 방식, 시험용)"""
    return pixel_sheet([png], height, colors)[0]


# ------------------------------------------------------------------ SD 스티커 (도트 대신: 매끈한 꼬마 그림 한 장 + 표정 여러 개)
# 표정 순서 = 화면에서 쓰는 순서 (static/avatar.js 의 STK_EXPR 과 같게)
EXPR = (("idle", None, 0.0),
        ("smile", "(smile, closed eyes, happy, ^_^:1.3)", 0.62),
        ("cheer", "(open mouth, big smile, excited, sparkling eyes:1.3)", 0.62),
        ("oops", "(surprised, open mouth, wide-eyed, sweatdrop:1.3)", 0.6),
        ("sad", "(sad, frown, teary eyes, closed mouth:1.3)", 0.6),
        ("blink", "(closed eyes, light smile, closed mouth:1.3)", 0.58))
STICKER_H = 512          # 표정 한 칸 높이 (흰 테두리 포함)
STICKER_B = 7            # 흰 스티커 테두리 두께


def cut_alpha(im, key=None, ai_model=None):
    """배경 제거 → 원래 크기의 부드러운 알파(0~1). 캐릭터 안쪽 구멍은 메우고, 팔·다리 사이 바탕색은 투명하게"""
    import numpy as np
    from PIL import Image, ImageFilter
    W, H = im.size
    S = 256
    prob, m = None, None
    if ai_model:
        try:
            pr = ai_prob(im, ai_model)
            am = np.asarray(pr.resize((S, S), Image.LANCZOS)) > 80
            border = np.concatenate([am[0], am[-1], am[:, 0], am[:, -1]])
            if border.mean() < 0.4 and 0.03 < am.mean() < 0.85:
                prob, m = pr, am
                if key in KEY_HUE:
                    m = m & ~_key_bg(im, key, S)
                m = _keep_big(m)
        except Exception as e:
            say(f"배경 제거 AI를 못 써서 다른 방법으로 지워요 ({str(e)[:80]})")
    if m is None and key in KEY_HUE:
        km = _key_mask(im, key, S)
        border = np.concatenate([km[0], km[-1], km[:, 0], km[:, -1]])
        if border.mean() < 0.3 and km.sum() > S * S * 0.04 and _solid(km):
            m = km
    if m is None:
        m = _fg_mask(im, S)
    solid = fill_holes(m)
    gaps = _bg_gaps(im, solid, key, S)
    solid = solid & ~gaps
    up = lambda b: np.asarray(Image.fromarray((b * 255).astype("uint8")).resize((W, H), Image.BILINEAR)).astype(np.float32) / 255
    solid_f = up(solid)
    if prob is not None:        # AI 확률로 가장자리를 부드럽게 + 안쪽은 꽉 차게
        pf = np.asarray(prob.resize((W, H), Image.LANCZOS)).astype(np.float32) / 255
        a = np.clip((pf - 0.25) / 0.5, 0, 1)
        inner = np.asarray(Image.fromarray(((solid_f > 0.5) * 255).astype("uint8")).filter(ImageFilter.MinFilter(9))) > 0
        a = np.maximum(a, inner.astype(np.float32))
        a = np.minimum(a, np.clip(solid_f * 1.6, 0, 1))          # 구멍 메움·빈 곳 자르기 결과 밖으로는 안 나가게
    else:
        a = np.asarray(Image.fromarray((np.clip(solid_f, 0, 1) * 255).astype("uint8")).filter(ImageFilter.GaussianBlur(1.2))).astype(np.float32) / 255
        a = np.clip((a - 0.3) / 0.4, 0, 1)
    if key in KEY_HUE:          # 테두리와 이어진 바탕색(크로마키)은 확실히 지움
        bgk = up(_key_bg(im, key, S)) > 0.5
        hsv = np.asarray(im.convert("HSV")).astype(np.float32)
        dh = np.abs((hsv[:, :, 0] * 360 / 255 - KEY_HUE[key] + 180) % 360 - 180)
        keyish = (dh < 32) & (hsv[:, :, 1] > 95) & (hsv[:, :, 2] > 55)
        a[bgk & keyish] = 0
    return a


def face_box(arr, a):
    """얼굴(눈·입) 자리 찾기: 캐릭터 위쪽의 피부색 덩어리 중 '앞을 보고 선 꼬마의 얼굴 자리'에 가장 가깝고 큰 것
    → (가운데 x, y, 가로 반지름, 세로 반지름). 못 찾으면 꼬마 비율로 어림"""
    import numpy as np
    from collections import deque
    from PIL import Image
    H, W = a.shape
    ys, xs = np.where(a > 0.5)
    if not len(ys):
        return None
    y0, y1, x0, x1 = ys.min(), ys.max(), xs.min(), xs.max()
    hc, wc = y1 - y0, x1 - x0
    band = (a > 0.5)[y0 + int(hc * 0.15):y0 + int(hc * 0.45)]
    bx = np.where(band)[1]
    px0 = float(np.median(bx)) if len(bx) else (x0 + x1) / 2     # 머리 가운데 (양갈래·소품이 있어도 가운데 쪽)
    py0 = y0 + hc * 0.3
    guess = (px0, py0, max(wc * 0.2, hc * 0.1), hc * 0.12)
    hsv = np.asarray(Image.fromarray(arr).convert("HSV")).astype(np.float32)
    hue, sat, val = hsv[:, :, 0] * 360 / 255, hsv[:, :, 1] / 255, hsv[:, :, 2] / 255
    head = np.zeros(a.shape, dtype=bool)
    head[y0:y0 + int(hc * 0.55)] = True
    S = 160
    k = W / S
    for smin, smax, vmin in ((0.05, 0.36, 0.55), (0.1, 0.62, 0.25)):     # 밝은 피부 → 어두운 피부
        skin = head & (a > 0.5) & (((hue >= 0) & (hue <= 42)) | (hue >= 342)) & (sat >= smin) & (sat <= smax) & (val >= vmin)
        sm = np.asarray(Image.fromarray((skin * 255).astype("uint8")).resize((S, max(1, int(S * H / W))), Image.BOX)) > 100
        seen = np.zeros_like(sm)
        best, best_score = None, 0.0
        for yy, xx in zip(*np.where(sm)):
            if seen[yy, xx]:
                continue
            q, pts = deque([(yy, xx)]), []
            seen[yy, xx] = True
            while q:
                cy, cx = q.popleft()
                pts.append((cy, cx))
                for ny, nx in ((cy - 1, cx), (cy + 1, cx), (cy, cx - 1), (cy, cx + 1)):
                    if 0 <= ny < sm.shape[0] and 0 <= nx < S and sm[ny, nx] and not seen[ny, nx]:
                        seen[ny, nx] = True
                        q.append((ny, nx))
            if len(pts) < 25:
                continue
            py, px = np.array(pts).T
            fx0, fx1, fy0, fy1 = px.min() * k, (px.max() + 1) * k, py.min() * k, (py.max() + 1) * k
            fw, fh = fx1 - fx0, fy1 - fy0
            if fw < wc * 0.1 or fw > wc * 0.8 or fh < hc * 0.05 or fh > hc * 0.4:
                continue
            dist = np.hypot((fx0 + fx1) / 2 - px0, (fy0 + fy1) / 2 - py0) / max(wc, 1)
            score = len(pts) / (1 + 4 * dist)
            if score > best_score:
                best, best_score = (fx0, fx1, fy0, fy1), score
        if best:
            fx0, fx1, fy0, fy1 = best
            fw, fh = fx1 - fx0, fy1 - fy0
            return (fx0 + fx1) / 2, fy0 + fh * 0.48, fw * 0.6, fh * 0.62
    return guess


def face_mask(size, box, grow=1.0):
    """얼굴 타원 마스크 (0~1, 가장자리 부드럽게)"""
    import numpy as np
    from PIL import Image, ImageDraw, ImageFilter
    W, H = size
    cx, cy, rx, ry = (float(v) for v in box)
    rx, ry = rx * grow, ry * grow
    m = Image.new("L", (W, H), 0)
    ImageDraw.Draw(m).ellipse((cx - rx, cy - ry, cx + rx, cy + ry), fill=255)
    m = m.filter(ImageFilter.GaussianBlur(max(2, min(rx, ry) * 0.18)))
    return np.asarray(m).astype(np.float32) / 255


def expr_ok(base, new, fm, key):
    """다시 그린 표정이 쓸 만한지: 얼굴 둘레 색이 크게 바뀌지 않았고, 바탕색·검은 얼룩이 없음"""
    import numpy as np
    from PIL import Image
    ring = (fm > 0.15) & (fm < 0.6)
    core = fm > 0.6
    if not ring.any() or not core.any():
        return False
    d = np.abs(base.astype(np.float32) - new.astype(np.float32)).mean(axis=2)
    if d[ring].mean() > 42:
        return False
    if key in KEY_HUE:          # 얼굴에 바탕색(크로마키)이 새로 생겼으면 실패 (원래 그 색 눈이면 그만큼은 괜찮음)
        def keyfrac(x):
            hsv = np.asarray(Image.fromarray(x).convert("HSV")).astype(np.float32)
            dh = np.abs((hsv[:, :, 0] * 360 / 255 - KEY_HUE[key] + 180) % 360 - 180)
            return ((dh < 32) & (hsv[:, :, 1] > 95))[core].mean()
        if keyfrac(new) > keyfrac(base) + 0.03:
            return False
    lb, ln = base[core].mean(), new[core].mean()
    return ln > lb - 70


def despill_frames(frames, a, key):
    """가장자리(반투명·테두리 근처)에 번진 크로마키 바탕색 빼기 — 표정 그림 모두 같게"""
    import numpy as np
    from PIL import Image, ImageFilter
    if key not in KEY_HUE:
        return frames
    inner = np.asarray(Image.fromarray(((a > 0.5) * 255).astype("uint8")).filter(ImageFilter.MinFilter(17))) > 0
    edge = (a > 0.01) & ~inner
    return [_despill(np.ascontiguousarray(f), key, edge) for f in frames]


def sticker_sheet(frames, a):
    """표정 그림들(같은 크기 RGB 배열) + 알파 → 흰 테두리 스티커 표정 줄 (webp) · 작은 그림 (png)"""
    import numpy as np
    from PIL import Image, ImageFilter
    H, W = a.shape
    ys, xs = np.where(a > 0.1)
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    pad_out = STICKER_B + 5
    f = (STICKER_H - pad_out * 2) / (y1 - y0)
    m = pad_out / f
    box = (int(x0 - m), int(y0 - m), int(x1 + m), int(y1 + m))
    cw = round((box[2] - box[0]) * f)
    big = lambda im: im.crop(box).resize((cw, STICKER_H), Image.LANCZOS)
    al = big(Image.fromarray((a * 255).astype("uint8")))
    av = np.asarray(al).astype(np.float32) / 255
    # 흰 테두리: 알파를 둥글게 불림
    d = np.asarray(al.filter(ImageFilter.GaussianBlur(STICKER_B * 0.55))).astype(np.float32) / 255
    border = np.clip((d - 0.035) * 14, 0, 1)
    d2 = np.asarray(Image.fromarray((border * 255).astype("uint8")).filter(ImageFilter.GaussianBlur(1.6))).astype(np.float32) / 255
    rim = np.clip(d2 * 1.4 - border, 0, 1) * 0.55        # 테두리 바깥의 옅은 진한 선 (밝은 테마에서도 보이게)
    def over(dc, da, sc, sa):          # 겹쳐 그리기 (아래 dc·da 위에 sc·sa)
        oa = sa + da * (1 - sa)
        oc = (sc * sa[:, :, None] + dc * (da * (1 - sa))[:, :, None]) / np.maximum(oa, 1e-6)[:, :, None]
        return oc, oa
    ink = np.broadcast_to(np.array([24, 18, 40], dtype=np.float32), (STICKER_H, cw, 3))
    white = np.full((STICKER_H, cw, 3), 255, dtype=np.float32)
    base_c, base_a = over(np.zeros((STICKER_H, cw, 3), np.float32), np.zeros((STICKER_H, cw), np.float32), ink, rim)
    base_c, base_a = over(base_c, base_a, white, border)
    outs = []
    for fr in frames:
        rgb = np.asarray(big(Image.fromarray(fr))).astype(np.float32)
        oc, oa = over(base_c, base_a, rgb, av)      # 진한 선 → 흰 테두리 → 캐릭터
        outs.append(Image.fromarray(np.dstack([np.clip(oc, 0, 255), np.clip(oa * 255, 0, 255)]).astype("uint8"), "RGBA"))
    sheet = Image.new("RGBA", (cw * len(outs), STICKER_H), (0, 0, 0, 0))
    for i, fr in enumerate(outs):
        sheet.paste(fr, (i * cw, 0))
    buf = io.BytesIO()
    sheet.save(buf, "WEBP", quality=90, alpha_quality=100, method=5)
    th = outs[0].resize((max(8, round(cw * 192 / STICKER_H)), 192), Image.LANCZOS)
    b2 = io.BytesIO()
    th.save(b2, "PNG", optimize=True)
    return buf.getvalue(), b2.getvalue()


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
    (il_p, il_n, il_w, il_h), (ch_p, ch_n, ch_w, ch_h), key = prompts(av, desc, spec.get("useLook", True) is not False)
    ref = spec.get("ref") if spec.get("ref") and Path(spec["ref"]).is_file() else None
    rw = REF_WEIGHT.get(spec.get("strength"), REF_WEIGHT["mid"])
    comfy = Comfy(a.comfy)
    try:
        comfy.start()
        ipas = comfy.files("IPAdapterModelLoader", "ipadapter_file")
        has_cv = CLIPV_FILE in comfy.files("CLIPVisionLoader", "clip_name")
        use_ipa = IPA_FILE in ipas and has_cv              # 참고 그림 따라 그리기 (없으면 글로만 그림)
        use_face = IPA_FACE_FILE in ipas and has_cv        # 얼굴 고정
        if not use_ipa:
            say("참고 그림 모델(IP-Adapter)이 없어서 글로만 그려요")
        elif not use_face:
            say("얼굴 고정 모델이 없어서 얼굴 고정 없이 그려요")
        ref_name = comfy.upload(ref) if ref and use_ipa else None
        seed = random.randint(1, 2 ** 31)
        il_file = None
        if spec.get("mode") != "pixel":           # pixel: 일러스트는 그대로 두고 도트만
            say("일러스트 그리는 중..." + (" (참고 사진 반영)" if ref_name else ""))
            il = comfy.run(workflow(il_p, il_n, il_w, il_h, seed, "linkbeat_avatar/illust", ref_name, rw[0]), "일러스트")
            (out / "illust.webp").write_bytes(to_webp(il))
            il_file = out / "illust_ref.png"
            il_file.write_bytes(il)
        elif spec.get("illust") and Path(spec["illust"]).is_file():
            il_file = Path(spec["illust"])          # 도트만 다시: 지금 일러스트를 참고 그림으로
        # 일러스트에서 생김새(머리 길이·색, 눈 색, 옷, 장식)를 글로 읽어서 꼬마 그림 설명에 넣음 → 꼬마가 일러스트를 닮게
        if il_file:
            tg = ensure_tagger(spec.get("tagger"))
            if tg:
                try:
                    say("일러스트 생김새 읽는 중...")
                    il_tags = look_tags(Path(il_file).read_bytes(), tg)
                    if il_tags:
                        say(f"일러스트 생김새: {il_tags[:120]}")
                        _, (ch_p, ch_n, ch_w, ch_h), key = prompts(av, desc, spec.get("useLook", True) is not False, extra=il_tags)
                except Exception as e:
                    say(f"생김새를 읽지 못했어요 ({str(e)[:80]}) — 그냥 그려요")
        # 꼬마 도트는 일러스트를 보고 그림 (머리·옷·색이 일러스트를 따라감). 일러스트가 없으면 참고 사진을 약하게
        ch_end = 1.0
        if il_file and use_ipa:     # 일러스트의 캐릭터 부분만 잘라서, 그림 앞부분에만 약하게 (바탕·분위기까지 따라가지 않게)
            from PIL import Image
            im0 = Image.open(il_file).convert("RGB")
            W0, H0 = im0.size
            crop = out / "illust_crop.png"
            im0.crop((int(W0 * 0.14), int(H0 * 0.04), int(W0 * 0.86), int(H0 * 0.74))).save(crop)
            ch_ref, ch_w8, ch_end = comfy.upload(crop, "linkbeat_ref_illust"), 0.7, 0.9
            fcrop = out / "illust_face.png"      # 얼굴 부분만 (얼굴 고정용 — 기본 자세에만, 동작 그림은 기본 자세에서 이어짐)
            im0.crop((int(W0 * 0.22), int(H0 * 0.06), int(W0 * 0.78), int(H0 * 0.52))).save(fcrop)
            face_name = comfy.upload(fcrop, "linkbeat_ref_face") if use_face else None
        else:
            ch_ref, ch_w8 = ref_name, rw[1]
            face_name = None
        # 그림 앞부분(전체 구도가 정해지는 단계)은 글('전신 꼬마')대로, 그다음부터 일러스트·얼굴을 따라감
        # → 일러스트가 얼굴 클로즈업이어도 꼬마는 전신으로. 구도가 이상하면 더 약하게 → 글로만 다시
        isnet = ensure_isnet(spec.get("isnet"))
        tries = [dict(ref=ch_ref, w=ch_w8, rs=0.25, re=ch_end, face=face_name, fs=0.3),
                 dict(ref=ch_ref, w=ch_w8 * 0.75, rs=0.5, re=ch_end, face=None, fs=0),
                 dict(ref=None, w=0, rs=0, re=1, face=None, fs=0)]
        ch = None
        for n, t in enumerate(tries):
            if n and not t["ref"] and not tries[n - 1]["ref"]:
                continue
            say("도트용 꼬마 캐릭터 그리는 중..." + (" (일러스트 얼굴을 따라)" if t["face"] else "") + (f" (다시 {n})" if n else ""))
            img = comfy.run(workflow(ch_p, ch_n, ch_w, ch_h, seed + 1 + n * 7, "linkbeat_avatar/chibi", t["ref"], t["w"],
                                     ref_start=t["rs"], ref_end=t["re"], face=t["face"], face_w=FACE_W,
                                     face_start=t["fs"], face_end=0.9), "꼬마 캐릭터")
            ch = img                       # 끝까지 안 되면 마지막(가장 약하게 따라간) 그림
            ok, why = chibi_check(img, key, isnet)
            if ok:
                break
            if n < len(tries) - 1:
                say(f"꼬마 그림 구도가 이상해서 다시 그려요 ({why})")

        base_file = out / "chibi_base.png"
        base_file.write_bytes(ch)
        # ---- 스티커: 배경을 지우고, 얼굴만 다시 그려 표정 여러 개 (몸·머리·옷은 그대로라 표정을 바꿔 끼워도 같은 캐릭터)
        import numpy as np
        from PIL import Image
        say("배경 지우는 중...")
        base_im = Image.open(io.BytesIO(ch)).convert("RGB")
        base_arr = np.asarray(base_im)
        alpha = cut_alpha(base_im, key, isnet)
        box = face_box(base_arr, alpha)
        frames = [base_arr]
        if box:
            W, H = base_im.size
            fm = face_mask((W, H), box)
            mpng = out / "face_mask.png"            # 얼굴은 투명(=다시 그릴 곳), 나머지는 불투명
            hole = face_mask((W, H), box, grow=1.15)
            Image.fromarray(np.dstack([np.zeros((H, W, 3), "uint8"), ((1 - (hole > 0.05)) * 255).astype("uint8")]), "RGBA").save(mpng)
            base_name = comfy.upload(base_file, "linkbeat_ref_base")
            mask_name = comfy.upload(mpng, "linkbeat_ref_mask")
            for k, (name, tags_, dn) in enumerate(EXPR[1:]):
                say(f"표정 그리는 중... ({k + 1}/{len(EXPR) - 1})")
                try:
                    img = comfy.run(workflow(f"{tags_}, {ch_p}", ch_n, ch_w, ch_h, seed + 31 + k, f"linkbeat_avatar/expr_{name}",
                                             base=base_name, denoise=dn, mask=mask_name), "표정")
                    new = np.asarray(Image.open(io.BytesIO(img)).convert("RGB").resize((W, H), Image.LANCZOS))
                    mix = (base_arr * (1 - fm[:, :, None]) + new * fm[:, :, None]).astype("uint8")   # 얼굴 밖은 기본 그림 그대로
                    if expr_ok(base_arr, mix, fm, key):
                        frames.append(mix)
                        continue
                    say(f"'{name}' 표정이 어색해서 기본 얼굴로 대신해요")
                except Exception as e:
                    say(f"표정 하나를 못 그렸어요 ({str(e)[:60]}) — 기본 얼굴로 대신해요")
                frames.append(base_arr)
        else:
            frames += [base_arr] * (len(EXPR) - 1)
        frames = despill_frames(frames, alpha, key)
        sheet, thumb = sticker_sheet(frames, alpha)
        (out / "sticker.webp").write_bytes(sheet)
        (out / "pixel.png").write_bytes(thumb)          # 목록·작은 칸용 (예전 이름 그대로)
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
