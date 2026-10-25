/* 링크비트 싱크 맞추기 (박자 소리 방식)
   노트가 일정한 박자로 판정선에 내려오고, 닿는 순간 '딱' 소리가 나요.
   소리(와 노트)에 맞춰 누른 시각과 그 소리가 실제로 들린 시각의 차이를 모아
   평균만큼 싱크를 맞춰요. (+ = 늦게 누름 → 싱크 +, 게임 판정과 같은 방향) */
'use strict';

const CAL_COUNT_IN = 4;       // 처음 4박은 준비 (세지 않음)
const CAL_TAPS = 24;          // 이만큼 누르면 끝
const CAL_EXTRA = 12;         // 놓친 박을 생각해 조금 더 (이만큼 지나도 모자라면 있는 만큼 계산)
const CAL_MIN = 10;           // 이보다 적게 누르면 다시
const CAL_LEAD = 1.6;         // 시작을 누르고 첫 박까지 (초) — 노트가 위에서 내려올 시간
const CAL_BPMS = [[80, '느리게 (80)'], [100, '보통 (100)'], [130, '빠르게 (130)']];

/* 메트로놈 '딱' (원하는 시각에 미리 예약) — 첫 박(마디 시작)은 조금 높고 세게 */
sfx.clickAt = function (when, accent = false) {
  const ctx = this.ensure();
  if (!ctx) return [];
  const t = Math.max(when, ctx.currentTime), v = this.fxVol(accent ? 0.75 : 0.55);
  const n = this.noise(ctx, 0.05); const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = accent ? 3400 : 2700; bp.Q.value = 2.2;
  const g = ctx.createGain(); g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
  n.connect(bp).connect(g).connect(ctx.destination); n.start(t); n.stop(t + 0.05);
  const o = ctx.createOscillator(); o.type = 'triangle';
  o.frequency.setValueAtTime(accent ? 2100 : 1600, t); o.frequency.exponentialRampToValueAtTime(accent ? 1200 : 900, t + 0.04);
  const g2 = ctx.createGain(); g2.gain.setValueAtTime(v * 0.8, t); g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
  o.connect(g2).connect(ctx.destination); o.start(t); o.stop(t + 0.07);
  return [{ node: n, t }, { node: o, t }];
};

class Calibrator {
  constructor() {
    this.cv = $('#calibCanvas');
    this.state = 'idle';          // idle | run | done
    this.result = null;
    this.errs = [];               // 누른 오차 (ms, + = 늦음)
    this.popup = null;
    this.flash = new Array(4).fill(-1e9);
    this.nodes = [];
    this.raf = 0;
    this.onDown = (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();
      this.tap(e.timeStamp);
    };
    this.cv.addEventListener('pointerdown', this.onDown);
    this.loop();
  }

  get bpm() { return +store.get('calBpm', 100) || 100; }
  get hideNotes() { return !!store.get('calHide', false); }

  start() {
    const ctx = sfx.ensure();
    if (!ctx) { toast('이 브라우저는 소리를 낼 수 없어요.'); return; }
    this.stopSound();
    this.ac = ctx;
    this.bl = 60 / this.bpm;
    this.total = CAL_COUNT_IN + CAL_TAPS + CAL_EXTRA;
    this.t0 = ctx.currentTime + CAL_LEAD;     // 첫 박 (오디오 시계)
    this.sched = 0;                            // 다음에 예약할 박
    this.beats = [];                           // 박마다 { k, ctxT, hit, err }
    for (let k = 0; k < this.total; k++) this.beats.push({ k, ctxT: this.t0 + k * this.bl, hit: false, err: null });
    this.errs = [];
    this.result = null;
    this.popup = null;
    this.map = null;
    this.state = 'run';
    this.updMap();
    this.render();
  }

