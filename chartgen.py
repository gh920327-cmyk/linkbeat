"""
링크비트 채보 자동 생성기
- numpy / scipy 만 사용 (librosa 없이)
- 오디오 → 온셋(소리 시작점) 검출 → 템포/비트 추적 → 4키 채보 (쉬움/보통/어려움)
"""
import bisect
import math

import numpy as np
from scipy.ndimage import uniform_filter1d, maximum_filter1d, median_filter

SR = 22050
NFFT = 1024
HOP = 256
FPS = SR / HOP  # 약 86.13 프레임/초

# 온셋 검출의 체계적 지연 보정(초). 합성 음원 테스트로 맞춘 값.
ONSET_BIAS = 0.007

DIFFS = {
    # subdiv: 박 안에서 허용할 위치 (0=정박, 2=8분 뒷박, 1/3=16분, 4=그리드 밖)
    # hold_beats: 긴 노트 최소 길이(박), max_holds: 동시에 눌러야 하는 긴 노트 수(4키 기준)
    # hold_gap: 긴 노트끼리 최소 간격(박), hold_max: 전체 노트 중 긴 노트 최대 비율
    "easy":   dict(subdiv={0},             min_gap=0.40,  keep=0.55, chord=0.00, jack=0.60, hold_beats=2.0, max_holds=1, overlap=True,  jump2=0.0,
                   hold_gap=8, hold_max=0.07, floor=0.4, vsubdiv={0, 2}),
    "normal": dict(subdiv={0, 2},          min_gap=0.21,  keep=0.75, chord=0.07, jack=0.30, hold_beats=1.5, max_holds=1, overlap=True,  jump2=0.15,
                   hold_gap=6, hold_max=0.07, floor=0.38, vsubdiv={0, 1, 2, 3}),
    "hard":   dict(subdiv={0, 1, 2, 3, 4}, min_gap=0.105, keep=0.93, chord=0.15, jack=0.16, hold_beats=1.25, max_holds=2, overlap=True, jump2=0.30,
                   hold_gap=4, hold_max=0.08, floor=0.26),
    # 극한: 작은 소리까지 잡은 촘촘한 후보(dense)를 쓰고, 동시치기를 늘림
    "extreme": dict(subdiv={0, 1, 2, 3, 4}, min_gap=0.075, keep=1.15, chord=0.26, jack=0.12, hold_beats=1.0, max_holds=2, overlap=True, jump2=0.40, dense=True,
                    hold_gap=3, hold_max=0.08, floor=0.2),
}
DIFF_NAMES = {"easy": "쉬움", "normal": "보통", "hard": "어려움", "extreme": "극한"}


