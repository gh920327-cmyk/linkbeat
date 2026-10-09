/* 링크비트 싱크 자동 맞추기
   실제 곡을 유튜브로 재생하고, 플레이어가 강한 박(쿵)에 맞춰 누른 시각과
   분석된 박자 격자의 차이를 원형 평균으로 계산해 오프셋을 정해요. */
'use strict';

const CALIB_TAPS = 32;
const CALIB_SKIP = 4;      // 처음 몇 번은 박자 잡는 중이라 제외
const CALIB_MAX_SEC = 45;

class Calibrator {
  constructor() {
    this.cv = $('#calibCanvas');
    this.clock = new SongClock();
    this.state = 'idle';     // idle | loading | run | done
    this.taps = [];
    this.flash = 0;
    this.result = null;
    this.raf = 0;
    this.unsub = yt.on((st, err) => this.onYT(st, err));
    this.onDown = (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();
      this.tap(e.timeStamp);
    };
    this.cv.addEventListener('pointerdown', this.onDown);
    this.loop();
  }

  async start(songId) {
    if (this.state === 'loading') return;
    this.stopPlayback();
    this.taps = [];
    this.result = null;
    this.state = 'loading';
    this.render();
    try {
      this.song = await api('/songs/' + songId);
      if (this.closed || this.state !== 'loading') return;
      await yt.preload(songId);
      if (this.closed || this.state !== 'loading') return;   // 불러오는 사이에 닫았으면 재생하지 않음
      const dur = this.song.duration || 120;
      this.startT = clamp(dur * 0.3, Math.min(5, dur / 4), Math.max(0, dur - CALIB_MAX_SEC - 2));
      yt.seek(this.startT);
      this.state = 'starting';
      yt.play();
    } catch (e) {
      if (this.closed) return;
      this.state = 'idle';
      toast(e.message, 4000);
    }
    if (!this.closed) this.render();
  }

  onYT(st) {
    if (st === YTS.PLAYING && (this.state === 'starting' || this.state === 'run')) {
      this.clock.set(yt.time());
      this.clock.start();
      this.lastVT = -1;
      if (this.state === 'starting') { this.state = 'run'; this.runSince = this.clock.now(); }
    } else if (st === YTS.BUFFERING) {
      this.clock.stop();
    } else if (st === YTS.ENDED && this.state === 'run') {
      this.finish();
    }
  }

  tap(ts) {
    if (this.state !== 'run') return;
    this.flash = performance.now();
    sfx.hit();
    this.taps.push(this.clock.now(ts));
    if (this.taps.length >= CALIB_TAPS) this.finish();
    this.render();
  }

  compute() {
    const bl = 60 / (this.song.bpm || 120);
    const off = this.song.offset || 0;
    const use = this.taps.slice(CALIB_SKIP);
    if (use.length < 8) return null;
    let C = 0, S = 0;
    for (const t of use) {
      const ph = (t - off) / bl;
      const a = 2 * Math.PI * (ph - Math.round(ph));
      C += Math.cos(a);
      S += Math.sin(a);
    }
    C /= use.length;
    S /= use.length;
    const R = Math.sqrt(C * C + S * S);       // 1에 가까울수록 일정하게 누름
    const phase = Math.atan2(S, C) / (2 * Math.PI);
    const ms = Math.round(phase * bl * 1000 / 5) * 5;
    return { ms: clamp(ms, -300, 300), R, n: use.length };
  }

  finish() {
    if (this.state !== 'run') return;
    this.state = 'done';
    this.stopPlayback();
    this.result = this.compute();
    this.render();
  }

  stopPlayback() {
    try { yt.pause(); } catch { /* 무시 */ }
    this.clock.stop();
  }

  apply() {
    if (!this.result) return;
    settings.offset = this.result.ms;
    saveSettings();
    toast(`싱크를 ${settings.offset > 0 ? '+' : ''}${settings.offset}ms 로 맞췄어요.`);
  }