  /* 오디오 시계 → 실제로 소리가 들리는 화면 시계(performance.now) 사이의 차이.
     getOutputTimestamp는 출력 장치 지연까지 들어간 값이라 블루투스 이어폰처럼 늦게 들리는 것도 반영돼요. */
  updMap() {
    const ctx = this.ac;
    if (!ctx) return;
    const now = performance.now();
    const fb = now - ctx.currentTime * 1000 + ((ctx.outputLatency || ctx.baseLatency || 0) * 1000);
    let m = fb;
    try {
      const ts = ctx.getOutputTimestamp && ctx.getOutputTimestamp();
      if (ts && ts.performanceTime > 0 && ts.contextTime > 0) {
        const v = ts.performanceTime - ts.contextTime * 1000;
        if (Math.abs(v - fb) < 500) m = v;       // 말이 안 되는 값이면 대신 계산한 값
      }
    } catch { /* 무시 */ }
    this.map = this.map == null ? m : this.map * 0.92 + m * 0.08;   // 조금씩 흔들리는 걸 고르게
  }
  heard(b) { return b.ctxT * 1000 + this.map; }     // 그 박의 소리가 들리는 시각 (performance.now 기준)

  schedule() {
    const ctx = this.ac;
    while (this.sched < this.total && this.beats[this.sched].ctxT < ctx.currentTime + 0.25) {
      const b = this.beats[this.sched];
      this.nodes.push(...sfx.clickAt(b.ctxT, b.k % 4 === 0));
      if (this.nodes.length > 40) this.nodes.splice(0, this.nodes.length - 40);
      this.sched++;
    }
  }

  tap(ts) {
    if (this.state !== 'run' || this.map == null) return;
    // 가장 가까운 박 (반 박 안쪽만)
    const bl = this.bl * 1000;
    let best = null, bd = Infinity;
    for (const b of this.beats) {
      const d = ts - this.heard(b);
      if (Math.abs(d) < Math.abs(bd)) { bd = d; best = b; }
    }
    if (!best || Math.abs(bd) > bl / 2) return;
    const lane = best.k % 4;
    this.flash[lane] = performance.now();
    if (best.k < CAL_COUNT_IN) { this.popup = { ms: Math.round(bd), at: performance.now(), prep: true }; return; }
    if (best.hit) return;               // 같은 박을 두 번 누르면 처음 것만
    best.hit = true;
    best.err = bd;
    this.errs.push(bd);
    this.popup = { ms: Math.round(bd), at: performance.now() };
    if (this.errs.length >= CAL_TAPS) this.finish();
    this.render();
  }

  /* 평균: 가운데 값에서 너무 먼 것(헛누름)은 빼고 */
  compute(errs = this.errs) {
    if (errs.length < CAL_MIN) return null;
    const s = errs.slice().sort((a, b) => a - b);
    const med = s[Math.floor(s.length / 2)];
    const mad = s.map((x) => Math.abs(x - med)).sort((a, b) => a - b)[Math.floor(s.length / 2)];
    const lim = Math.max(45, mad * 3);
    const use = errs.filter((x) => Math.abs(x - med) <= lim);
    const mean = use.reduce((a, b) => a + b, 0) / use.length;
    const sd = Math.sqrt(use.reduce((a, b) => a + (b - mean) ** 2, 0) / use.length);
    return { mean, sd, n: use.length, drop: errs.length - use.length, ms: clamp(Math.round(mean / 5) * 5, -300, 300) };
  }

  finish() {
    if (this.state !== 'run') return;
    this.state = 'done';
    this.result = this.compute();
    this.stopSound(true);
    this.render();
  }

  /* 예약해 둔 소리 멈추기 (keepCurrent: 이미 울리기 시작한 소리는 끝까지) */
  stopSound(keepCurrent = false) {
    const now = this.ac ? this.ac.currentTime : 0;
    for (const x of this.nodes) {
      try { if (!keepCurrent || x.t > now + 0.005) x.node.stop(); } catch { /* 이미 끝남 */ }
    }
    if (this.beats) this.sched = this.total;    // 남은 박은 더 예약하지 않음
    this.nodes = [];
  }