# ---------------------------------------------------------------- 신호 처리
def stft_mag(y):
    pad = NFFT // 2
    yp = np.pad(y, (pad, pad))
    frames = np.lib.stride_tricks.sliding_window_view(yp, NFFT)[::HOP]
    n = frames.shape[0]
    win = np.hanning(NFFT).astype(np.float32)
    out = np.empty((n, NFFT // 2 + 1), np.float32)
    step = 4096
    for i in range(0, n, step):
        out[i:i + step] = np.abs(np.fft.rfft(frames[i:i + step] * win, axis=1))
    return out


def band_matrix(n_bands=36, fmin=30.0, fmax=10500.0):
    freqs = np.fft.rfftfreq(NFFT, 1.0 / SR)
    edges = np.geomspace(fmin, fmax, n_bands + 1)
    W = np.zeros((len(freqs), n_bands), np.float32)
    for b in range(n_bands):
        idx = np.where((freqs >= edges[b]) & (freqs < edges[b + 1]))[0]
        if len(idx) == 0:  # 저역에서 빈이 없으면 가장 가까운 빈 사용
            idx = [int(np.argmin(np.abs(freqs - np.sqrt(edges[b] * edges[b + 1]))))]
        W[idx, b] = 1.0 / len(idx)
    return W, freqs


def onset_envelope(mag):
    W, _ = band_matrix()
    B = np.log1p(100.0 * (mag @ W) / (NFFT / 4))
    d = np.diff(B, axis=0, prepend=B[:1])
    o = np.maximum(d, 0).sum(axis=1)
    # 적응형 기준선 제거
    o = np.maximum(o - uniform_filter1d(o, size=int(FPS * 0.5)), 0)
    # 거의 무음인 곡에서 잡음이 노트가 되지 않게: 가장 큰 소리의 5%를 정규화 하한으로
    p = max(float(np.percentile(o, 99.5)), 0.05 * float(np.percentile(o, 99.99))) + 1e-9
    return np.clip(o / p, 0, 1.5)


# 대역 나누기 (Hz): 저음(킥·베이스) / 중음(스네어·보컬·기타) / 고음(하이햇·신스·고음 멜로디)
BAND_SPLITS = ((0, 250), (250, 2000), (2000, 11000))
# 대역별 가중치: 저음은 원래 크게 잡히므로 살짝 낮추고 중·고음을 살림
BAND_WEIGHTS = (1.0, 1.0, 0.6)   # 고음 대역은 하이햇·심벌이 많아서 조금 낮춤 (고음 멜로디는 대부분 중음 대역)


def band_onsets(mag):
    """대역별 온셋 세기. 각 대역을 '그 대역 안에서' 정규화해서
    작은 고음 소리도 큰 베이스와 같은 기준으로 비교할 수 있게 함. 반환: (3, 프레임)"""
    W, _ = band_matrix()
    edges = np.geomspace(30.0, 10500.0, W.shape[1] + 1)
    centers = np.sqrt(edges[:-1] * edges[1:])
    B = np.log1p(100.0 * (mag @ W) / (NFFT / 4))
    d = np.maximum(np.diff(B, axis=0, prepend=B[:1]), 0)
    out = []
    for lo, hi in BAND_SPLITS:
        cols = (centers >= lo) & (centers < hi)
        e = d[:, cols].sum(axis=1)
        e = np.maximum(e - uniform_filter1d(e, size=int(FPS * 0.5)), 0)
        p = max(float(np.percentile(e, 99.5)), 0.02 * float(np.percentile(e, 99.99)))
        # 거의 소리가 없는 대역은 잡음만 키우지 않도록 제외
        out.append(np.clip(e / (p + 1e-9), 0, 1.5) if p > 1e-3 else np.zeros_like(e))
    return np.array(out)


def pick_onsets(o, delta=0.06, floor=0.05):
    """국소 최대 + 주변 평균보다 delta 이상 큰 지점."""
    w = 3  # ±35ms
    local_max = maximum_filter1d(o, size=2 * w + 1)
    local_mean = uniform_filter1d(o, size=int(FPS * 0.25))
    cand = np.where((o == local_max) & (o >= local_mean + delta) & (o > floor))[0]
    out = []
    last = -999
    for f in cand:
        if f - last >= 4:  # 최소 46ms 간격
            out.append(f)
            last = f
    return np.array(out, dtype=int)


# ---------------------------------------------------------------- 템포 / 비트
def estimate_period(o):
    x = o - o.mean()
    n = len(x)
    F = np.fft.rfft(x, 2 * n)
    ac = np.fft.irfft(F * np.conj(F))[:n]
    lags = np.arange(n, dtype=float)
    lags[0] = 1
    bpm = 60.0 * FPS / lags
    mask = (bpm >= 60) & (bpm <= 200)
    weight = np.exp(-0.5 * (np.log2(bpm / 120.0) / 0.9) ** 2)
    score = np.where(mask, ac * weight, -np.inf)
    if not np.isfinite(score).any():
        return 60.0 * FPS / 120.0   # 너무 짧으면 120 BPM으로 가정
    k = int(np.argmax(score))
    # 포물선 보간으로 소수점 주기
    if 1 <= k < n - 1 and np.isfinite(score[k - 1]) and np.isfinite(score[k + 1]):
        a, b, c = score[k - 1], score[k], score[k + 1]
        den = a - 2 * b + c
        if den != 0:
            k = k + 0.5 * (a - c) / den
    return float(k)


def local_periods(o, period, win_sec=12.0, hop_sec=3.0):
    """곡 구간마다 박 길이(프레임)를 다시 추정 — 중간에 빨라지거나 느려지는 곡 대응.
    전체 템포의 0.55~1.8배 안에서, 전체 템포에 가까운 쪽을 우선해서 찾음(두 배/절반으로 튀는 실수 방지)."""
    n = len(o)
    W, H = int(win_sec * FPS), int(hop_sec * FPS)
    if n < W * 1.5:
        return np.full(n, period)
    lo, hi = int(period * 0.55), int(math.ceil(period * 1.8)) + 1
    cs, ps = [], []
    for st in range(0, n - W + 1, H):
        x = o[st:st + W] - o[st:st + W].mean()
        F = np.fft.rfft(x, 2 * W)
        ac = np.fft.irfft(F * np.conj(F))[:W]
        if ac[0] <= 0 or hi >= W:
            continue
        lags = np.arange(lo, hi, dtype=float)
        # 전체 템포에서 멀수록 살짝 불리하게 (두 배/절반 실수 방지)
        seg = ac[lo:hi] * np.exp(-0.5 * (np.log2(lags / period) / 0.45) ** 2)
        k = int(np.argmax(seg)) + lo
        conf = ac[k] / ac[0]
        kf = float(k)
        if lo < k < hi - 1:
            a, b, c = ac[k - 1], ac[k], ac[k + 1]
            den = a - 2 * b + c
            if den != 0:
                kf = k + 0.5 * (a - c) / den
        cs.append(st + W / 2)
        ps.append(kf if conf > 0.15 else np.nan)
    if not ps:
        return np.full(n, period)
    ps = np.array(ps)
    ps[np.isnan(ps)] = period
    if len(ps) >= 3:
        ps = median_filter(ps, size=3, mode="nearest")
    return np.interp(np.arange(n), cs, ps)


def _ac_peak(ac, lag, n):
    lo, hi = int(lag * 0.94), int(math.ceil(lag * 1.06)) + 1
    if lo < 1 or hi >= n:
        return 0.0
    return float(ac[lo:hi].max())


def _norm_env(e, pct=99.0):
    e = np.maximum(e - uniform_filter1d(e, size=int(FPS * 0.5)), 0)
    p = float(np.percentile(e, pct))
    p = max(p, 0.05 * float(np.percentile(e, 99.99))) + 1e-9
    return np.clip(e / p, 0, 1.5)


def _pitched(X, m, f):
    """음높이 있는 소리(스펙트럼 X)의 온셋 = 새 소리(세기 증가) + 음이 바뀜(이어 부르는 음절).
    반환: 온셋, 존재감(0~1), 음높이(0~1), 세기"""
    LX = np.log1p(100.0 * X / (X.mean() * 50 + 1e-9))
    flux = np.maximum(np.diff(LX, axis=0, prepend=LX[:1]), 0).sum(axis=1)
    nx = X / (np.linalg.norm(X, axis=1, keepdims=True) + 1e-9)
    lag = 3
    cosd = np.ones(len(X))
    cosd[lag:] = (nx[lag:] * nx[:-lag]).sum(axis=1)
    energy = X.sum(axis=1)
    presence = uniform_filter1d(energy / (m.sum(axis=1) + 1e-9), size=int(FPS * 0.4))
    pres_n = np.clip(presence / (np.percentile(presence, 95) + 1e-9), 0, 1)
    loud = np.clip(energy / (np.percentile(energy, 95) + 1e-9), 0, 1)
    novelty = np.maximum(0.0, 1.0 - cosd) * loud
    env = _norm_env(_norm_env(flux) + 0.5 * _norm_env(novelty)) * (0.2 + 0.8 * pres_n)
    # 음높이 (150~1100Hz 무게중심) — 레인 배치용
    pb = (f >= 150) & (f <= 1100)
    vp = (X[:, pb] @ f[pb]) / (X[:, pb].sum(axis=1) + 1e-9)
    vp = uniform_filter1d(np.log2(vp + 50.0), size=5)
    sel = energy > np.percentile(energy, 40)
    lo_, hi_ = np.percentile(vp[sel], [5, 95]) if sel.any() else (0, 1)
    pitch = np.clip((vp - lo_) / (hi_ - lo_ + 1e-9), 0, 1)
    return env, pres_n, pitch, energy


def vocal_drum_analysis(mag, side_mag=None):
    """보컬과 드럼을 따로 듣기.
    - 화음/타악 분리(HPSS): 시간 방향으로 이어지는 성분 = 음높이 있는 소리, 주파수 방향으로 퍼진 순간 성분 = 타악
    - 보컬: 음높이 있는 소리 중 '가운데'(왼쪽·오른쪽이 같은 소리)에 있고 목소리 대역(150~5000Hz)인 부분
    반환: 보컬 온셋, 보컬 존재감(0~1), 보컬 음높이(0~1), 드럼 온셋, 드럼 강도(강타 찾기용)"""
    freqs = np.fft.rfftfreq(NFFT, 1.0 / SR)
    nb = int(np.searchsorted(freqs, 6000))            # 6kHz 위는 보컬·드럼 판단에 거의 안 씀 (빠르게)
    m = mag[:, :nb].astype(np.float32)
    harm = median_filter(m, size=(15, 1))
    perc = median_filter(m, size=(1, 15))
    hmask = harm ** 2 / (harm ** 2 + perc ** 2 + 1e-12)
    H, P = m * hmask, m * (1 - hmask)
    if side_mag is not None:
        s_ = side_mag[:, :nb]
        w = m ** 2 / (m ** 2 + s_ ** 2 + 1e-12)            # 1이면 가운데, 0.5면 한쪽
        cw = median_filter(np.clip((w - 0.5) * 2.0, 0, 1), size=(5, 3))
        center = cw ** 3                                   # 보컬: 가운데에 있는 소리만 (좌우로 벌린 기타·패드 제외)
        dcenter = cw ** 1.2                                # 드럼(킥·스네어)도 보통 가운데
    else:
        center = dcenter = 1.0
    f = freqs[:nb]
    vw = np.where((f >= 150) & (f <= 5000), 1.0, 0.0) * (0.4 + 0.6 * np.exp(-((np.log2(np.maximum(f, 1)) - np.log2(1200)) / 1.6) ** 2))
    V = H * center * vw
    voc, pres_n, vpitch, venergy = _pitched(V, m, f)
    # 악기 멜로디: 가운데가 아닌(좌우로 벌린) 음높이 있는 소리 — 보컬이 쉬는 간주의 기타·신스 리드
    if side_mag is not None:
        iw = np.where((f >= 100) & (f <= 5000), 1.0, 0.0)
        I = H * (1.0 - center) * iw
        ins, _, ipitch, ienergy = _pitched(I, m, f)
        # 순간마다 '가장 잘 들리는 음높이 소리'가 악기 쪽인 정도 (0~1): 보컬과 악기의 귀에 들리는 세기 비교
        ve = uniform_filter1d(venergy, size=int(FPS * 0.6))
        ie = uniform_filter1d(ienergy, size=int(FPS * 0.6))
        share = ie / (ve + ie + 1e-9)
        idom = np.clip((share - 0.4) / 0.25, 0, 1)
        # 곡 전체에서 큰 음높이 소리에 비해 충분히 커야 '주인공' (작게 깔린 패드는 제외)
        iloud = np.clip(ie / (float(np.percentile(ve + ie, 95)) + 1e-9) / 0.35, 0, 1)
        idom = uniform_filter1d(idom * iloud, size=int(FPS * 0.5))
    else:
        ins, ipitch, idom = np.zeros(len(m)), np.zeros(len(m)), np.zeros(len(m))
    # 드럼: 타악 성분의 저음(킥)·중음(스네어) 세기 변화
    Pc = P * dcenter
    LP = np.log1p(100.0 * Pc / (Pc.mean() * 50 + 1e-9))
    dP = np.maximum(np.diff(LP, axis=0, prepend=LP[:1]), 0)
    kick = dP[:, f < 160].sum(axis=1)
    snare = dP[:, (f >= 160) & (f < 5000)].sum(axis=1)
    drum = _norm_env(_norm_env(kick) + _norm_env(snare))
    # 강타 찾기용: 실제 소리 크기(로그 아님)가 얼마나 '확' 커지는지 — 킥+스네어 + 심벌(5kHz 이상)
    def rise(e):
        e = uniform_filter1d(e, size=3)
        r = np.maximum(np.roll(e, -2) - np.roll(e, 2), 0)
        return r / (np.percentile(r, 99) + 1e-12)
    ldr = rise((Pc[:, f < 5000] ** 2).sum(axis=1))
    hi = mag[:, int(np.searchsorted(freqs, 5000)):]
    cym = rise((hi ** 2).sum(axis=1))
    power = ldr + 1.2 * cym

    def peak_scale(e):
        """보컬과 드럼을 같은 기준으로 비교하도록: 뚜렷한 봉우리들의 중간값이 1이 되게"""
        pk = pick_onsets(e, 0.03, 0.02)
        if len(pk) < 8:
            return e
        return np.clip(e / (float(np.median(e[pk])) + 1e-9), 0, 1.5)
    return dict(voc=peak_scale(voc), vpres=pres_n, vpitch=vpitch, drum=peak_scale(drum), power=power,
                ins=peak_scale(ins) if idom.any() else ins, ipitch=ipitch, idom=idom, venergy=venergy)


def choose_tempo_octave(bands, period):
    """빠른 곡을 절반 템포로 잡는 실수 고치기.
    킥·스네어·멜로디(저음+중음 대역)가 반 박마다 규칙적으로 나오면 실제 박은 두 배 빠른 쪽."""
    x = bands[0] + bands[1]
    x = x - x.mean()
    n = len(x)
    if n < 4 * period:
        return period
    F = np.fft.rfft(x, 2 * n)
    ac = np.fft.irfft(F * np.conj(F))[:n]
    half = period / 2
    if 60.0 * FPS / half <= 205 and _ac_peak(ac, half, n) >= 0.62 * _ac_peak(ac, period, n):
        return half
    return period


def track_beats(o, period, tightness=100.0):
    """Ellis(2007) 동적계획 비트 추적. period는 숫자(고정 템포) 또는 프레임별 배열(변하는 템포)."""
    n = len(o)
    per = np.full(n, float(period)) if np.isscalar(period) else np.asarray(period, float)
    pm = float(np.median(per))
    osd = o / (o.std() + 1e-9)
    sig = pm / 32.0
    t = np.arange(-int(4 * sig) - 1, int(4 * sig) + 2)
    win = np.exp(-0.5 * (t / max(sig, 0.5)) ** 2)
    local = np.convolve(osd, win, mode="same")

    cum = local.copy()
    back = np.full(n, -1, dtype=int)
    for i in range(n):
        p = per[i]
        prange = np.arange(-int(round(2 * p)), -int(round(p / 2)) + 1)
        tr = i + prange
        v = tr >= 0
        if not v.any():
            continue
        txcost = -tightness * np.log(-prange[v] / p) ** 2
        sc = txcost + cum[tr[v]]
        k = int(np.argmax(sc))
        if sc[k] > 0:
            cum[i] = local[i] + sc[k]
            back[i] = tr[v][k]
    # 마지막 비트: 끝부분 한 주기 안에서 최고 점수
    tail = max(0, n - int(per[-1] * 1.5))
    i = tail + int(np.argmax(cum[tail:]))
    beats = []
    while i >= 0:
        beats.append(i)
        i = back[i]
    return np.array(beats[::-1], dtype=int)


def build_grid(beat_times, beat_len, duration):
    bt = list(beat_times)
    if len(bt) < 2:
        bt = list(np.arange(0, duration + beat_len, beat_len))
    # 앞뒤는 가장 가까운 박 간격으로 늘림 (템포가 변하는 곡 대응)
    first = (bt[1] - bt[0]) if len(bt) >= 2 and 0.5 * beat_len < bt[1] - bt[0] < 2 * beat_len else beat_len
    last = (bt[-1] - bt[-2]) if len(bt) >= 2 and 0.5 * beat_len < bt[-1] - bt[-2] < 2 * beat_len else beat_len
    while bt[0] - first > -first * 0.5:
        bt.insert(0, bt[0] - first)
    while bt[-1] < duration + last:
        bt.append(bt[-1] + last)
    bt = np.array(bt)
    grid_t, grid_pos = [], []
    for i in range(len(bt) - 1):
        a, b = bt[i], bt[i + 1]
        for k in range(4):
            grid_t.append(a + (b - a) * k / 4)
            grid_pos.append(k)
    return np.array(grid_t), np.array(grid_pos), bt


# ---------------------------------------------------------------- 하이라이트(후렴) 찾기
def _beat_sync(X, bf):
    """프레임 특징 X (프레임, ...) 를 박 구간마다 평균. bf: 박 경계 프레임 (박 수 + 1)"""
    cs = np.concatenate([np.zeros((1,) + X.shape[1:]), np.cumsum(X, axis=0)])
    a, b = bf[:-1], np.maximum(bf[1:], bf[:-1] + 1)
    return (cs[b] - cs[a]) / (b - a).reshape((-1,) + (1,) * (X.ndim - 1))


def _z(x):
    x = np.asarray(x, float)
    sd = float(x.std())
    return (x - x.mean()) / sd if sd > 1e-9 else np.zeros_like(x)


def find_highlight(mag, beat_times, o, loud_db, vpres, vpitch, venergy, accents, duration):
    """곡에서 가장 '잘 들리는' 구간(대개 후렴)을 찾음.
    - 반복: 같은 화음·멜로디(크로마)가 곡 안에서 몇 번이나 다시 나오는지 (자기유사도)
    - 에너지: 소리 크기, 소리 촘촘함(온셋 밀도)
    - 보컬: 목소리가 뚜렷하고 높은지
    - 경계: 구간이 바뀌는 지점(노벨티)에서 시작하도록, 마디 첫 박에 맞춤
    반환: ({"start", "end"}, [[후렴 시작, 끝], ...]) — 못 찾으면 (None, [])"""
    bt = np.asarray(beat_times, float)
    nfr = len(o)
    if len(bt) < 48 or duration < 40:
        return None, []
    beat_len = float(np.median(np.diff(bt)))
    bf = np.clip(np.round(np.append(bt, bt[-1] + beat_len) * FPS).astype(int), 0, nfr)
    n = len(bt)
    # 특징: 크로마(12음) — 화음·멜로디가 같은지 / 음색(대역 에너지) / 크기 / 온셋 밀도 / 보컬
    freqs = np.fft.rfftfreq(NFFT, 1.0 / SR)
    pb = np.where((freqs >= 65) & (freqs <= 2100))[0]
    pc = np.round(12 * np.log2(freqs[pb] / 440.0)).astype(int) % 12
    Pm = np.zeros((len(pb), 12), np.float32)
    Pm[np.arange(len(pb)), pc] = 1.0
    chroma = np.log1p(10.0 * (mag[:, pb] @ Pm) / (mag[:, pb].sum(axis=1, keepdims=True) + 1e-9))
    W, _ = band_matrix(12, 60.0, 10000.0)
    timb = np.log1p(100.0 * (mag @ W) / (NFFT / 4))
    C = _beat_sync(chroma, bf)
    T = _beat_sync(timb, bf)
    Lb = _beat_sync(loud_db[:, None], bf)[:, 0]
    Ob = _beat_sync(o[:, None], bf)[:, 0]
    Vb = _beat_sync(np.log10(venergy + 1e-9)[:, None], bf)[:, 0]   # 목소리 크기 (다른 악기가 많아져도 비율처럼 줄지 않게)
    Pb = _beat_sync((vpitch * (vpres > 0.3))[:, None], bf)[:, 0] / np.maximum(_beat_sync((vpres > 0.3).astype(float)[:, None], bf)[:, 0], 0.2)
    # 반복 찾기용: 4박(한 마디) 크로마를 이어 붙여서 '흐름'이 같은지 비교
    Cn = C - C.mean(axis=1, keepdims=True)
    Cn /= np.linalg.norm(Cn, axis=1, keepdims=True) + 1e-9
    St = np.concatenate([np.roll(Cn, -k, axis=0) for k in range(4)], axis=1) / 2.0
    S = St @ St.T                                   # 박 x 박 유사도 (-1 ~ 1)
    S[:, n - 3:] = 0
    S[n - 3:, :] = 0
    # 구간 경계(노벨티): 박 단위 크로마+음색 유사도에 체커보드 커널
    Tn = (T - T.mean(axis=0)) / (T.std(axis=0) + 1e-9)
    Tn /= np.linalg.norm(Tn, axis=1, keepdims=True) + 1e-9
    F = np.concatenate([Cn, Tn, 0.5 * _z(Lb)[:, None] / 3], axis=1)
    F /= np.linalg.norm(F, axis=1, keepdims=True) + 1e-9
    G = F @ F.T
    K = 8
    g = np.exp(-0.5 * (np.linspace(-1, 1, 2 * K) / 0.5) ** 2)
    ker = np.outer(g, g) * np.outer(np.r_[-np.ones(K), np.ones(K)], np.r_[-np.ones(K), np.ones(K)])
    Gp = np.pad(G, K, mode="edge")
    nov = np.array([float((Gp[i:i + 2 * K, i:i + 2 * K] * ker).sum()) for i in range(n)])
    nov = np.maximum(nov, 0)
    nov /= float(np.percentile(nov, 98)) + 1e-9
    # 강타(심벌)는 구간 시작 신호
    acc_b = np.zeros(n)
    for a in accents:
        j = int(np.searchsorted(bt, a - 0.06))
        if j < n and abs(bt[j] - a) < 0.08:
            acc_b[j] = 1.0
    # 마디 첫 박 찾기: 구간 경계·강타(심벌)·화음이 바뀌는 박이 가장 많이 몰리는 위상
    # (킥은 1·3박에 똑같이 나와서 구분이 안 되므로 쓰지 않음)
    # 화음 변화: 바로 앞 박과 크로마가 얼마나 다른지 (마디 첫 박에서 화음이 잘 바뀜)
    hc = np.zeros(n)
    hc[1:] = np.maximum(0.0, 1.0 - (Cn[1:] * Cn[:-1]).sum(axis=1))
    # 2박 단위 변화도 함께 (한 박 안의 꾸밈음에 덜 흔들리게)
    c2 = Cn + np.roll(Cn, 1, axis=0)
    c2 /= np.linalg.norm(c2, axis=1, keepdims=True) + 1e-9
    hc2 = np.zeros(n)                                  # hc2[j]: (j-2, j-1) 박 vs (j, j+1) 박
    hc2[2:n - 1] = np.maximum(0.0, 1.0 - (c2[3:] * c2[1:n - 2]).sum(axis=1))

    def contrast(v):                                   # 4개 위상 값을 같은 척도로 (평균 0, 흩어짐 1)
        v = np.asarray(v, float)
        return (v - v.mean()) / (v.std() + 1e-9) if v.std() > 1e-9 else np.zeros(4)
    ph_hc = contrast([hc[p::4].mean() + hc2[p::4].mean() for p in range(4)])
    ph_nov = contrast([nov[p::4].mean() for p in range(4)])
    ph_acc = contrast([acc_b[p::4].sum() for p in range(4)]) * min(1.0, acc_b.sum() / 6.0)
    ph_score = list(1.0 * ph_hc + 0.6 * ph_nov + 0.5 * ph_acc)
    ph = int(np.argmax(ph_score))
    # 시작·끝 후보: 모든 마디 첫 박 (경계가 뚜렷할수록 점수 가산)
    bars = np.arange(ph, n, 4)
    nb_all = np.zeros(n + 1)
    nb_all[:n] = np.minimum(1.0, nov + 0.6 * acc_b)
    nb_all[n] = 1.0
    starts = [int(b) for b in bars]
    # 대각선 누적합 (지연 L마다): 구간 [a, a+len)이 L박 뒤/앞과 얼마나 같은지 빠르게 계산
    min_lag = 16
    diag_cs = {L: np.concatenate([[0.0], np.cumsum(np.diagonal(S, L))]) for L in range(min_lag, n - 8)}

    def repeat_score(a, ln):
        best = []
        for L, cs in diag_cs.items():
            if L < max(min_lag, ln // 2):
                continue
            for b0 in (a, a - L):          # 뒤에 같은 게 또 나옴 / 앞에 같은 게 있었음
                if b0 < 0 or b0 + ln > len(cs) - 1:
                    continue
                best.append(((cs[b0 + ln] - cs[b0]) / ln, b0 + L if b0 == a else b0))
        if not best:
            return 0.0, []
        best.sort(key=lambda x: -x[0])
        occ = []
        for v, pos in best:
            if all(abs(pos - q) >= ln * 0.6 for _, q in occ) and abs(pos - a) >= ln * 0.6:
                occ.append((v, pos))
            if len(occ) >= 12:
                break
        vals = [v for v, _ in occ] + [0.0, 0.0]
        return 0.8 * vals[0] + 0.2 * vals[1], occ   # 반복되는지가 핵심, 더 많이 반복되면 조금 가산

    # 곡 전체 기준값 (구간 점수를 곡마다 같은 척도로)
    Lz, Oz, Vz, Pz = _z(Lb), _z(np.log1p(20 * Ob)), _z(Vb), _z(Pb)
    cands = []
    for a in starts:
        for e in starts + [n]:
            ln = e - a
            sec = ln * beat_len
            if sec < 11 or sec > 36 or a * beat_len + bt[0] < 0.06 * duration:
                continue
            rep, occ = repeat_score(a, ln)
            en = float(Lz[a:e].mean())
            den = float(Oz[a:e].mean())
            voc = float(Vz[a:e].mean())
            pit = float(Pz[a:e].mean())
            score = 1.6 * rep + 0.55 * en + 0.5 * den + 0.15 * voc + 0.4 * pit + 0.5 * float(nb_all[a]) + 0.25 * float(nb_all[e]) \
                - 0.25 * abs(math.log(sec / 20.0))
            cands.append((score, a, e, occ, rep))
    if not cands:
        return None, []
    cands.sort(key=lambda x: -x[0])
    score, a, e, occ, rep = cands[0]
    ln = e - a
    # 같은 후렴이 곡 안에서 반복되는 곳들 (후렴 강조용) — 원래 구간과 비슷하게 크고 비슷하게 같아야
    chorus = [(a, e)]
    en0 = float(Lb[a:e].mean())
    for v, pos in occ:
        if v >= max(0.45, 0.75 * rep) and float(Lb[pos:pos + ln].mean()) >= en0 - 4.0:
            chorus.append((pos, min(n, pos + ln)))
    chorus.sort()
    merged = []
    for x, y in chorus:
        if merged and x <= merged[-1][1] + 2:
            merged[-1] = (merged[-1][0], max(merged[-1][1], y))
        else:
            merged.append((x, y))

    def tsec(i):
        return float(bt[i]) if i < n else float(bt[-1] + beat_len)
    hl = {"start": round(tsec(a), 3), "end": round(min(duration - 0.5, tsec(e)), 3)}
    return hl, [[round(tsec(x), 3), round(min(duration - 0.5, tsec(y)), 3)] for x, y in merged]


def highlight_from_notes(notes, beats, bpm, offset, duration, win=20.0):
    """음원 분석 전에 만든 곡용: 노트가 가장 몰린 20초 (마디 경계에서 시작)를 하이라이트로 어림."""
    ts = np.sort(np.array([float(n["t"]) for n in notes or []]))
    if len(ts) < 20 or duration < 40:
        return None
    if beats and len(beats) > 16:
        starts = np.asarray(beats, float)
    else:
        bl = 60.0 / (bpm or 120.0)
        starts = np.arange(float(offset or 0) % bl, duration, bl)
    starts = starts[(starts >= 0.08 * duration) & (starts + win <= duration - 1.0)]
    if not len(starts):
        return None
    cnt = np.searchsorted(ts, starts + win) - np.searchsorted(ts, starts)
    # 시작 직전보다 시작 직후가 촘촘한 곳(구간이 바뀌는 곳)을 조금 우선
    before = np.searchsorted(ts, starts) - np.searchsorted(ts, starts - 4.0)
    after = np.searchsorted(ts, starts + 4.0) - np.searchsorted(ts, starts)
    score = cnt + 0.8 * np.maximum(0, after - before)
    i = int(np.argmax(score))
    return {"start": round(float(starts[i]), 3), "end": round(float(starts[i] + win), 3)}


def play_range(song):
    """하이라이트 모드로 플레이할 구간. start: 영상 시작(한 마디 앞), from: 노트 시작, end: 끝.
    후렴이 두 번 이어지면 함께, 너무 짧으면 15초까지 늘림 (최대 40초)."""
    duration = float(song.get("duration") or 0)
    hl, src = song.get("highlight"), "audio"
    if not hl:
        src = "notes"
        charts = song.get("charts") or {}
        hl = highlight_from_notes(charts.get("normal") or charts.get("hard") or [], song.get("beats"),
                                  song.get("bpm"), song.get("offset"), duration)
    if not hl:
        return None
    frm, end = float(hl["start"]), float(hl["end"])
    for a, b in song.get("chorus") or []:
        if a - 0.1 <= frm < b:
            end = max(end, float(b))
    end = min(end, frm + 40.0)
    if end - frm < 15.0:
        end = frm + 15.0
    end = min(end, duration - 0.3)
    if end - frm < 8.0:
        return None
    beat = 60.0 / float(song.get("bpm") or 120.0)
    start = max(0.0, frm - min(3.5, max(1.5, 4 * beat)))
    return {"start": round(start, 3), "from": round(frm, 3), "end": round(end, 3), "src": src}


# ---------------------------------------------------------------- 채보 생성
def _select(cands, cfg):
    """cands: list of dict(t,pos,s). 난이도 규칙에 맞게 고르기."""
    # 목소리가 뚜렷한 음절은 엇박(쉬움 8분, 보통 16분)에 있어도 넣음 — 노래 리듬을 따라가게
    vsub = cfg.get("vsubdiv", cfg["subdiv"])
    pool = [c for c in cands if c["pos"] in cfg["subdiv"]
            or (c["pos"] in vsub and c.get("voc", 0) >= max(0.8, c.get("drum", 0)))]
    if not pool:
        return []
    # 남길 비율을 '구간마다' 따로 계산 (앞뒤 8초 안에서 순위) — 조용한 구간도 리듬이 살아 있고,
    # 에너지가 높은 구간(후렴)은 더 많이 남김
    pool.sort(key=lambda c: c["t"])
    T = np.array([c["t"] for c in pool])
    S = np.array([c["s"] for c in pool])
    lo = np.searchsorted(T, T - 8.0)
    hi = np.searchsorted(T, T + 8.0)
    kept = []
    floor = cfg.get("floor", 0.3)
    for i, c in enumerate(pool):
        win = S[lo[i]:hi[i]]
        if c.get("acc"):                    # 드럼 강타는 항상 남김
            kept.append(c)
            continue
        # 주변(앞뒤 8초)의 큰 소리에 비해 너무 약한 소리(하이햇 잔향·잡음)는 버림
        if S[i] < floor * float(np.quantile(win, 0.9)):
            continue
        keep = min(1.0, cfg["keep"] * (0.85 + 0.3 * c.get("e", 0.5)) * (1.1 if c.get("ch") else 1.0))
        if keep >= 1.0 or S[i] >= np.quantile(win, 1 - keep):
            kept.append(c)
    pool = kept
    # 강한 것부터 최소 간격을 지키며 채택
    pool.sort(key=lambda c: (not c.get("acc"), -c["s"]))   # 강타 먼저, 그다음 센 소리부터
    taken_t = []
    out = []
    for c in pool:
        j = np.searchsorted(taken_t, c["t"])
        ok = True
        gap = cfg["min_gap"] * c.get("gm", 1.0)
        if j > 0 and c["t"] - taken_t[j - 1] < gap:
            ok = False
        if j < len(taken_t) and taken_t[j] - c["t"] < gap:
            ok = False
        if ok:
            taken_t.insert(j, c["t"])
            out.append(c)
    out.sort(key=lambda c: c["t"])
    return out


def _make_chart(cands, cfg, feat, sus_len, beat_len, rng, s_hi, nl=4, sel=None):
    """nl: 레인 수 (4 또는 6). sel: 미리 고른 노트 후보(4키·6키가 같은 선택을 공유)"""
    if sel is None:
        sel = _select(cands, cfg)
    if nl == 6:  # 6키는 같은 노트 수로도 손이 덜 바빠서 동시치기를 조금 더
        cfg = dict(cfg, chord=min(0.3, cfg["chord"] * 1.5), max_holds=cfg["max_holds"] + (1 if cfg["max_holds"] >= 2 else 0))
    last = nl - 1
    notes = []
    busy = [-1.0] * nl          # 긴 노트로 막힌 레인의 해제 시각
    lane_last = [-9.0] * nl
    last_lane = int(rng.integers(0, nl))
    last_feat = None
    recent = []                 # 최근 노트의 레인 (고르게 쓰도록)
    half = beat_len / 2
    last_hold, n_holds = -1e9, 0
    fill_run, fill_dir = [], 1
    for idx, c in enumerate(sel):
        t = c["t"]
        free = [l for l in range(nl) if busy[l] < t - 0.06]
        if not free:
            continue
        nojack = [l for l in free if t - lane_last[l] >= cfg["jack"]] or free

        # 음높이 윤곽을 따라 좌/우로 이동 (보컬은 목소리 음높이, 드럼은 저음=왼쪽/고음=오른쪽 경향)
        f = feat(t, c)
        if "band" in c:
            f = 0.7 * f + 0.3 * (0.1, 0.5, 0.9)[c["band"]]
        if last_feat is None or abs(f - last_feat) < 0.04:
            direction = int(rng.choice([-1, 1]))
        else:
            direction = 1 if f > last_feat else -1
        step = 2 if rng.random() < cfg["jump2"] else 1
        target = last_lane + direction * step
        if target < 0:
            target = -target
        if target > last:
            target = 2 * last - target
        target = int(np.clip(target, 0, last))
        if rng.random() < 0.3:  # 음높이 절대값도 섞어서 양 끝 레인 활용
            target = int(round(f * last))
        if c.get("fill") and cfg["chord"] > 0:
            # 드럼 필인: 한 방향으로 흐르는 계단 (끝에 닿으면 반대로)
            if not (fill_run and t - fill_run[-1] <= beat_len):
                fill_dir = 1 if last_lane < nl / 2 else -1
                fill_run = []
            nxt = last_lane + fill_dir
            if not 0 <= nxt <= last:
                fill_dir = -fill_dir
                nxt = last_lane + fill_dir
            target = int(np.clip(nxt, 0, last))
            fill_run.append(t)
        scale = 3.0 / last  # 6키도 4키와 같은 감각으로 거리 계산
        lane = min(nojack, key=lambda l: abs(l - target) * scale + 0.6 * recent.count(l) + 0.01 * rng.random())
        recent = (recent + [lane])[-(nl * 2):]
        last_feat = f

        # 긴 노트: 소리가 길게 이어지는 정박/반박 노트 (너무 많지 않게: 간격·비율 제한)
        d = 0.0
        active = sum(1 for l in range(nl) if busy[l] >= t)
        hold_ok = (t - last_hold >= cfg.get("hold_gap", 4) * beat_len
                   and n_holds < max(1, int(cfg.get("hold_max", 0.08) * len(sel))))
        if c["pos"] in (0, 2) and active < cfg["max_holds"] and hold_ok:
            L = c["sus"] if "sus" in c else sus_len(t, 4 * beat_len)
            if L >= cfg["hold_beats"] * beat_len:
                d = max(half, np.floor(L / half) * half - 0.05)
                if not cfg["overlap"] and idx + 1 < len(sel):
                    d = min(d, sel[idx + 1]["t"] - t - half)
                d = float(min(d, 4.0)) if d >= 0.3 else 0.0
                if d > 0:
                    last_hold, n_holds = t, n_holds + 1
        acc = bool(c.get("acc"))
        if acc:
            d = 0.0                              # 강타는 짧고 강하게
        head = {"t": round(t, 3), "l": lane, "d": round(d, 3)}
        if acc:
            head["a"] = 1
        notes.append(head)
        lane_last[lane] = t
        busy[lane] = t + d + 0.05
        last_lane = lane

        if acc:
            # 드럼 강타: 쉬움은 한 개(대신 크게 터지는 연출), 보통·어려움 2개, 극한 3개 동시치기 (6키는 하나 더)
            extra = 0 if cfg["chord"] == 0 else (2 if cfg["chord"] >= 0.2 else 1) + (1 if nl == 6 and cfg["chord"] >= 0.1 else 0)
            for _ in range(extra):
                others = [l for l in range(nl) if busy[l] < t - 0.06 and all(n["l"] != l or n["t"] != round(t, 3) for n in notes[-4:])]
                if not others:
                    break
                used = [n["l"] for n in notes if n["t"] == round(t, 3)]
                l2 = max(others, key=lambda l: (min(abs(l - u) for u in used), rng.random()))   # 서로 멀리 (양손)
                notes.append({"t": round(t, 3), "l": l2, "d": 0.0, "a": 1})
                lane_last[l2] = t
                busy[l2] = t + 0.05
            continue

        # 동시치기(코드): 매우 강한 정박
        if cfg["chord"] > 0 and c["pos"] == 0 and c.get("e", 1.0) >= 0.3 and c["s"] >= s_hi(cfg["chord"]):
            others = [l for l in range(nl) if l != lane and busy[l] < t - 0.06]
            if others:
                l2 = min(others, key=lambda l: (abs(l - (last - lane)), rng.random()))
                notes.append({"t": round(t, 3), "l": l2, "d": 0.0})
                lane_last[l2] = t
                busy[l2] = t + 0.05
    notes.sort(key=lambda n: (n["t"], n["l"]))
    return notes


def convert_to_6(notes, seed=0):
    """예전 곡용: 4키 채보를 6키로 변환 (레인을 넓게 펼치고 연타·겹침을 피함)."""
    rng = np.random.default_rng(seed)
    spread = {0: (0, 1), 1: (1, 2), 2: (3, 4), 3: (4, 5)}
    busy = [-1.0] * 6
    lane_last = [-9.0] * 6
    out = []
    for n in sorted(notes, key=lambda n: (n["t"], n["l"])):
        t, d = float(n["t"]), float(n.get("d", 0) or 0)
        cands = [l for l in spread[int(n["l"]) % 4] if busy[l] < t - 0.03]
        if not cands:
            cands = [l for l in range(6) if busy[l] < t - 0.03]
        if not cands:
            continue
        lane = max(cands, key=lambda l: (t - lane_last[l]) + 0.01 * rng.random())
        out.append({"t": round(t, 3), "l": lane, "d": round(d, 3)})
        lane_last[lane] = t
        busy[lane] = t + d + 0.03
    return out


def densify_chart(notes, bpm, offset, nl=4, seed=0):
    """예전 곡용: 어려움 채보에서 극한 채보를 만듦.
    - 노트 사이가 넉넉하면(0.17~0.65초) 16분 격자 위에 노트를 하나 끼워 넣음
    - 정박 노트 일부를 동시치기로
    음원 없이 만드는 근사치라, '자동 채보 다시 만들기'를 하면 음원 분석으로 제대로 만들어져요."""
    rng = np.random.default_rng(seed)
    beat = 60.0 / (bpm or 120.0)
    sub = beat / 4
    ns = sorted(({"t": float(n["t"]), "l": int(n["l"]), "d": float(n.get("d", 0) or 0)} for n in notes),
                key=lambda n: (n["t"], n["l"]))
    if not ns:
        return []

    holds = sorted((n["t"] - 0.03, n["t"] + n["d"] + 0.06, n["l"]) for n in ns if n["d"] > 0)
    hstart = [h[0] for h in holds]
    max_len = max((h[1] - h[0] for h in holds), default=0.0)

    def held(t):  # t에 긴 노트로 막혀 있는 레인 (정렬된 목록에서 근처만 확인)
        hi = bisect.bisect_right(hstart, t)
        lo = bisect.bisect_left(hstart, t - max_len)
        return {holds[i][2] for i in range(lo, hi) if holds[i][1] >= t}

    times = sorted({n["t"] for n in ns})
    by_t = {}
    for n in ns:
        by_t.setdefault(n["t"], []).append(n["l"])
    extra = []
    for a, b in zip(times, times[1:]):
        gap = b - a
        if gap < 0.17 or gap > 0.65 or rng.random() > (0.5 if nl == 4 else 0.33):
            continue
        mid = (a + b) / 2
        k = round((mid - offset) / sub)
        tm = offset + k * sub
        if tm - a < 0.075 or b - tm < 0.075:
            tm = mid
            if tm - a < 0.075 or b - tm < 0.075:
                continue
        avoid = set(by_t[a]) | set(by_t[b]) | held(tm)
        free = [l for l in range(nl) if l not in avoid]
        if not free:
            continue
        la = by_t[a][0]
        lane = min(free, key=lambda l: (abs(abs(l - la) - 1.5), rng.random()))
        extra.append({"t": round(tm, 3), "l": lane, "d": 0.0})
    for t in times:  # 정박 노트 동시치기
        if len(by_t[t]) != 1:
            continue
        ph = (t - offset) / beat
        if abs(ph - round(ph)) > 0.04 or rng.random() > 0.15:
            continue
        l0 = by_t[t][0]
        free = [l for l in range(nl) if l != l0 and l not in held(t)]
        if free:
            l2 = min(free, key=lambda l: (abs(l - (nl - 1 - l0)), rng.random()))
            extra.append({"t": round(t, 3), "l": l2, "d": 0.0})
    out = [{"t": round(n["t"], 3), "l": n["l"], "d": round(n["d"], 3)} for n in ns] + extra
    out.sort(key=lambda n: (n["t"], n["l"]))
    return out


def generate(y, seed=0):
    """y: float32 오디오 (SR=22050). 모노 (n,) 또는 스테레오 (n, 2). 반환: 메타 + 채보 dict.
    스테레오면 '가운데' 소리를 골라 보컬을 더 정확히 찾아요."""
    y = np.asarray(y, dtype=np.float32)
    side = None
    if y.ndim == 2 and y.shape[1] >= 2:
        side = (y[:, 0] - y[:, 1]) * 0.5
        y = (y[:, 0] + y[:, 1]) * 0.5
        if float(np.max(np.abs(side))) < 1e-4 * max(1e-9, float(np.max(np.abs(y)))):
            side = None                     # 사실상 모노
    elif y.ndim == 2:
        y = y[:, 0]
    peak = float(np.max(np.abs(y))) if len(y) else 0.0
    if peak < 1e-4:
        raise ValueError("소리가 거의 없는 오디오예요.")
    y = y / peak
    if side is not None:
        side = side / peak
    duration = len(y) / SR
    if duration < 5:
        raise ValueError("곡이 너무 짧아요. 5초 이상인 영상을 넣어 주세요.")

    mag = stft_mag(y)
    o = onset_envelope(mag)

    period = estimate_period(o)
    bands = band_onsets(mag)          # 저/중/고음 대역별 온셋
    period = choose_tempo_octave(bands, period)
    beat_frames = track_beats(o, local_periods(o, period))
    beat_times = beat_frames / FPS + ONSET_BIAS
    if len(beat_times) >= 4:
        # 비트 시각에 직선을 맞춰 정밀한 BPM 계산
        beat_len = float(np.polyfit(np.arange(len(beat_times)), beat_times, 1)[0])
    else:
        beat_len = period / FPS
    bpm = 60.0 / beat_len
    grid_t, grid_pos, beats_ext = build_grid(beat_times, beat_len, duration)

    # 온셋 → 그리드 스냅
    sub = beat_len / 4

    # 프레임 음량(dB): 곡에서 가장 큰 소리보다 40dB 이상 작은(거의 무음) 곳의 잡음은 노트로 만들지 않음
    loud_raw = 10 * np.log10(np.einsum("ij,ij->i", mag, mag) / mag.shape[1] + 1e-10)
    loud_gate = float(np.percentile(loud_raw, 99.9)) - 40.0
    bmax = maximum_filter1d(bands, size=3, axis=1)
    # 고음 중 '음높이가 있는 소리'(신스·보컬 고음)와 '치익' 하는 잡음(하이햇)을 구분:
    # 시간 방향 중앙값 필터로 잠깐이라도 이어지는 성분만 남겨서, 그게 새로 생겼는지 봄
    fq = np.fft.rfftfreq(NFFT, 1.0 / SR)
    hb = (fq >= 1200) & (fq <= 6000)
    hsus = median_filter(mag[:, hb], size=(9, 1)).sum(axis=1)
    hsus = np.log1p(100.0 * hsus / (hsus.max() + 1e-9))
    tonal_on = np.maximum(np.roll(hsus, -5) - np.roll(hsus, 3), 0)
    tonal_on = np.clip(tonal_on / (np.percentile(tonal_on, 99) + 1e-6), 0, 1.5)
    # 보컬·드럼 따로 듣기 (보컬을 가장 중요하게)
    an = vocal_drum_analysis(mag, stft_mag(side) if side is not None else None)
    voc, vpres, vpitch, drum, dpower = an["voc"], an["vpres"], an["vpitch"], an["drum"], an["power"]
    ins, ipitch, idom = an["ins"], an["ipitch"], an["idom"]
    vmax = maximum_filter1d(voc, size=5)
    dmax = maximum_filter1d(drum, size=5)
    # 악기 멜로디는 '그 순간 가장 잘 들리는 음높이 소리'가 악기일 때만 보컬처럼 대접 (간주의 리드 기타·신스)
    # 실제로 '탁' 하고 시작하는 소리가 있을 때만 (좌우로 넓게 깔린 패드가 천천히 일렁이는 것은 제외)
    attack = np.clip(maximum_filter1d(o, size=5) / 0.1, 0, 1)
    imax = maximum_filter1d(ins, size=5) * idom * attack

    def build_cands(onset_frames, band=None):
        out = {}
        for f in onset_frames:
            if loud_raw[min(len(loud_raw) - 1, f + 2)] < loud_gate and loud_raw[f] < loud_gate:
                continue
            t = f / FPS + ONSET_BIAS
            if t < 0.15 or t > duration - 0.3:
                continue
            j = int(np.argmin(np.abs(grid_t - t)))
            dist = abs(grid_t[j] - t)
            if dist <= 0.35 * sub:
                key = ("g", j)
                tt, pos = float(grid_t[j]), int(grid_pos[j])
            else:
                key = ("r", int(round(t * 100)))
                tt, pos = t, 4
            # 세기: 전체 온셋과 각 대역 온셋(대역 안에서 정규화) 중 가장 큰 값
            per_band = [BAND_WEIGHTS[b] * float(bmax[b, f]) for b in range(len(BAND_SPLITS))]
            # 귀에 잘 들리는 킥·스네어·멜로디(저음+중음)를 기본으로, 전체 변화와 고음은 보조로
            tonal = min(1.0, float(tonal_on[f]) / 0.22)
            hi_eff = float(bmax[2, f]) * (0.6 + 0.4 * tonal)        # 하이햇은 낮게, 음높이 있는 고음은 그대로
            v_, d_ = min(1.3, float(vmax[f])), min(1.3, float(dmax[f]))   # 몇몇 아주 큰 소리가 기준을 끌어올리지 않게
            i_ = min(1.3, float(imax[f]))
            lead_i = i_ > v_
            v_ = max(v_, i_)                 # 보컬이 쉬면 악기 멜로디가 노트의 주인공
            # 보컬(새 음절) > 드럼(킥·스네어) > 나머지 순으로 중요하게
            sv = 0.5 * v_ + 0.32 * d_ + 0.1 * float(o[f]) + 0.08 * max(per_band[0], per_band[1], hi_eff)
            c = {"t": tt, "pos": pos, "s": sv, "voc": v_, "drum": d_}
            if lead_i:
                c["ins"] = True
            if d_ > v_:
                c["band"] = int(np.argmax(per_band))   # 드럼 쪽은 저음=왼쪽/고음=오른쪽 경향
            if key not in out or out[key]["s"] < sv:
                out[key] = c
        return out

    def merged(delta, floor):
        allc = build_cands(pick_onsets(o, delta, floor))
        for env in (voc, drum, imax):       # 보컬 음절·드럼 타격·악기 멜로디 시점도 후보로
            for k, c in build_cands(pick_onsets(env, delta, floor)).items():
                if k not in allc or allc[k]["s"] < c["s"]:
                    allc[k] = c
        for b in range(len(BAND_SPLITS)):
            for k, c in build_cands(pick_onsets(bands[b], delta, floor), b).items():
                if k not in allc or allc[k]["s"] < c["s"]:
                    allc[k] = c
        # 그리드 밖(pos 4) 후보가 그리드 후보와 너무 가까우면 버림 (같은 소리를 두 번 잡지 않게)
        gts = np.array(sorted(c["t"] for c in allc.values() if c["pos"] != 4))
        res = []
        for c in allc.values():
            if c["pos"] == 4 and len(gts):
                j = np.searchsorted(gts, c["t"])
                near = min(abs(gts[jj] - c["t"]) for jj in (j - 1, j) if 0 <= jj < len(gts))
                if near < 0.06:
                    continue
            res.append(c)
        return sorted(res, key=lambda c: c["t"])

    cands = merged(0.06, 0.05)
    if len(cands) < 8:
        raise ValueError("리듬을 찾지 못했어요. 다른 곡으로 시도해 주세요.")
    # 극한용: 작은 소리(하이햇·장식음)까지 포함한 촘촘한 후보
    dense = merged(0.022, 0.025)
    if len(dense) < len(cands):
        dense = [dict(c) for c in cands]   # 같은 후보를 두 번 가공하지 않게 복사
    # 격자(16분) 위에 작은 소리라도 있으면 후보로 추가 — 고스트 노트
    om = maximum_filter1d(o, size=5)
    have = {round(c["t"], 3) for c in dense}
    for gt_, gp in zip(grid_t, grid_pos):
        if gt_ < 0.15 or gt_ > duration - 0.3 or round(float(gt_), 3) in have:
            continue
        gf = int(np.clip(round((gt_ - ONSET_BIAS) * FPS), 0, len(o) - 1))
        v = float(om[gf])
        if v >= 0.06 and max(float(bmax[0, gf]), float(bmax[1, gf])) >= 0.08 and loud_raw[gf] >= loud_gate:
            dense.append({"t": float(gt_), "pos": int(gp), "s": 0.8 * v, "voc": max(float(vmax[gf]), float(imax[gf])), "drum": float(dmax[gf])})
    dense.sort(key=lambda c: c["t"])

    # 드럼 강타(심벌과 함께 '탁' 치는 박, 필인 끝): 주변보다 확 튀는 타격 → 동시치기 + 강타 표시
    pk_frames = pick_onsets(_norm_env(dpower), 0.1, 0.1)
    pk_vals = np.array([float(dpower[f]) for f in pk_frames]) if len(pk_frames) else np.array([])
    accents = []
    if len(pk_vals) >= 8:
        g90 = float(np.percentile(pk_vals, 90))
        pk_t = pk_frames / FPS + ONSET_BIAS
        for i, f in enumerate(pk_frames):
            lo_i, hi_i = np.searchsorted(pk_t, pk_t[i] - 4.0), np.searchsorted(pk_t, pk_t[i] + 4.0)
            local = float(np.median(pk_vals[lo_i:hi_i]))
            if pk_vals[i] >= max(1.8 * local, g90) and (not accents or pk_t[i] - accents[-1] >= max(1.5, 2 * beat_len)):
                accents.append(float(pk_t[i]))
    drum_on = pick_onsets(drum, 0.06, 0.05) / FPS + ONSET_BIAS

    # 하이라이트(후렴) 찾기 — 후렴은 조금 더 꽉 차게, 후렴이 시작되는 순간은 강타로
    try:
        highlight, chorus = find_highlight(mag, beat_times, o, loud_raw, vpres, vpitch, an["venergy"], accents, duration)
    except Exception:          # 하이라이트는 부가 기능 — 실패해도 채보는 그대로
        highlight, chorus = None, []
    ch_starts = [a for a, _ in chorus]

    def in_chorus(t):
        return any(a - 0.05 <= t < b for a, b in chorus)

    def mark(group):
        # 후렴 시작 박: 가장 가까운 후보 하나를 강타로 (이미 근처에 강타가 있으면 그대로)
        for cs in ch_starts:
            if any(abs(a - cs) < 0.3 for a in accents):
                continue
            near = [c for c in group if abs(c["t"] - cs) <= 0.07 and c["pos"] in (0, 4)]
            if near:
                best = max(near, key=lambda c: c["s"])
                if best["s"] >= 0.15:
                    best["acc"] = True
        for c in group:
            if accents:
                j = int(np.argmin([abs(a - c["t"]) for a in accents]))
                if abs(accents[j] - c["t"]) <= 0.05:
                    c["acc"] = True                 # 강타는 고를 때 항상 남김 (세기는 그대로 둬서 다른 노트 기준을 흔들지 않음)
            # 필인: 바로 앞 한 박 안에 드럼 타격이 4번 이상 몰려 있으면 → 계단처럼 흐르는 노트
            if c.get("drum", 0) >= c.get("voc", 0):
                n_prev = np.count_nonzero((drum_on > c["t"] - beat_len - 0.02) & (drum_on <= c["t"] + 0.02))
                if n_prev >= 4:
                    c["fill"] = True
    mark(cands)
    mark(dense)
    all_s = np.array([c["s"] for c in cands])

    s_hi_cache = {}

    def s_hi(frac):
        if frac not in s_hi_cache:
            s_hi_cache[frac] = float(np.quantile(all_s, 1 - frac))
        return s_hi_cache[frac]

    # 음높이 특징(스펙트럼 중심, 로그) — 레인 윤곽용
    freqs = np.fft.rfftfreq(NFFT, 1.0 / SR)
    msum = mag.sum(axis=1) + 1e-9
    centroid = np.log2((mag @ freqs) / msum + 50.0)
    centroid = uniform_filter1d(centroid, size=5)
    cmin, cmax = np.percentile(centroid, 5), np.percentile(centroid, 95)
    cnorm = np.clip((centroid - cmin) / (cmax - cmin + 1e-9), 0, 1)

    # 지속음 판정용 '화성' 스펙트럼: 시간축 중앙값 필터로 드럼 같은 순간음을 제거
    band = (freqs >= 150) & (freqs <= 5000)
    harm = median_filter(mag[:, band], size=(17, 1))
    henergy = harm.mean(axis=1) + 1e-9
    hnorm = harm / (np.linalg.norm(harm, axis=1, keepdims=True) + 1e-9)
    loud = float(np.percentile(henergy, 40))

    nfr = len(o)

    def fr(t):
        return int(np.clip(round(t * FPS), 0, nfr - 1))

    def feat(t, c=None):
        # 보컬 노트는 실제 목소리 음높이를 따라 레인 이동, 나머지는 소리 밝기로
        if c is not None and c.get("ins") and c.get("voc", 0) >= c.get("drum", 0):
            return float(ipitch[fr(t)])
        if c is not None and c.get("voc", 0) >= c.get("drum", 0) and vpres[fr(t)] > 0.3:
            return float(vpitch[fr(t)])
        return float(cnorm[fr(t)])

    def sus_len(t0, max_len):
        """t0에서 시작한 음(같은 화음)이 얼마나 이어지는지(초)."""
        a = fr(t0 + 0.08)
        if henergy[a] < loud:
            return 0.0
        b0 = fr(t0 - 0.05)
        # 이미 울리던 소리(깔린 화음 등)가 이어지는 것뿐이면 새 긴 음이 아님
        if float(hnorm[b0] @ hnorm[a]) > 0.9 and henergy[a] < 1.35 * henergy[b0]:
            return 0.0
        ref_e, ref_v = henergy[a], hnorm[a]
        end = min(nfr - 1, fr(t0 + max_len))
        f = a
        while f + 2 <= end:
            f += 2
            if henergy[f] < 0.5 * ref_e or float(hnorm[f] @ ref_v) < 0.82:
                break
        return (f - a) / FPS + 0.08

    # 길게 이어지는 음의 시작점은 음악적으로 중요하므로 우선순위를 올림
    # 곡 구간 에너지(0~1): 소리 크기를 3초 정도로 부드럽게 — 후렴은 높고 인트로·절은 낮음
    loud_db = loud_raw
    loud_db = uniform_filter1d(loud_db, size=int(FPS * 3))
    e_lo, e_hi = np.percentile(loud_db, 10), np.percentile(loud_db, 95)
    # 음량 차이가 거의 없는 곡(꽉 찬 마스터링)은 구간 차이를 억지로 키우지 않게 최소 6dB 폭
    rng_db = e_hi - e_lo
    energy = np.clip((loud_db - e_lo) / max(rng_db, 6.0) + 0.6 * (1 - min(rng_db, 6.0) / 6.0), 0, 1)

    for group in (cands, dense):
        for c in group:
            c["sus"] = sus_len(c["t"], 4 * beat_len)
            c["s"] *= 1.0 + 0.3 * min(1.0, c["sus"] / (2 * beat_len))
            f = fr(c["t"])
            e = float(energy[f])
            c["e"] = e
            if in_chorus(c["t"]):              # 후렴: 신나는 구간으로 대접해서 조금 더 촘촘하게
                e = max(e, 0.85)
                c["e"] = e
                c["ch"] = True
            c["s"] *= 0.85 + 0.3 * e           # 신나는 구간의 소리를 조금 더 우선
            c["gm"] = 1.1 - 0.2 * e - (0.08 if c.get("ch") else 0.0)   # 최소 간격 배율: 조용하면 넉넉하게, 신나면 촘촘하게
    all_s = np.array([c["s"] for c in cands])

    charts, charts6 = {}, {}
    for i, (name, cfg) in enumerate(DIFFS.items()):
        src = dense if cfg.get("dense") else cands
        rng = np.random.default_rng(seed + i * 7919)
        sel = _select(src, cfg)
        charts[name] = _make_chart(src, cfg, feat, sus_len, beat_len, rng, s_hi, nl=4, sel=sel)
        rng = np.random.default_rng(seed + i * 7919 + 1)
        charts6[name] = _make_chart(src, cfg, feat, sus_len, beat_len, rng, s_hi, nl=6, sel=sel)

    first_beat = float(beats_ext[0])
    offset = first_beat % beat_len
    return {
        "bpm": round(bpm, 2),
        "offset": round(offset, 3),
        "duration": round(duration, 2),
        "charts": charts,
        "charts6": charts6,
        "beats": [round(float(b), 3) for b in beat_times],
        "highlight": highlight,
        "chorus": chorus,
    }


# ---------------------------------------------------------------- 난이도 별점
# static/core.js 의 starRating() 과 똑같은 계산식이에요. 바꿀 땐 둘 다 바꾸세요.
def _r1(x):
    return math.floor(x * 10 + 0.5) / 10


def star_rating(notes, nl=4):
    """채보만 보고 매기는 객관적 난이도(★).
    - 밀도: 2초 창의 초당 노트 수 중 상위 25% 평균(75%) + 전체 평균(25%)
    - 기술: 같은 키 연타(0.3초 이내), 동시치기, 긴 노트 누른 채 치기 비율로 가산
    - 6키는 읽기 부담으로 8% 가산
    """
    if not notes:
        return 0.0
    ns = sorted(notes, key=lambda n: (float(n["t"]), int(n["l"])))
    T = np.array([float(n["t"]) for n in ns])
    W = np.array([1.0 + min(float(n.get("d", 0) or 0), 2.0) * 0.25 for n in ns])
    end = float(max(float(n["t"]) + float(n.get("d", 0) or 0) for n in ns))
    cum = np.concatenate([[0.0], np.cumsum(W)])
    starts = np.arange(T[0], max(T[0], end - 2.0) + 0.25, 0.5)
    lo = np.searchsorted(T, starts, side="left")
    hi = np.searchsorted(T, starts + 2.0, side="left")
    nps = (cum[hi] - cum[lo]) / 2.0
    nz = nps[nps > 0]
    if len(nz) == 0:
        return 0.0
    top = np.sort(nz)[::-1][:max(1, int(math.ceil(len(nz) * 0.25)))]
    dens = 0.75 * float(top.mean()) + 0.25 * float(nz.mean())

    n = len(ns)
    jack = chord = hold = 0
    last_in_lane = {}
    hold_end = {}
    prev_t = None
    for x in ns:
        t, l = float(x["t"]), int(x["l"])
        if l in last_in_lane and t - last_in_lane[l] < 0.3:
            jack += 1
        if prev_t is not None and abs(t - prev_t) < 0.005:
            chord += 1
        if any(e > t + 0.005 for k, e in hold_end.items() if k != l):
            hold += 1
        last_in_lane[l] = t
        d = float(x.get("d", 0) or 0)
        if d > 0:
            hold_end[l] = t + d
        prev_t = t
    tech = 1.0 + 0.6 * jack / n + 0.35 * chord / n + 0.4 * hold / n
    keys = 1.08 if nl == 6 else 1.0
    return _r1(1.05 * dens ** 0.8 * tech * keys)


def star_table(song):
    return {
        "4": {d: star_rating(v, 4) for d, v in (song.get("charts") or {}).items()},
        "6": {d: star_rating(v, 6) for d, v in (song.get("charts6") or {}).items()},
    }


# ---------------------------------------------------------------- 오디오 디코딩
def decode_audio(path, ffmpeg_exe="ffmpeg", stereo=True):
    """ffmpeg로 아무 형식이나 22050Hz float32 로 디코딩. stereo=True 면 (n, 2) — 보컬(가운데 소리) 찾기에 씀."""
    import subprocess
    ch = 2 if stereo else 1
    cmd = [ffmpeg_exe, "-v", "error", "-i", str(path), "-ac", str(ch), "-ar", str(SR),
           "-f", "f32le", "-"]
    flags = 0
    if hasattr(subprocess, "CREATE_NO_WINDOW"):
        flags = subprocess.CREATE_NO_WINDOW
    p = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, creationflags=flags)
    if p.returncode != 0:
        raise RuntimeError("오디오 변환 실패: " + p.stderr.decode("utf-8", "ignore")[:300])
    y = np.frombuffer(p.stdout, dtype=np.float32).copy()
    if ch == 2:
        y = y[: len(y) // 2 * 2].reshape(-1, 2)
    return y


if __name__ == "__main__":
    import sys, json
    y = decode_audio(sys.argv[1])
    res = generate(y)
    print(json.dumps({k: (v if k != "charts" else {d: len(n) for d, n in v.items()})
                      for k, v in res.items()}, ensure_ascii=False))