  render() {
    const st = this.state;
    $('#calStart').textContent = st === 'idle' ? '시작' : '처음부터 다시';
    $('#calStart').disabled = st === 'loading' || st === 'starting';
    const r = this.result;
    const box = $('#calResult');
    if (st === 'done') {
      if (!r) box.innerHTML = '<span class="warn">누른 횟수가 너무 적어요. 다시 해 주세요.</span>';
      else {
        const good = r.R >= 0.75;
        box.innerHTML = `<div class="cal-ms">${r.ms > 0 ? '+' : ''}${r.ms}ms</div>
          <div class="muted small">일정함 ${Math.round(r.R * 100)}% · ${r.n}번 사용</div>
          ${good ? '' : '<div class="warn small">누른 박자가 고르지 않았어요. 한 번 더 해보는 걸 추천해요.</div>'}`;
      }
    } else box.innerHTML = '';
    $('#calApply').classList.toggle('hidden', !(st === 'done' && r));
  }

  loop() {
    const step = () => {
      if (this.closed) return;
      if (this.state === 'run') {
        const vt = yt.time();
        if (vt !== this.lastVT && yt.state() === YTS.PLAYING) { this.clock.sync(vt); this.lastVT = vt; }
        if (this.clock.now() - this.runSince > CALIB_MAX_SEC) this.finish();
      }
      this.draw();
      this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  }

  draw() {
    const dpr = window.devicePixelRatio || 1;
    const r = this.cv.parentElement.getBoundingClientRect();
    const w = Math.max(200, Math.floor(r.width)), h = Math.max(260, Math.floor(r.height));
    if (this.cv.width !== w * dpr || this.cv.height !== h * dpr) {
      this.cv.width = w * dpr; this.cv.height = h * dpr;
      this.cv.style.width = w + 'px'; this.cv.style.height = h + 'px';
    }
    const ctx = this.cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const cx = w / 2, cy = h * 0.45;
    const base = Math.min(w, h) * 0.18;
    const e = clamp((performance.now() - this.flash) / 220, 0, 1);
    ctx.beginPath();
    ctx.arc(cx, cy, base * (1 + 0.25 * (1 - e)), 0, Math.PI * 2);
    ctx.fillStyle = `rgba(77,225,255,${0.12 + 0.5 * (1 - e)})`;
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(77,225,255,0.8)';
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff';
    const st = this.state;
    let big = '', small = '';
    if (st === 'idle') { big = '♪'; small = '오른쪽에서 곡을 고르고 시작을 누르세요'; }
    else if (st === 'loading' || st === 'starting') { big = '…'; small = '곡을 불러오는 중'; }
    else if (st === 'run') {
      big = `${this.taps.length} / ${CALIB_TAPS}`;
      small = isTouch ? '강한 박(쿵)에 맞춰 화면을 탭하세요' : '강한 박(쿵)에 맞춰 아무 레인 키나 Space를 누르세요';
    } else { big = '완료'; small = '오른쪽에서 결과를 확인하세요'; }
    ctx.font = `900 ${big.length > 4 ? 34 : 54}px "Black Han Sans", "Noto Sans KR", sans-serif`;
    ctx.fillText(big, cx, cy);
    ctx.font = '500 16px "Noto Sans KR", sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.fillText(small, cx, cy + base + 44);
    if (st === 'run' && this.taps.length >= CALIB_SKIP + 8) {
      const r2 = this.compute();
      if (r2) {
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.font = '500 14px "JetBrains Mono", monospace';
        ctx.fillText(`현재 추정 ${r2.ms > 0 ? '+' : ''}${r2.ms}ms`, cx, cy + base + 72);
      }
    }
  }

  close() {
    this.closed = true;
    this.state = 'idle';
    cancelAnimationFrame(this.raf);
    this.stopPlayback();
    this.unsub();
    this.cv.removeEventListener('pointerdown', this.onDown);
  }
}