  apply() {
    if (!this.result) return;
    settings.offset = this.result.ms;
    saveSettings();
    toast(`싱크를 ${settings.offset > 0 ? '+' : ''}${settings.offset}ms 로 맞췄어요.`);
  }

  render() {
    const st = this.state;
    $('#calStart').textContent = st === 'idle' ? '시작' : st === 'run' ? '처음부터 다시' : '한 번 더';
    const r = this.result;
    const box = $('#calResult');
    if (st === 'done') {
      if (!r) box.innerHTML = `<span class="warn">누른 횟수가 너무 적어요 (${this.errs.length}번). 다시 해 주세요.</span>`;
      else {
        const m = Math.round(r.mean), sd = Math.round(r.sd);
        const how = Math.abs(m) < 8 ? '거의 딱 맞게 누르고 있어요.' : `평균 <b>${Math.abs(m)}ms ${m > 0 ? '늦게' : '빨리'}</b> 눌렀어요.`;
        const steady = sd <= 25 ? '아주 고르게 눌렀어요 👍' : sd <= 45 ? '꽤 고르게 눌렀어요.' : '<span class="warn">누른 타이밍이 들쭉날쭉했어요. 한 번 더 해보는 걸 추천해요.</span>';
        box.innerHTML = `<div class="cal-ms">${r.ms > 0 ? '+' : ''}${r.ms}ms</div>
          <div class="small">${how} 싱크를 <b>${r.ms > 0 ? '+' : ''}${r.ms}ms</b>로 맞추면 좋아요.</div>
          <div class="muted small">흔들림 ±${sd}ms · ${r.n}번 사용${r.drop ? ` · 헛누름 ${r.drop}번 뺌` : ''}</div>
          <div class="small">${steady}</div>`;
      }
    } else box.innerHTML = '';
    $('#calApply').classList.toggle('hidden', !(st === 'done' && r));
    $('#calVolWarn').classList.toggle('hidden', (settings.volume ?? 80) > 5);
  }

