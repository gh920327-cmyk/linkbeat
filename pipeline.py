"""
유튜브 영상 → 채보 분석 (서버 혼자 모드와 PC 채보 엔진이 함께 씀)
 - 영상 정보 확인 → 오디오 받기 → 디코딩 → chartgen.generate
 - 결과: (meta, res)  meta = 제목·채널·가수 찾기에 쓰는 유튜브 정보 일부, res = 채보 분석 결과
"""
import hashlib
import tempfile
from pathlib import Path

import chartgen

MAX_SONG_SEC = 15 * 60
# 가수 찾기(artist.py)에 쓰는 유튜브 정보 칸만 보냄
META_KEYS = ("title", "channel", "uploader", "artists", "artist", "creator", "track", "duration")


def ffmpeg_exe():
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return "ffmpeg"


def friendly_error(e, updater="start.bat을 다시 실행해"):
    msg = str(e)
    low = msg.lower()
    if "sign in" in low or "confirm your age" in low:
        return "로그인/연령 확인이 필요한 영상이라 받을 수 없어요."
    if "private" in low:
        return "비공개 영상이에요."
    if "unavailable" in low or "not available" in low:
        return f"영상을 받을 수 없어요. {updater} yt-dlp를 업데이트한 뒤 시도해 보세요. (" + msg[:120] + ")"
    return msg[:400]


def analyze(vid, progress=lambda stage, msg: None):
    """vid의 오디오를 받아 채보를 분석. progress(stage, msg)로 진행 상황을 알림."""
    try:
        import yt_dlp
    except ImportError:
        raise RuntimeError("유튜브 다운로더(yt-dlp)가 설치되지 않았어요.")
    url = f"https://www.youtube.com/watch?v={vid}"
    progress("info", "영상 정보 확인 중...")
    base_opts = {"quiet": True, "no_warnings": True, "noplaylist": True}
    with yt_dlp.YoutubeDL(base_opts) as ydl:
        info = ydl.extract_info(url, download=False)
    dur = info.get("duration") or 0
    if dur and dur > MAX_SONG_SEC:
        raise ValueError(f"영상이 너무 길어요 ({int(dur // 60)}분). 15분 이하만 가능해요.")
    if info.get("playable_in_embed") is False:
        raise ValueError("이 영상은 다른 사이트에서 재생이 막혀 있어요. 같은 곡의 다른 영상(가사 영상, 공식 오디오 등)으로 시도해 주세요.")
    if info.get("is_live"):
        raise ValueError("라이브 방송은 사용할 수 없어요.")

    with tempfile.TemporaryDirectory() as td:
        last = [-1]

        def hook(d):
            if d.get("status") == "downloading":
                tot = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
                if tot:
                    pct = int(d.get("downloaded_bytes", 0) * 100 / tot)
                    if pct != last[0]:
                        last[0] = pct
                        progress("download", f"오디오 받는 중... {pct}%")

        progress("download", "오디오 받는 중...")
        opts = dict(base_opts, format="bestaudio/best",
                    outtmpl=str(Path(td) / "audio.%(ext)s"), progress_hooks=[hook])
        with yt_dlp.YoutubeDL(opts) as ydl:
            info2 = ydl.extract_info(url, download=True)
        files = [f for f in Path(td).iterdir() if f.is_file() and not f.name.endswith(".part")]
        if not files:
            raise RuntimeError("오디오 파일을 받지 못했어요.")
        audio_file = max(files, key=lambda f: f.stat().st_size)
        progress("analyze", "리듬 분석 중...")
        y = chartgen.decode_audio(audio_file, ffmpeg_exe())
    # 임시 폴더가 닫히면서 오디오 파일은 자동 삭제됨 (채보만 남김)

    seed = int(hashlib.md5(vid.encode()).hexdigest()[:8], 16)
    res = chartgen.generate(y, seed=seed)
    merged = dict(info, **{k: v for k, v in info2.items() if v})
    meta = {k: merged.get(k) for k in META_KEYS if merged.get(k) is not None}
    meta["title"] = info2.get("title") or info.get("title") or vid
    meta["channel"] = info2.get("channel") or info2.get("uploader") or ""
    return meta, res