  loop() {
    const step = () => {
      if (this.closed) return;
      if (this.state === 'run') {
        this.updMap();
        this.schedule();
        const last = this.beats[this.total - 1];
        if (performance.now() > this.heard(last) + this.bl * 500) this.finish();   // 박이 다 지나감
      }
      this.draw();
      this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  }

  draw() {
    const L = fitCanvas(this.cv, 4, { scale: settings.skin.laneScale });
    const { ctx, w, h, laneW, fieldW, x0, colors } = L;
    const judgeY = judgeLineY(h);
    const pps = (150 + settings.speed * 90) * (h < 600 ? h / 600 : 1);
    const now = performance.now();
    const pressed = this.flash.map((f) => now - f < 90);
    drawLanes(L, judgeY, pressed, 0.9);
    const run = this.state === 'run' && this.map != null;
    if (run && !this.hideNotes) {
      for (const b of this.beats) {
        if (b.k < CAL_COUNT_IN || b.hit) continue;
        const dt = (this.heard(b) - now) / 1000;
        if (dt > judgeY / pps + 0.1) break;
        if (dt < -0.25) continue;
        drawNote(L, b.k % 4, judgeY - dt * pps, null, dt < -0.12 ? 'dead' : 'live', false);
      }
    }
    drawJudgeLine(L, judgeY, pressed, null, now);
    // 판정선이 박마다 반짝 (소리가 들리는 순간)
    if (run) {
      let near = Infinity;
      for (const b of this.beats) { const d = now - this.heard(b); if (d >= 0 && d < near) near = d; }
      if (near < 120) {
        ctx.fillStyle = `rgba(255,255,255,${(0.35 * (1 - near / 120)).toFixed(3)})`;
        ctx.fillRect(x0, judgeY - 4, fieldW, 8);
      }
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const cx = x0 + fieldW / 2;
    // 가운데 안내 글자
    let big = '', small = '';
    if (this.state === 'idle') { big = '♪'; small = '시작을 누르면 박자 소리가 나와요'; }
    else if (this.state === 'run') {
      const n = this.beats.filter((b) => this.heard(b) <= now).length;     // 지금까지 울린 박 수
      if (n === 0) { big = '준비'; small = '하나, 둘, 셋, 넷 — 소리를 들으며 박자를 느껴 보세요'; }
      else if (n <= CAL_COUNT_IN) { big = String(n); small = n === CAL_COUNT_IN ? '다음 박부터 눌러요!' : '하나, 둘, 셋, 넷 — 소리를 들으며 박자를 느껴 보세요'; }
      else { big = `${this.errs.length} / ${CAL_TAPS}`; small = isTouch ? "'딱' 소리에 맞춰 화면을 탭" : "'딱' 소리에 맞춰 아무 키나 Space"; }
    } else { big = this.result ? `${this.result.ms > 0 ? '+' : ''}${this.result.ms}ms` : '다시 해 주세요'; small = '오른쪽에서 결과를 확인하세요'; }
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    numFont(ctx, 900, big.length > 4 ? Math.min(34, laneW * 0.55) : 56, true);
    ctx.fillText(big, cx, h * 0.3);
    plainFont(ctx);
    ctx.font = `600 ${laneW < 60 ? 12 : 14}px "Noto Sans KR", sans-serif`;
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fillText(small, cx, h * 0.3 + 42);
    // 방금 누른 오차
    const p = this.popup;
    if (p && now - p.at < 600) {
      const a = 1 - (now - p.at) / 600, ms = p.ms;
      ctx.globalAlpha = a;
      numFont(ctx, 900, laneW < 60 ? 22 : 28, true);
      ctx.fillStyle = Math.abs(ms) <= 10 ? '#ffffff' : ms < 0 ? '#4de1ff' : '#ffa94d';
      ctx.fillText(`${ms > 0 ? '+' : ''}${ms}ms`, cx, judgeY - 70);
      plainFont(ctx);
      ctx.font = '700 12px "Noto Sans KR", sans-serif';
      ctx.fillText(p.prep ? '준비 중 (세지 않아요)' : Math.abs(ms) <= 10 ? '정확' : ms < 0 ? '빠름' : '느림', cx, judgeY - 46);
      ctx.globalAlpha = 1;
    }
    // 오차 막대: −150 ~ +150ms 에 누른 점, 평균 표시
    if (this.errs.length) {
      const bw = Math.min(fieldW - 20, 320), bx = cx - bw / 2, by = 22, R = 150;
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(bx - 8, by - 12, bw + 16, 40);
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.fillRect(bx, by, bw, 2);
      ctx.fillRect(cx - 1, by - 7, 2, 16);
      ctx.font = '600 10px "Noto Sans KR", sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.fillText('빠름', bx + 12, by + 18);
      ctx.fillText('느림', bx + bw - 12, by + 18);
      const xs = (ms) => cx + clamp(ms / R, -1, 1) * bw / 2;
      this.errs.forEach((e, i) => {
        ctx.fillStyle = i === this.errs.length - 1 ? '#ffffff' : (e < 0 ? '#4de1ff' : '#ffa94d') + 'aa';
        ctx.beginPath(); ctx.arc(xs(e), by + 1, i === this.errs.length - 1 ? 4 : 3, 0, Math.PI * 2); ctx.fill();
      });
      const r2 = this.errs.length >= CAL_MIN ? this.compute() : { mean: this.errs.reduce((a, b) => a + b, 0) / this.errs.length };
      if (r2) {
        ctx.fillStyle = C_GOLD;
        ctx.fillRect(xs(r2.mean) - 1.5, by - 9, 3, 20);
        ctx.font = '700 11px "JetBrains Mono", monospace';
        ctx.fillText(`평균 ${r2.mean > 0 ? '+' : ''}${Math.round(r2.mean)}ms`, cx, by + 18);
      }
    }
  }

  close() {
    this.closed = true;
    this.state = 'idle';
    cancelAnimationFrame(this.raf);
    this.stopSound();
    this.cv.removeEventListener('pointerdown', this.onDown);
  }
}
