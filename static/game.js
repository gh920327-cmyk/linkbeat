/* 링크비트 플레이 화면 */
'use strict';

const JUDGE = { perfect: 0.045, great: 0.09, good: 0.14, bad: 0.18 };
const WEIGHT = { perfect: 1, great: 0.7, good: 0.4, miss: 0 };
const JUDGE_COLORS = { perfect: '#ffe45e', great: '#5effa1', good: '#5ec8ff', miss: '#ff5a6e' };
const JUDGE_TEXT = { perfect: 'PERFECT', great: 'GREAT', good: 'GOOD', miss: 'MISS' };
const JUDGE_IDX = { perfect: 0, great: 1, good: 2, miss: 3 };
const JUDGE_KINDS = ['perfect', 'great', 'good', 'miss'];
const C_WHITE = '#eef3ff', C_BLUE = '#3f8cff', C_GOLD = '#ffc83d', C_CYAN = '#4de1ff', C_RED = '#ff3b55';
function laneColors(nl) {
  const t = themeColors();   // 꾸미기 테마 색
  return nl === 6 ? [t.a, t.b, t.c, t.c, t.b, t.a] : [t.a, t.b, t.b, t.a];
}
const UI_FONT = '"Orbitron", "Noto Sans KR", sans-serif';

/* 캔버스 크기를 부모에 맞추고 레인 배치를 계산 */
function fitCanvas(cv, nl = 4, opts = {}) {
  const dpr = window.devicePixelRatio || 1;
  const r = cv.parentElement.getBoundingClientRect();
  const w = Math.max(200, Math.floor(r.width));
  const h = Math.max(260, Math.floor(r.height));
  if (cv.width !== w * dpr || cv.height !== h * dpr) {
    cv.width = w * dpr;
    cv.height = h * dpr;
    cv.style.width = w + 'px';
    cv.style.height = h + 'px';
  }
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const scale = opts.scale || 1;                       // 꾸미기: 레인 폭
  const maxLane = (nl === 6 ? 82 : 100) * scale;
  const laneW = Math.max(26, Math.min(maxLane, Math.floor((w - (w < 500 ? 8 : 24)) / nl)));
  const fieldW = laneW * nl;
  let x0 = Math.floor((w - fieldW) / 2);               // 꾸미기: 기어 위치
  if (opts.pos === 'left') x0 = Math.min(x0, 24);
  else if (opts.pos === 'right') x0 = Math.max(x0, w - fieldW - 26);
  return { ctx, w, h, nl, laneW, fieldW, x0, colors: laneColors(nl) };
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/* 레인/노트를 그리는 공통 함수 (플레이·에디터·싱크 맞추기 함께 사용) */
function drawLanes(L, judgeY, pressed, dim) {
  const { ctx, w, h, laneW, fieldW, x0, nl, colors } = L;
  ctx.clearRect(0, 0, w, h);
  // 기어 바탕: 위로 갈수록 어두워지는 그라데이션
  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, `rgba(4,6,14,${dim})`);
  bg.addColorStop(0.75, `rgba(10,14,30,${dim})`);
  bg.addColorStop(1, `rgba(14,18,36,${Math.min(1, dim + 0.05)})`);
  ctx.fillStyle = bg;
  ctx.fillRect(x0, 0, fieldW, h);
  for (let l = 0; l < nl; l++) {
    const x = x0 + l * laneW;
    if (l % 2 === 1) { ctx.fillStyle = 'rgba(255,255,255,0.025)'; ctx.fillRect(x, 0, laneW, h); }
    if (pressed && pressed[l]) {
      const g = ctx.createLinearGradient(0, judgeY, 0, judgeY - h * 0.6);
      g.addColorStop(0, colors[l] + '70');
      g.addColorStop(0.4, colors[l] + '22');
      g.addColorStop(1, colors[l] + '00');
      ctx.fillStyle = g;
      ctx.fillRect(x + 1, 0, laneW - 1, judgeY);
    }
    ctx.fillStyle = 'rgba(160,190,255,0.08)';
    ctx.fillRect(x, 0, 1, h);
  }
  // 금속 레일
  for (const rx of [x0 - 9, x0 + fieldW + 1]) {
    const g = ctx.createLinearGradient(rx, 0, rx + 8, 0);
    g.addColorStop(0, '#2a3148'); g.addColorStop(0.45, '#9aa6c4'); g.addColorStop(0.55, '#d6dcef'); g.addColorStop(1, '#2a3148');
    ctx.fillStyle = g;
    ctx.fillRect(rx, 0, 8, h);
  }
  ctx.fillStyle = 'rgba(80,140,255,0.5)';
  ctx.fillRect(x0 - 1, 0, 1, h);
  ctx.fillRect(x0 + fieldW, 0, 1, h);
}

function drawNote(L, lane, yHead, yTail, state, accent = false) {
  if (accent && state !== 'dead') drawAccentGlow(L, lane, yHead);
  const { ctx, laneW, x0, colors } = L;
  const sk = settings.skin;
  const pad = 2;
  const x = x0 + lane * laneW + pad;
  const nw = laneW - pad * 2;
  const col = state === 'dead' ? '#4a5066' : colors[lane];
  const nh = sk.note === 'line' ? Math.max(4, Math.round(sk.noteH * 0.35)) : sk.noteH;
  if (yTail !== null && yTail < yHead) {
    // 긴 노트 몸통
    const g = ctx.createLinearGradient(x, 0, x + nw, 0);
    g.addColorStop(0, col + '55'); g.addColorStop(0.5, col + (state === 'hold' ? 'ee' : 'aa')); g.addColorStop(1, col + '55');
    ctx.fillStyle = g;
    ctx.globalAlpha = state === 'dead' ? 0.4 : 1;
    ctx.fillRect(x + nw * 0.12, yTail, nw * 0.76, yHead - yTail);
    ctx.fillStyle = col;
    ctx.fillRect(x, yTail - 3, nw, 6);
    ctx.globalAlpha = 1;
  }
  const g2 = ctx.createLinearGradient(0, yHead - nh / 2, 0, yHead + nh / 2);
  g2.addColorStop(0, state === 'dead' ? '#6a7088' : '#ffffff');
  g2.addColorStop(0.35, col);
  g2.addColorStop(1, state === 'dead' ? '#30354a' : shade(col));
  ctx.fillStyle = g2;
  if (sk.note === 'round') {
    // 둥근 캡슐
    roundRect(ctx, x + 1, yHead - nh / 2, nw - 2, nh, nh / 2);
    ctx.fill();
  } else if (sk.note === 'circle') {
    // 원형
    const r = Math.min(nw * 0.42, nh * 0.9 + 4);
    ctx.beginPath();
    ctx.arc(x + nw / 2, yHead, r, 0, Math.PI * 2);
    const rg = ctx.createRadialGradient(x + nw / 2 - r * 0.3, yHead - r * 0.3, r * 0.1, x + nw / 2, yHead, r);
    rg.addColorStop(0, state === 'dead' ? '#6a7088' : '#ffffff');
    rg.addColorStop(0.45, col);
    rg.addColorStop(1, state === 'dead' ? '#30354a' : shade(col));
    ctx.fillStyle = rg;
    ctx.fill();
    return;
  } else if (sk.note === 'line') {
    // 얇은 빛줄기
    ctx.fillStyle = col;
    ctx.shadowColor = col;
    ctx.shadowBlur = state === 'dead' ? 0 : 12;
    ctx.fillRect(x, yHead - nh / 2, nw, nh);
    ctx.shadowBlur = 0;
    return;
  } else {
    // 막대 (기본): 납작한 막대 + 위쪽 광택
    ctx.fillRect(x, yHead - nh / 2, nw, nh);
  }
  if (state !== 'dead' && nh >= 10) {
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fillRect(x + (sk.note === 'round' ? nh / 2 : 2), yHead - nh / 2 + 2, nw - (sk.note === 'round' ? nh : 4), 2);
  }
}
function shade(hex) {
  const n = parseInt(hex.slice(1), 16);
  const f = (v) => Math.max(0, Math.round(v * 0.45));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

function drawJudgeLine(L, judgeY, pressed) {
  const { ctx, laneW, fieldW, x0, nl, colors } = L;
  // 붉은 판정선 + 아래 기어 패널
  const pg = ctx.createLinearGradient(0, judgeY, 0, L.h);
  pg.addColorStop(0, '#1a2038'); pg.addColorStop(1, '#0b0e1c');
  ctx.fillStyle = pg;
  ctx.fillRect(x0 - 9, judgeY + 6, fieldW + 18, L.h - judgeY - 6);
  const lc = LINE_COLORS[settings.skin.line] || C_RED;
  ctx.fillStyle = lc;
  ctx.shadowColor = lc;
  ctx.shadowBlur = 18;
  ctx.fillRect(x0, judgeY - 3, fieldW, 6);
  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.fillRect(x0, judgeY - 1, fieldW, 1);
  // 키(터치 영역) 표시
  const keys = keysFor(nl);
  ctx.font = `700 ${laneW < 60 ? 12 : 15}px "JetBrains Mono", monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const bh = isTouch ? 64 : 40;
  for (let l = 0; l < nl; l++) {
    const x = x0 + l * laneW;
    const on = pressed && pressed[l];
    ctx.fillStyle = on ? colors[l] : 'rgba(255,255,255,0.07)';
    ctx.fillRect(x + 3, judgeY + 14, laneW - 6, bh);
    ctx.fillStyle = on ? 'rgba(255,255,255,0.6)' : colors[l] + '55';
    ctx.fillRect(x + 3, judgeY + 14, laneW - 6, 3);
    if (!isTouch) {
      ctx.fillStyle = on ? '#0b0b14' : 'rgba(255,255,255,0.6)';
      ctx.fillText(keyLabel(keys[l]), x + laneW / 2, judgeY + 12 + bh / 2);
    }
  }
}

/* ============================================================ 타격 이펙트 / 콤보 / 판정 글자 */
function fxNew(nl) {
  return {
    flash: new Array(nl).fill(0), rings: [], parts: [],
    // 타격감: 폭발·파편·키 빔·판정선 펄스·기어 반동·흔들림·미스 번쩍임·콤보 축하
    bursts: [], shards: [], beamOff: new Array(nl).fill(-1e9), miss: new Array(nl).fill(-1e9),
    holdTick: new Array(nl).fill(0), line: -1e9, bump: -1e9, bumpAmp: 0, shake: -1e9, shakeAmp: 0, mile: null,
  };
}
function fxHit(fx, lane, now = performance.now()) {
  fx.flash[lane] = now;
  const e = settings.skin.effect;
  if (e === 'ring') fx.rings.push({ lane, at: now });
  else if (e === 'spark') {
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.2;
      const sp = 160 + Math.random() * 260;
      fx.parts.push({ lane, at: now, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, s: 2 + Math.random() * 3, dx: (Math.random() - 0.5) * 0.6 });
    }
  }
  if (fx.rings.length > 40) fx.rings.splice(0, fx.rings.length - 40);
  if (fx.parts.length > 300) fx.parts.splice(0, fx.parts.length - 300);
}
function drawFx(L, judgeY, fx, now) {
  const { ctx, laneW, x0, colors } = L;
  const e = settings.skin.effect;
  if (e === 'off') return;
  if (e === 'flash' || e === 'ring' || e === 'spark') {
    for (let l = 0; l < L.nl; l++) {
      const k = (now - fx.flash[l]) / (e === 'flash' ? 180 : 120);
      if (k < 1) {
        ctx.globalAlpha = (1 - k) * (e === 'flash' ? 1 : 0.6);
        ctx.fillStyle = colors[l];
        const grow = (e === 'flash' ? 10 : 4) * k;
        roundRect(ctx, x0 + l * laneW + 2 - grow, judgeY - 14 - grow, laneW - 4 + grow * 2, 28 + grow * 2, 8);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
  }
  if (e === 'ring') {
    fx.rings = fx.rings.filter((r) => now - r.at < 320);
    for (const r of fx.rings) {
      const k = (now - r.at) / 320;
      ctx.globalAlpha = 1 - k;
      ctx.strokeStyle = colors[r.lane];
      ctx.lineWidth = 3 * (1 - k) + 1;
      ctx.beginPath();
      ctx.arc(x0 + (r.lane + 0.5) * laneW, judgeY, laneW * (0.25 + 0.55 * k), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  if (e === 'spark') {
    fx.parts = fx.parts.filter((p) => now - p.at < 520);
    for (const p of fx.parts) {
      const t = (now - p.at) / 1000;
      const k = t / 0.52;
      const x = x0 + (p.lane + 0.5 + p.dx) * laneW + p.vx * t;
      const y = judgeY + p.vy * t + 900 * t * t;
      ctx.globalAlpha = 1 - k;
      ctx.fillStyle = k < 0.3 ? '#ffffff' : colors[p.lane];
      ctx.fillRect(x - p.s / 2, y - p.s / 2, p.s, p.s);
    }
    ctx.globalAlpha = 1;
  }
}
/* ---------------- 타격감 */
const PUNCH_K = { low: 0.55, mid: 1, high: 1.6 };
function punchK() { return PUNCH_K[settings.skin.punch] ?? 1; }
const BURST_SIZE = { perfect: 1, great: 0.8, good: 0.6 };

/* 노트를 쳤을 때: 판정 색 폭발 + 파편 + 판정선 펄스 + 기어 반동 */
function fxBurst(fx, lane, kind, now = performance.now()) {
  if (settings.skin.effect === 'off') return;   // 타격 이펙트 '끄기'면 폭발·파편·반동도 끔
  const k = punchK();
  const size = BURST_SIZE[kind] || 0.6;
  fx.bursts.push({ lane, at: now, kind, size });
  const n = Math.round((kind === 'perfect' ? 9 : kind === 'great' ? 6 : 4) * k);
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.4;
    const sp = (240 + Math.random() * 360) * Math.sqrt(k);
    fx.shards.push({ lane, at: now, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, len: 5 + Math.random() * 9, kind, life: 260 + Math.random() * 180 });
  }
  fx.line = now;
  // 반동은 여러 노트가 겹쳐도 가장 센 것만
  const amp = 2.2 * k * size;
  if (now - fx.bump > 60 || amp > fx.bumpAmp) { fx.bump = now; fx.bumpAmp = amp; }
  if (fx.bursts.length > 40) fx.bursts.splice(0, fx.bursts.length - 40);
  if (fx.shards.length > 260) fx.shards.splice(0, fx.shards.length - 260);
}
/* 롱노트를 누르고 있는 동안 튀는 작은 불꽃 */
function fxHoldSpark(fx, lane, now) {
  if (settings.skin.effect === 'off' || now - fx.holdTick[lane] < 45) return;
  fx.holdTick[lane] = now;
  const n = Math.max(1, Math.round(2 * punchK()));
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.2;
    const sp = 180 + Math.random() * 220;
    fx.shards.push({ lane, at: now, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, len: 3 + Math.random() * 5, kind: 'hold', life: 220 });
  }
}
function fxShake(fx, amp, now = performance.now()) {
  if (!settings.skin.shake) return;
  const a = amp * punchK();
  if (now - fx.shake > 160 || a > fx.shakeAmp) { fx.shake = now; fx.shakeAmp = a; }
}
function fxMiss(fx, lane, now = performance.now()) { fx.miss[lane] = now; }
function fxMilestone(fx, combo, now = performance.now()) {
  fx.mile = { combo, at: now };
  fxShake(fx, 3, now);
}
/* 기어 반동 + 화면 흔들림 → 이번 프레임의 이동량 */
function fxOffset(fx, now) {
  let dx = 0, dy = 0;
  if (settings.skin.shake === false) return { dx, dy };   // 화면 흔들림을 끄면 기어 반동도 끔
  const tb = now - fx.bump;
  if (tb < 90) dy += fx.bumpAmp * (1 - tb / 90);
  const ts = now - fx.shake;
  if (ts < 170 && settings.skin.shake) {
    const a = fx.shakeAmp * (1 - ts / 170);
    dx += Math.sin(ts * 0.11) * a;
    dy += Math.cos(ts * 0.13) * a * 0.6;
  }
  return { dx, dy };
}
/* 키 빔: 누르는 동안 판정선에서 위로 솟는 빛 기둥, 떼면 짧게 사라짐 */
function drawBeams(L, judgeY, pressed, fx, now) {
  const { ctx, laneW, x0, nl, colors } = L;
  const k = punchK();
  for (let l = 0; l < nl; l++) {
    let a = 0;
    if (pressed && pressed[l]) a = 1;
    else if (now - fx.beamOff[l] < 140) a = 1 - (now - fx.beamOff[l]) / 140;
    if (a <= 0) continue;
    const cx = x0 + (l + 0.5) * laneW;
    const top = judgeY - L.h * (0.45 + 0.25 * Math.min(1, k));
    const g = ctx.createLinearGradient(0, judgeY, 0, top);
    g.addColorStop(0, colors[l] + 'cc'); g.addColorStop(0.25, colors[l] + '55'); g.addColorStop(1, colors[l] + '00');
    ctx.globalAlpha = a * Math.min(1, 0.55 + 0.3 * k);
    ctx.fillStyle = g;
    ctx.fillRect(cx - laneW * 0.42, top, laneW * 0.84, judgeY - top);
    const g2 = ctx.createLinearGradient(0, judgeY, 0, top + (judgeY - top) * 0.4);
    g2.addColorStop(0, 'rgba(255,255,255,0.9)'); g2.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g2;
    ctx.fillRect(cx - 1.5, top + (judgeY - top) * 0.4, 3, (judgeY - top) * 0.6);
    ctx.globalAlpha = 1;
  }
}
/* 폭발·파편·판정선 펄스·미스 번쩍임 */
function drawPunch(L, judgeY, fx, now) {
  const { ctx, laneW, x0, fieldW, colors } = L;
  const k = punchK();
  ctx.save();
  ctx.beginPath();
  ctx.rect(x0, 0, fieldW, judgeY + 46);   // 효과가 기어 밖으로 번지지 않게
  ctx.clip();
  // 판정선 펄스
  const tl = (now - fx.line) / 140;
  if (tl < 1) {
    const lc = LINE_COLORS[settings.skin.line] || C_RED;
    ctx.globalAlpha = (1 - tl) * Math.min(1, 0.5 + 0.35 * k);
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = lc;
    ctx.shadowBlur = 24;
    ctx.fillRect(x0, judgeY - 2 - 3 * (1 - tl), fieldW, 4 + 6 * (1 - tl));
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
  }
  // 드럼 강타: 기어 전체가 잠깐 번쩍
  const tf = (now - (fx.flashAll || -1e9)) / 160;
  if (tf < 1) {
    const g = ctx.createLinearGradient(0, judgeY, 0, 0);
    g.addColorStop(0, `rgba(255,220,140,${0.35 * (1 - tf)})`); g.addColorStop(1, 'rgba(255,220,140,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x0, 0, fieldW, judgeY);
  }
  // 미스: 레인 아래쪽 붉은 번쩍임
  for (let l = 0; l < L.nl; l++) {
    const tm = (now - fx.miss[l]) / 220;
    if (tm >= 1) continue;
    const g = ctx.createLinearGradient(0, judgeY, 0, judgeY - 140);
    g.addColorStop(0, `rgba(255,60,80,${0.55 * (1 - tm)})`); g.addColorStop(1, 'rgba(255,60,80,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x0 + l * laneW + 1, judgeY - 140, laneW - 2, 140);
  }
  // 폭발
  ctx.globalCompositeOperation = 'lighter';
  fx.bursts = fx.bursts.filter((b) => now - b.at < 300);
  for (const b of fx.bursts) {
    const e = (now - b.at) / 300;
    const cx = x0 + (b.lane + 0.5) * laneW;
    const col = JUDGE_COLORS[b.kind] || colors[b.lane];
    const r = laneW * (0.35 + 0.75 * Math.sqrt(e)) * b.size * Math.min(1.4, 0.75 + 0.3 * k);
    const rg = ctx.createRadialGradient(cx, judgeY, 0, cx, judgeY, r);
    rg.addColorStop(0, `rgba(255,255,255,${0.9 * (1 - e)})`);
    rg.addColorStop(0.35, col + Math.round(200 * (1 - e)).toString(16).padStart(2, '0'));
    rg.addColorStop(1, col + '00');
    ctx.fillStyle = rg;
    ctx.beginPath();
    ctx.arc(cx, judgeY, r, 0, Math.PI * 2);
    ctx.fill();
    // 가로 섬광
    ctx.globalAlpha = (1 - e) * 0.8;
    ctx.fillStyle = col;
    const fw = laneW * (0.6 + 1.2 * e) * b.size;
    ctx.fillRect(cx - fw, judgeY - 1.5, fw * 2, 3);
    ctx.globalAlpha = 1;
  }
  // 파편
  fx.shards = fx.shards.filter((p) => now - p.at < p.life);
  ctx.lineCap = 'round';
  for (const p of fx.shards) {
    const t = (now - p.at) / 1000;
    const e = (now - p.at) / p.life;
    const x = x0 + (p.lane + 0.5) * laneW + p.vx * t;
    const y = judgeY + p.vy * t + 700 * t * t;
    const vx = p.vx, vy = p.vy + 1400 * t;
    const sp = Math.hypot(vx, vy) || 1;
    ctx.globalAlpha = 1 - e;
    ctx.strokeStyle = e < 0.25 ? '#ffffff' : (p.kind === 'hold' ? colors[p.lane] : JUDGE_COLORS[p.kind] || colors[p.lane]);
    ctx.lineWidth = p.kind === 'hold' ? 1.5 : 2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - (vx / sp) * p.len, y - (vy / sp) * p.len);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.restore();
}
/* 드럼 강타 노트: 금빛 테두리로 미리 보여줌 */
function drawAccentGlow(L, lane, y) {
  const { ctx, laneW, x0 } = L;
  const x = x0 + lane * laneW + 1, w = laneW - 2;
  const nh = Math.max(settings.skin.noteH, 12) + 10;
  const pulse = 0.65 + 0.35 * Math.sin(performance.now() / 80);
  ctx.save();
  ctx.strokeStyle = C_GOLD;
  ctx.lineWidth = 2;
  ctx.shadowColor = '#ff9a3d';
  ctx.shadowBlur = 14 * pulse;
  ctx.globalAlpha = 0.9;
  ctx.strokeRect(x, y - nh / 2, w, nh);
  ctx.restore();
}
/* 드럼 강타를 쳤을 때: 큰 폭발 + 화면 번쩍 + 울림 */
function fxAccent(fx, lane, kind, now = performance.now()) {
  if (settings.skin.effect === 'off') return;
  fx.bursts.push({ lane, at: now, kind, size: 1.8 });
  const k = punchK();
  for (let i = 0; i < Math.round(14 * k); i++) {
    const a = -Math.PI / 2 + (Math.random() - 0.5) * 3.0;
    const sp = (320 + Math.random() * 420) * Math.sqrt(k);
    fx.shards.push({ lane, at: now, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, len: 8 + Math.random() * 12, kind: 'perfect', life: 320 + Math.random() * 200 });
  }
  fx.flashAll = now;
  fx.bump = now; fx.bumpAmp = Math.max(fx.bumpAmp, 4 * k);
  fxShake(fx, 3.5, now);
}

/* 50콤보마다 축하 연출 */
function drawMilestone(L, fx, now) {
  const m = fx.mile;
  if (!m || !settings.skin.combo) return;
  const e = (now - m.at) / 900;
  if (e >= 1) { fx.mile = null; return; }
  const { ctx, h, x0, fieldW } = L;
  const cx = x0 + fieldW / 2, cy = h * 0.3;
  // 기어를 가로지르는 빛 띠
  const sweepX = x0 - fieldW * 0.3 + fieldW * 1.6 * Math.min(1, e * 1.6);
  const g = ctx.createLinearGradient(sweepX - 80, 0, sweepX + 80, 0);
  g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, 'rgba(255,230,140,0.35)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.save();
  ctx.beginPath(); ctx.rect(x0, 0, fieldW, h); ctx.clip();
  ctx.fillStyle = g;
  ctx.fillRect(sweepX - 80, 0, 160, h);
  ctx.restore();
  // 고리
  ctx.globalAlpha = 1 - e;
  ctx.strokeStyle = C_GOLD;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(cx, cy, 40 + fieldW * 0.45 * e, 0, Math.PI * 2);
  ctx.stroke();
  // 글자
  const pop = Math.min(1, e / 0.12);
  ctx.save();
  ctx.translate(cx, cy - 72);
  ctx.transform(1, 0, -0.18, 1, 0, 0);
  ctx.scale(1.5 - 0.5 * pop, 1.5 - 0.5 * pop);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `900 18px ${UI_FONT}`;
  ctx.fillStyle = C_GOLD;
  ctx.shadowColor = '#ff7a3d';
  ctx.shadowBlur = 14;
  ctx.fillText(`${m.combo} COMBO!`, 0, 0);
  ctx.restore();
  ctx.globalAlpha = 1;
}
function comboColor(combo) {
  return combo >= 200 ? ['#ffffff', '#ffd36b', 'rgba(255,170,40,0.85)']
    : combo >= 100 ? ['#ffffff', '#ffe08a', 'rgba(255,200,61,0.8)']
      : combo >= 50 ? ['#ffffff', '#8ff0ff', 'rgba(77,225,255,0.8)']
        : ['#ffffff', '#9fc4ff', 'rgba(63,140,255,0.8)'];
}

function drawCombo(L, combo, popAt, now) {
  if (!settings.skin.combo || combo < 2) return;
  const { ctx, h, laneW, x0, fieldW } = L;
  const cx = x0 + fieldW / 2;
  const p = clamp((now - popAt) / 140, 0, 1);
  const sc = 1 + 0.16 * punchK() * (1 - p) * (1 - p);
  ctx.save();
  ctx.textAlign = 'center';
  ctx.translate(cx, h * 0.3);
  ctx.scale(sc, sc);
  ctx.textBaseline = 'middle';
  ctx.font = `900 ${Math.min(64, laneW * 0.8 + 20)}px ${UI_FONT}`;
  const cc = comboColor(combo);
  const cg = ctx.createLinearGradient(0, -30, 0, 30);
  cg.addColorStop(0, cc[0]); cg.addColorStop(1, cc[1]);
  ctx.fillStyle = cg;
  ctx.shadowColor = cc[2];
  ctx.shadowBlur = 18;
  ctx.fillText(combo, 0, 0);
  ctx.restore();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `800 12px ${UI_FONT}`;
  ctx.fillStyle = 'rgba(190,210,255,0.7)';
  ctx.fillText('C O M B O', cx, h * 0.3 - 44);
}
function drawJudgePopup(L, popup, now) {
  const mode = settings.skin.judgeText;
  if (!popup || mode === 'off') return;
  const age = (now - popup.at) / 1000;
  if (age >= 0.5) return;
  const { ctx, h, laneW, x0, fieldW } = L;
  const small = mode === 'small';
  const pk = punchK();
  const big = (popup.kind === 'perfect' ? 0.3 : popup.kind === 'miss' ? 0.08 : 0.2) * Math.min(pk, 1.2);
  const sc = age < 0.08 ? 1 + big * (1 - age / 0.08) ** 2 : 1;
  ctx.save();
  ctx.textAlign = 'center';
  ctx.globalAlpha = age > 0.35 ? 1 - (age - 0.35) / 0.15 : 1;
  ctx.translate(x0 + fieldW / 2, h * 0.45);
  ctx.transform(1, 0, -0.18, 1, 0, 0);  // 살짝 기울인 판정 글자
  ctx.scale(sc, sc);
  ctx.textBaseline = 'middle';
  ctx.font = `900 ${Math.round((laneW < 60 ? 24 : 30) * (small ? 0.65 : 1))}px ${UI_FONT}`;
  ctx.fillStyle = JUDGE_COLORS[popup.kind];
  ctx.shadowColor = JUDGE_COLORS[popup.kind];
  ctx.shadowBlur = small ? 8 : 16;
  ctx.fillText(JUDGE_TEXT[popup.kind], 0, 0);
  ctx.shadowBlur = 0;
  if (popup.sub && settings.skin.earlyLate) {
    ctx.font = `700 ${small ? 12 : 14}px "Noto Sans KR", sans-serif`;
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.fillText(popup.sub, 0, small ? 20 : 28);
  }
  ctx.restore();
}
function judgeLineY(h) {
  const want = isTouch ? 90 : settings.skin.judgeY;
  return h - clamp(want, 70, Math.max(80, h * 0.45));
}

/* ============================================================ 피버
   좋은 판정마다 게이지가 차고, 가득 차면 FEVER x2 → x3 → x4 → x5 (8초 지속, 다시 차면 연장+단계 상승).
   미스가 나면 게이지·배율 모두 초기화. 점수 = 정확도 90만 + 피버 보너스 10만 (전부 PERFECT면 100만). */
const FEVER_GAIN = { perfect: 3, great: 2, good: 1 };
const FEVER_SEC = 8;
function feverNew() { return { gauge: 0, mult: 1, next: 2, until: -1 }; }
function feverStep(f, t, kind) {
  if (f.mult > 1 && t > f.until) f.mult = 1;
  if (kind === 'miss') { f.gauge = 0; f.mult = 1; f.next = 2; f.until = -1; return 1; }
  const applied = f.mult;
  f.gauge += FEVER_GAIN[kind];
  if (f.gauge >= 100) {
    f.gauge = 0;
    f.mult = f.mult > 1 ? Math.min(5, f.mult + 1) : f.next;
    f.next = Math.min(5, f.mult + 1);
    f.until = t + FEVER_SEC;
  }
  return applied;
}
/* 모두 PERFECT로 쳤을 때의 피버 보너스 합 (점수 정규화용) */
function feverMaxSum(notes) {
  const ev = [];
  for (const n of notes) { ev.push(n.t); if (n.d > 0) ev.push(n.t + n.d); }
  ev.sort((a, b) => a - b);
  const f = feverNew();
  let sum = 0;
  for (const t of ev) sum += WEIGHT.perfect * feverStep(f, t, 'perfect');
  return sum || 1;
}

/* ---------------- 유튜브 시작 지연 (재생 요청 → 실제 재생까지 걸리는 시간, 초) */
let ytLag = clamp(+store.get('ytLag', 0.2) || 0.2, 0.05, 0.6);
function ytLagLearn(sec) {
  if (!(sec > 0.01 && sec < 1.5)) return;                 // 이상한 값은 무시 (버퍼링 등)
  ytLag = clamp(ytLag * 0.6 + Math.min(sec, 0.6) * 0.4, 0.05, 0.6);
  store.set('ytLag', +ytLag.toFixed(3));
}

/* ============================================================ Game */
class Game {
  constructor({ song, diff, keys = 4, multi = false, gameNo = 0, notes = null, onExit, mods = true, practice = null }) {
    this.song = song;
    this.diff = diff;
    this.nl = keys === 6 ? 6 : 4;
    this.multi = multi;
    this.gameNo = gameNo;
    this.onExit = onExit;
    const src = notes || chartOf(song, diff, this.nl);
    this.stars = starRating(src, this.nl);
    // 옵션: 미러(좌우 반전) / 랜덤(레인 섞기)
    let map = [...Array(this.nl).keys()];
    this.modNames = [];
    if (mods && settings.mirror) { map = map.reverse(); this.modNames.push('MIRROR'); }
    if (mods && settings.random) {
      for (let i = map.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [map[i], map[j]] = [map[j], map[i]]; }
      this.modNames.push('RANDOM');
    }
    this.laneMap = map;           // 관전 화면에 보낼 레인 배치
    // 연습 모드: 구간·속도·반복
    this.practice = practice;
    this.rate = practice ? practice.rate : 1;
    this.startT = practice ? practice.start : 0;
    // 하이라이트 모드: 영상은 한 마디 앞(start)부터, 노트는 후렴 시작(from)부터
    const from = practice ? (practice.from ?? practice.start) : 0;
    this.notes = src.map((n) => ({ t: +n.t, l: map[n.l | 0] ?? (n.l | 0), d: +n.d || 0, a: n.a ? 1 : 0, head: null, tail: null }))
      .filter((n) => n.l >= 0 && n.l < this.nl && (!practice || (n.t >= from - 0.001 && n.t <= practice.end)))
      .sort((a, b) => a.t - b.t || a.l - b.l);
    this.hl = !!(practice && practice.hl);
    // 후렴 구간들 (들어갈 때 연출) — 하이라이트 모드면 시작부터 후렴
    this.chorus = (Array.isArray(song.chorus) ? song.chorus : []).filter((c) => Array.isArray(c) && c.length === 2).map((c) => [+c[0], +c[1]]);
    if (this.hl && !this.chorus.some((c) => Math.abs(c[0] - from) < 0.5)) this.chorus.push([from, practice.end]);
    this.chorus.sort((a, b) => a[0] - b[0]);
    this.chIdx = 0;
    this.lanes = Array.from({ length: this.nl }, () => []);
    this.notes.forEach((n, i) => this.lanes[n.l].push(i));
    this.laneHead = new Array(this.nl).fill(0);
    this.activeHold = new Array(this.nl).fill(null);
    this.totalUnits = this.notes.length + this.notes.filter((n) => n.d > 0).length;
    this.lastEnd = this.notes.reduce((m, n) => Math.max(m, n.t + n.d), 0);
    if (this.hl) this.practice = { ...practice, end: Math.max(practice.end, this.lastEnd) };   // 긴 노트가 구간 끝을 넘으면 끝까지
    this.feverMax = feverMaxSum(this.notes);
    this.resetStats();
    this.pressed = new Array(this.nl).fill(false);
    this.fx = fxNew(this.nl);
    this.stage = typeof AvatarStage !== 'undefined' ? new AvatarStage($('#avatarStage')) : null;   // 내 캐릭터
    this.popup = null;
    this.comboPop = 0;
    this.clock = new SongClock();
    this.clock.rate = this.rate;
    this.phase = 'loading';
    this.lastVT = -1;
    this.drawFrom = 0;
    this.lastProgress = 0;
    this.waitSince = 0;
    this.cv = $('#field');
    this.raf = 0;
    this.unsub = yt.on((st, err) => this.onYT(st, err));
    this.peers = {};
    this.sentHits = [];           // 지난 전송 이후의 판정 [레인, 종류] (관전 화면용)
    this.lastHitT = -9; this.lastHitAt = 0;
    this.lastLive = 0;
    this.touchMap = new Map();
    this.bindTouch();
  }

  get gt() { return this.clock.now() - settings.offset / 1000 * this.rate; }
  gtAt(perf) { return this.clock.now(perf) - settings.offset / 1000 * this.rate; }
  score() {
    if (!this.totalUnits) return 0;
    return Math.round(900000 * this.sum / this.totalUnits + 100000 * Math.min(1, this.feverSum / this.feverMax));
  }
  resetStats() {
    this.counts = { perfect: 0, great: 0, good: 0, miss: 0 };
    this.combo = 0;
    this.maxCombo = 0;
    this.sum = 0;
    this.judged = 0;
    this.fever = feverNew();
    this.feverSum = 0;
    this.feverPop = 0;
    this.offsets = [];          // 판정 오차(초, 실제 시간 기준) — 결과 화면 그래프용
    this.curve = [0];           // 노트 5%마다의 점수 (고스트 대결용으로 기록에 함께 저장)
    this.maxFever = 1;
  }
  /* 고스트: 지금까지 친 노트 비율에서 고스트가 갖고 있던 점수 */
  ghostScore() {
    const g = this.ghost && this.ghost.g;
    if (!g || g.length < 2) return 0;
    const f = clamp(this.judged / (this.totalUnits || 1), 0, 1) * (g.length - 1);
    const i = Math.min(g.length - 2, Math.floor(f));
    return g[i] + (g[i + 1] - g[i]) * (f - i);
  }
  acc() { return this.judged ? (this.sum / this.judged) * 100 : 100; }

  /* ---------------- 터치 */
  bindTouch() {
    const cv = this.cv;
    const laneAt = (e) => {
      const L = this.L || fitCanvas(cv, this.nl);
      const x = e.clientX - cv.getBoundingClientRect().left;
      return clamp(Math.floor((x - L.x0) / L.laneW), 0, this.nl - 1);
    };
    this.th = {
      down: (e) => {
        if (e.pointerType === 'mouse') return;
        e.preventDefault();
        if (!$('#gameOverlay').classList.contains('hidden')) return;
        const lane = laneAt(e);
        this.touchMap.set(e.pointerId, lane);
        try { cv.setPointerCapture(e.pointerId); } catch { /* 무시 */ }
        this.keyDown(lane, e.timeStamp);
      },
      up: (e) => {
        if (!this.touchMap.has(e.pointerId)) return;
        const lane = this.touchMap.get(e.pointerId);
        this.touchMap.delete(e.pointerId);
        if (![...this.touchMap.values()].includes(lane)) this.keyUp(lane, e.timeStamp);
      },
      ctx: (e) => e.preventDefault(),
    };
    cv.addEventListener('pointerdown', this.th.down);
    cv.addEventListener('pointerup', this.th.up);
    cv.addEventListener('pointercancel', this.th.up);
    cv.addEventListener('contextmenu', this.th.ctx);
  }
  unbindTouch() {
    const cv = this.cv;
    cv.removeEventListener('pointerdown', this.th.down);
    cv.removeEventListener('pointerup', this.th.up);
    cv.removeEventListener('pointercancel', this.th.up);
    cv.removeEventListener('contextmenu', this.th.ctx);
  }

  async load() {
    this.phase = 'loading';
    this.loop();
    await yt.preload(this.song.id);
    if (this.phase === 'loading') this.phase = 'ready';
  }

  /* 폰(특히 아이폰)은 사용자가 화면을 눌러야 소리가 나므로, 한 번 탭을 받아 플레이어를 깨움 */
  waitTap(text) {
    return new Promise((resolve) => {
      this.tapText = text;
      this.tapResolve = resolve;
      this.showTap();
    });
  }
  showTap() {
    overlay('준비', this.tapText, [['탭해서 시작', () => {
      hideOverlay();
      try {
        yt.player.playVideo();
        // 폰: 탭으로 소리 권한만 얻고 바로 멈춤 (게임 시작이 이미 예약돼 있으면 begin()에서 이 타이머를 취소)
        this.tapTimer = setTimeout(() => { this.tapTimer = 0; if (this.phase === 'ready' || this.phase === 'loading') { yt.pause(); yt.seek(this.startT || 0); } }, 150);
      } catch { /* 무시 */ }
      const r = this.tapResolve;
      this.tapResolve = null;
      if (r) r();
    }, 'primary']]);
  }
  /* 멀티: 시작 전에 나가기 → 서버에 '참가 못 함'을 알려서 다른 사람이 기다리지 않게 */
  leaveBeforeStart() {
    if (this.multi) net.send({ type: 'loaded', error: true });
    this.destroy();
    toast('게임에서 나왔어요.');
    this.onExit && this.onExit();
  }

  begin(lead) {
    if (sfx.clapStop) sfx.clapStop();   // 지난 판 박수가 남아 있으면 멈춤
    if (this.tapTimer) { clearTimeout(this.tapTimer); this.tapTimer = 0; try { yt.pause(); yt.seek(this.startT || 0); } catch { /* 무시 */ } }
    this.slew = null;
    if (settings.skin.hitSound && settings.skin.hitSound !== 'off') sfx.ensure();   // 첫 타격음에서 끊기지 않게 미리 켬
    if (this.practice) { yt.rate(this.rate); yt.seek(this.startT); }
    this.clock.set(this.startT - lead * this.rate);
    this.clock.start();
    this.phase = 'countdown';
  }

  onYT(st, err) {
    if (st === 'error') {
      if (this.phase !== 'ended') this.abort(err.message);
      return;
    }
    if (st === YTS.PLAYING) {
      if (this.phase === 'preroll') {
        // 미리 재생을 요청해 둔 상태: 실제로 걸린 시간을 기억(다음 판 보정)하고, 시계는 멈추지 않고 부드럽게 맞춤
        ytLagLearn((performance.now() - this.playAt) / 1000);
        const err = yt.time() - this.clock.now();
        if (Math.abs(err) > 0.35) this.clock.set(yt.time());
        else this.slew = { err, done: 0, at: performance.now(), ms: Math.max(250, Math.abs(err) * 2000) };   // 차이는 잠깐 살짝 빠르게/느리게 흘려서 맞춤 (거꾸로 가지 않게)
        this.softUntil = performance.now() + 1500;
        this.lastVT = -1;
        this.phase = 'playing';
        return;
      }
      if (['waitVideo', 'playing', 'resuming'].includes(this.phase)) {
        if (this.phase === 'waitVideo') ytLagLearn((performance.now() - this.playAt) / 1000);
        this.slew = null;
        this.clock.set(yt.time());
        this.clock.start();
        this.lastVT = -1;
        this.phase = 'playing';
      }
    } else if (st === YTS.BUFFERING) {
      if (this.phase === 'playing') { this.clock.stop(); this.slew = null; }
    } else if (st === YTS.PAUSED) {
      if (this.phase === 'playing') {
        if (this.multi) yt.play();
        else this.pause();
      }
    } else if (st === YTS.ENDED) {
      if (this.phase === 'playing') {
        if (this.practice && this.practice.loop) this.restartPractice(); else this.finish();
      }
    }
  }

  /* ---------------- 입력 */
  keyDown(lane, ts) {
    if (this.pressed[lane]) return;
    this.pressed[lane] = true;
    sfx.hit();
    if (this.phase !== 'playing' && this.phase !== 'preroll') return;
    const gt = this.gtAt(ts);
    const q = this.lanes[lane];
    let i = this.laneHead[lane];
    while (i < q.length && this.notes[q[i]].head) i++;
    if (i >= q.length) return;
    const n = this.notes[q[i]];
    const dt = (gt - n.t) / this.rate;  // 실제로 느끼는 시간 차이
    if (dt < -JUDGE.bad) return; // 너무 이르면 무시
    const a = Math.abs(dt);
    const kind = a <= JUDGE.perfect ? 'perfect' : a <= JUDGE.great ? 'great' : a <= JUDGE.good ? 'good' : 'miss';
    n.head = kind;
    if (kind !== 'miss') this.offsets.push(dt);
    this.judge(kind, lane, dt, false, n.t);
    if (n.a && kind !== 'miss') fxAccent(this.fx, lane, kind);   // 드럼 강타: 크게 터짐
    if (n.d > 0) {
      if (kind === 'miss') { n.tail = 'miss'; this.judge('miss', lane, 0, true, n.t + n.d); }
      else this.activeHold[lane] = n;
    }
  }

  keyUp(lane, ts) {
    if (this.pressed[lane]) this.fx.beamOff[lane] = performance.now();
    this.pressed[lane] = false;
    const n = this.activeHold[lane];
    if (!n || !['playing', 'preroll', 'waitVideo'].includes(this.phase)) return;
    const gt = this.gtAt(ts);
    this.activeHold[lane] = null;
    if (gt < n.t + n.d - 0.15 * this.rate) { n.tail = 'miss'; this.judge('miss', lane, 0, true, n.t + n.d); }
    else { n.tail = 'perfect'; this.judge('perfect', lane, 0, true, n.t + n.d); }
  }

  judge(kind, lane, dt, tail = false, t = this.gt) {
    this.counts[kind]++;
    if (this.multi && (!tail || kind === 'miss') && this.sentHits.length < 16) this.sentHits.push([lane, JUDGE_IDX[kind]]);
    this.sum += WEIGHT[kind];
    this.judged++;
    const before = this.fever.mult;
    this.feverSum += WEIGHT[kind] * feverStep(this.fever, t, kind);
    if (this.fever.mult > before) this.feverPop = performance.now();
    this.maxFever = Math.max(this.maxFever, this.fever.mult);
    if (this.totalUnits) {
      const k = Math.min(20, Math.floor(this.judged * 20 / this.totalUnits));
      while (this.curve.length <= k) this.curve.push(this.score());
    }
    const now = performance.now();
    if (kind === 'miss') {
      if (this.combo >= 20) fxShake(this.fx, 1.5, now);   // 긴 콤보가 끊기면 살짝 흔들림
      this.combo = 0;
      if (this.stage) this.stage.onMiss();
      fxMiss(this.fx, lane, now);
    } else {
      this.combo++;
      if (this.stage && !tail) this.stage.onHit(this.combo);
      this.comboPop = now;
      if (!tail) {
        fxHit(this.fx, lane);
        fxBurst(this.fx, lane, kind, now);
        // 동시치기: 같은 순간 두 번째 타격이면 화면을 살짝 흔듦
        if (Math.abs(t - this.lastHitT) < 0.02 && now - this.lastHitAt < 60) fxShake(this.fx, 2.2, now);
        this.lastHitT = t; this.lastHitAt = now;
      }
      if (this.combo % 50 === 0) fxMilestone(this.fx, this.combo, now);
    }
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    // 마지막 노트까지 미스 없이 → 풀콤보(전부 PERFECT면 올퍼펙트) 박수
    if (!this.fcAt && this.judged >= this.totalUnits && this.totalUnits > 0 && this.counts.miss === 0 && !(this.practice && !this.hl)) {
      this.fcAt = now;
      this.fcKind = this.counts.great === 0 && this.counts.good === 0 ? 'ap' : 'fc';
      sfx.applause(this.fcKind === 'ap');
      fxShake(this.fx, 4, now);
    }
    if (!(tail && kind === 'perfect')) {
      let sub = '';
      if (!tail && (kind === 'great' || kind === 'good')) sub = dt < 0 ? '빠름' : '느림';
      this.popup = { kind, sub, at: performance.now() };
    }
  }

  /* ---------------- 진행 */
  update(noMiss = false) {   // noMiss: 영상 시작 전(preroll)에는 자동 미스 처리를 하지 않음
    const gt = this.gt;
    for (let l = 0; l < this.nl; l++) {
      const q = this.lanes[l];
      let i = this.laneHead[l];
      while (i < q.length) {
        const n = this.notes[q[i]];
        if (n.head) { i++; continue; }
        if (!noMiss && (gt - n.t) / this.rate > JUDGE.good) {
          n.head = 'miss';
          this.judge('miss', l, 0, false, n.t);
          if (n.d > 0) { n.tail = 'miss'; this.judge('miss', l, 0, true, n.t + n.d); }
          i++;
          continue;
        }
        break;
      }
      this.laneHead[l] = i;
      const h = this.activeHold[l];
      if (h && gt >= h.t + h.d) {
        h.tail = 'perfect';
        this.judge('perfect', l, 0, true, h.t + h.d);
        this.activeHold[l] = null;
      }
    }
    if (this.fever.mult > 1 && gt > this.fever.until + 0.2) this.fever.mult = 1;  // 화면 표시용 만료
    const fcHold = this.fcAt && performance.now() - this.fcAt < 1900;   // 풀콤보 글자를 볼 시간
    if (this.practice) {
      if (gt >= this.practice.end + 0.6 * this.rate && !fcHold) {
        if (this.practice.loop) this.restartPractice(); else this.finish();
      }
    } else if (this.judged >= this.totalUnits && gt > this.lastEnd + 1.5 && !fcHold) this.finish();
    if (this.multi && performance.now() - this.lastProgress > 140) this.sendProgress(gt);
  }

  /* 멀티: 점수 + 관전용 정보(곡 위치, 누른 레인, 판정, 레인 배치, 피버)를 자주 보냄 */
  sendProgress(gt = this.gt) {
    const now = performance.now();
    this.lastProgress = now;
    let bits = 0;
    for (let l = 0; l < this.nl; l++) if (this.pressed[l] || this.activeHold[l]) bits |= 1 << l;
    const fv = this.fever;
    net.send({
      type: 'progress', score: this.score(), combo: this.combo, acc: +this.acc().toFixed(2),
      t: +gt.toFixed(3), p: bits, h: this.sentHits, m: this.laneMap, f: fv.mult > 1 && gt <= fv.until,
    });
    this.sentHits = [];
    if (now - this.lastLive > 400) { this.lastLive = now; this.renderLive(); }
  }

  loop() {
    cancelAnimationFrame(this.raf);
    const step = () => {
      if (this.phase === 'ended' || this.phase === 'aborted') return;
      const t = this.clock.now();
      if (this.phase === 'countdown' && t >= this.startT - ytLag * this.rate) {
        // 유튜브는 재생을 누르고 실제로 소리가 나기까지 시간이 걸려요.
        // 그만큼 미리 재생을 요청하고, 그동안 화면은 멈추지 않고 계속 흘러가게 함 (시작 렉 방지)
        this.phase = 'preroll';
        this.playAt = performance.now();
        yt.play();
      }
      if (this.phase === 'preroll') {
        if (t > this.startT + 0.35 * this.rate) {
          // 영상이 너무 늦게 시작하면 기다림 (소리 없이 노트만 지나가지 않게)
          this.clock.stop();
          this.phase = 'waitVideo';
          this.waitSince = performance.now();
          this.retryAt = 0;
        } else if (t >= this.startT - 0.05) this.update(true);
      }
      if (this.phase === 'waitVideo') {
        // 재생 요청이 씹히면 다시 요청, 10초가 지나도 안 되면 포기
        const wait = performance.now() - this.waitSince;
        if (wait > 10000) { this.abort('영상이 시작되지 않아요. 인터넷 연결을 확인하고 다시 시도해 주세요.'); return; }
        if (wait - (this.retryAt || 0) > 1000 && yt.state() !== YTS.PLAYING && yt.state() !== YTS.BUFFERING) { this.retryAt = wait; yt.play(); }
      }
      if (this.phase === 'playing') {
        if (this.slew) {
          const want = this.slew.err * Math.min(1, (performance.now() - this.slew.at) / this.slew.ms);
          this.clock.set(this.clock.now() + want - this.slew.done);
          this.slew.done = want;
          if (performance.now() - this.slew.at >= this.slew.ms) this.slew = null;
        }
        const vt = yt.time();
        if (!this.slew && vt !== this.lastVT) {
          // 시작 직후 1.5초는 유튜브 시간이 들쭉날쭉해서 부드럽게만 맞춤
          if (performance.now() < (this.softUntil || 0)) this.clock.sync(vt, 0.35, 0.12);
          else this.clock.sync(vt);
          this.lastVT = vt;
        }
        this.update();
      }
      this.draw();
      this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  }

  /* 고스트 대결: 친구 1위(또는 내 최고) 기록과 같은 지점의 점수 비교 */
  drawGhost(ctx, sx, y, outside, alignLeft) {
    const me = this.score(), gs = Math.round(this.ghostScore()), d = me - gs;
    const bw = outside ? 120 : 84;
    const bx = alignLeft ? sx : sx - bw;
    ctx.save();
    ctx.textAlign = alignLeft ? 'left' : 'right';
    ctx.textBaseline = 'top';
    ctx.font = `800 ${outside ? 11 : 10}px ${UI_FONT}`;
    ctx.fillStyle = 'rgba(185,140,255,0.85)';
    ctx.fillText(`VS ${this.ghost.label}`, sx, y);
    ctx.font = `800 ${outside ? 16 : 13}px "JetBrains Mono", monospace`;
    ctx.fillStyle = this.judged === 0 ? 'rgba(255,255,255,0.5)' : d >= 0 ? '#4dffa6' : '#ff5a72';
    ctx.fillText(`${d >= 0 ? '+' : '−'}${Math.abs(d).toLocaleString()}`, sx, y + 15);
    // 막대 두 개: 나(파랑) · 고스트(보라) — 지금까지의 점수
    const top = y + (outside ? 36 : 32);
    const full = Math.max(1, me, gs);
    for (const [v, col, yy] of [[me, '#4de1ff', top], [gs, '#b98cff', top + 6]]) {
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fillRect(bx, yy, bw, 4);
      ctx.fillStyle = col;
      const w = bw * clamp(v / full, 0, 1);
      ctx.fillRect(alignLeft ? bx : bx + bw - w, yy, w, 4);
    }
    ctx.restore();
  }

  /* 후렴(하이라이트): 들어가는 순간 빛이 터지고 글자, 후렴 동안 기어 양옆이 박자에 맞춰 은은하게 빛남 */
  drawChorus(L, judgeY, gt, now) {
    if (!this.chorus.length || settings.skin.chorusFx === false) return;
    if (this.phase !== 'playing' && this.phase !== 'preroll') return;
    while (this.chIdx < this.chorus.length && gt >= this.chorus[this.chIdx][1]) this.chIdx++;
    const c = this.chorus[this.chIdx];
    if (!c || gt < c[0] - 0.02) return;
    if (this.chFired !== this.chIdx) {          // 이번 후렴에 막 들어옴
      this.chFired = this.chIdx;
      if (gt - c[0] < 0.5) { this.chAt = now; fxShake(this.fx, 2.5, now); }
    }
    const { ctx, h, x0, fieldW } = L;
    const bl = 60 / (this.song.bpm || 120);
    const ph = ((gt - (this.song.offset || 0)) / bl) % 1;
    const pulse = Math.exp(-((ph + 1) % 1) * 5);              // 박마다 살짝 밝아짐
    const fade = clamp((gt - c[0]) / 0.4, 0, 1) * clamp((c[1] - gt) / 0.6, 0, 1);
    const a = fade * (0.16 + 0.22 * pulse);
    for (const side of [0, 1]) {
      const xe = side ? x0 + fieldW : x0;
      const g = ctx.createLinearGradient(xe, 0, xe + (side ? -1 : 1) * fieldW * 0.22, 0);
      g.addColorStop(0, `rgba(255,200,61,${a.toFixed(3)})`); g.addColorStop(1, 'rgba(255,200,61,0)');
      ctx.fillStyle = g;
      ctx.fillRect(side ? xe - fieldW * 0.22 : xe, 0, fieldW * 0.22, judgeY);
    }
    const e = (now - (this.chAt || -1e9)) / 1100;
    if (e >= 0 && e < 1) {
      // 판정선에서 위로 쓸어 올라가는 빛 + 글자
      const y = judgeY - judgeY * Math.min(1, e * 1.8);
      const g = ctx.createLinearGradient(0, y - 60, 0, y + 60);
      g.addColorStop(0, 'rgba(255,220,120,0)'); g.addColorStop(0.5, `rgba(255,220,120,${(0.4 * (1 - e)).toFixed(3)})`); g.addColorStop(1, 'rgba(255,220,120,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x0, y - 60, fieldW, 120);
      const pop = Math.min(1, e / 0.1);
      ctx.save();
      ctx.globalAlpha = e < 0.7 ? 1 : (1 - e) / 0.3;
      ctx.translate(x0 + fieldW / 2, h * 0.12);   // 콤보 숫자와 겹치지 않게 위쪽
      ctx.transform(1, 0, -0.18, 1, 0, 0);
      ctx.scale(1.6 - 0.6 * pop, 1.6 - 0.6 * pop);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `900 ${fieldW < 260 ? 16 : 20}px ${UI_FONT}`;
      ctx.fillStyle = '#fff';
      ctx.shadowColor = C_GOLD;
      ctx.shadowBlur = 18;
      ctx.fillText('HIGHLIGHT', 0, 0);
      ctx.restore();
    }
  }

  /* 풀콤보 / 올퍼펙트: 기어 한가운데 큰 글자 + 빛 고리 + 반짝이 */
  drawFullCombo(L, now) {
    if (!this.fcAt) return;
    const e = (now - this.fcAt) / 2000;
    if (e >= 1) return;
    const { ctx, h, x0, fieldW } = L;
    const ap = this.fcKind === 'ap';
    const cx = x0 + fieldW / 2, cy = h * 0.4;
    ctx.save();
    ctx.beginPath(); ctx.rect(x0 - 40, 0, fieldW + 80, h); ctx.clip();
    // 화면을 살짝 덮는 빛
    ctx.fillStyle = ap ? `rgba(255,240,200,${(0.22 * (1 - e)).toFixed(3)})` : `rgba(120,200,255,${(0.16 * (1 - e)).toFixed(3)})`;
    ctx.fillRect(x0, 0, fieldW, h);
    // 퍼지는 고리 두 개
    for (const [d, w] of [[0, 4], [0.12, 2]]) {
      const k = clamp((e - d) / 0.5, 0, 1);
      if (k <= 0 || k >= 1) continue;
      ctx.globalAlpha = 1 - k;
      ctx.strokeStyle = ap ? C_GOLD : C_CYAN;
      ctx.lineWidth = w;
      ctx.beginPath(); ctx.arc(cx, cy, 30 + fieldW * 0.7 * k, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // 반짝이 (매 프레임 같은 자리에 나오도록 시드 고정)
    for (let i = 0; i < 26; i++) {
      const a = (i * 2.399) % (Math.PI * 2), sp = 0.55 + ((i * 37) % 11) / 20;
      const r = fieldW * 0.62 * sp * Math.min(1, e * 2.2);
      const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r * 0.8 + 60 * e * e;
      ctx.globalAlpha = Math.max(0, 1 - e * 1.15);
      ctx.fillStyle = ap ? ['#fff3b0', C_GOLD, '#ff9de0', '#9ff6ff'][i % 4] : ['#ffffff', C_CYAN, '#9fc4ff'][i % 3];
      const s = 2 + (i % 3);
      ctx.fillRect(x - s / 2, y - s / 2, s, s);
    }
    // 글자
    const pop = Math.min(1, e / 0.08);
    const out = e > 0.8 ? (1 - e) / 0.2 : 1;
    ctx.globalAlpha = out;
    ctx.translate(cx, cy);
    ctx.transform(1, 0, -0.18, 1, 0, 0);
    const sc = (2.1 - 1.1 * pop) * (fieldW < 300 ? 0.75 : 1);
    ctx.scale(sc, sc);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `900 30px ${UI_FONT}`;
    const label = ap ? 'ALL PERFECT!' : 'FULL COMBO!';
    if (ap) {
      const g = ctx.createLinearGradient(-110, 0, 110, 0);
      const sh = (now / 600) % 1;
      g.addColorStop(0, '#ff9de0'); g.addColorStop(clamp(0.35 + sh * 0.3, 0, 1), '#fff3b0'); g.addColorStop(1, '#9ff6ff');
      ctx.fillStyle = g;
    } else ctx.fillStyle = '#ffffff';
    ctx.shadowColor = ap ? C_GOLD : C_CYAN;
    ctx.shadowBlur = 22;
    ctx.fillText(label, 0, 0);
    ctx.shadowBlur = 0;
    ctx.font = `700 11px ${UI_FONT}`;
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillText(ap ? `${this.maxCombo} PERFECT` : `${this.maxCombo} COMBO`, 0, 28);
    ctx.restore();
  }

  /* ---------------- 그리기 */
  draw() {
    const L = fitCanvas(this.cv, this.nl, { scale: settings.skin.laneScale, pos: settings.skin.gearPos });
    this.L = L;
    const { ctx, w, h, laneW, fieldW, x0 } = L;
    const judgeY = judgeLineY(h);
    const gt = this.phase === 'loading' || this.phase === 'ready' ? this.startT - 3 : this.gt;
    const pps = (150 + settings.speed * 90) * (h < 600 ? h / 600 : 1);
    const nowF = performance.now();
    const off0 = fxOffset(this.fx, nowF);       // 기어 반동·흔들림
    ctx.clearRect(0, 0, w, h);
    ctx.save();
    ctx.translate(off0.dx, off0.dy);
    drawLanes(L, judgeY, this.pressed, settings.dim);
    drawBeams(L, judgeY, this.pressed, this.fx, nowF);

    // 박자선
    const bpm = this.song.bpm || 120;
    const bl = 60 / bpm;
    const off = this.song.offset || 0;
    const tTop = gt + judgeY / pps;
    ctx.fillStyle = 'rgba(255,255,255,0.07)';
    const beats = this.song.beats;
    if (Array.isArray(beats) && beats.length > 8) {
      // 분석된 실제 박 위치 (템포가 변하는 곡도 마디선이 맞음)
      let i = lowerBound(beats, gt - 0.3);
      for (; i < beats.length && beats[i] < tTop; i++) {
        const y = judgeY - (beats[i] - gt) * pps;
        ctx.fillRect(x0, y, fieldW, i % 4 === 0 ? 2 : 1);
      }
    } else {
      let k = Math.ceil((gt - 0.3 - off) / bl);
      for (let bt = off + k * bl; bt < tTop; bt += bl, k++) {
        const y = judgeY - (bt - gt) * pps;
        ctx.fillRect(x0, y, fieldW, k % 4 === 0 ? 2 : 1);
      }
    }

    const now = performance.now();

    // 노트
    while (this.drawFrom < this.notes.length) {
      const n = this.notes[this.drawFrom];
      if (n.t + n.d < gt - 0.6 && n.head && (n.d === 0 || n.tail)) this.drawFrom++;
      else break;
    }
    for (let i = this.drawFrom; i < this.notes.length; i++) {
      const n = this.notes[i];
      if (n.t > tTop + 0.1) break;
      const holding = this.activeHold[n.l] === n;
      if (n.head && n.head !== 'miss' && !holding) continue; // 처리 끝난 노트
      let yHead = judgeY - (n.t - gt) * pps;
      const yTail = n.d > 0 ? judgeY - (n.t + n.d - gt) * pps : null;
      if (holding) yHead = judgeY;
      if (yTail !== null && yTail > h) continue;
      if (yTail === null && yHead > h + 20) continue;
      const state = n.head === 'miss' || n.tail === 'miss' ? 'dead' : holding ? 'hold' : 'live';
      drawNote(L, n.l, yHead, yTail, state, n.a);
    }

    drawJudgeLine(L, judgeY, this.pressed);
    drawFx(L, judgeY, this.fx, now);   // 타격 이펙트
    for (let l = 0; l < this.nl; l++) if (this.activeHold[l] && (this.phase === 'playing' || this.phase === 'preroll')) fxHoldSpark(this.fx, l, now);
    drawPunch(L, judgeY, this.fx, now);

    // 진행 바
    const p0 = this.startT, p1 = this.practice ? this.practice.end : (this.song.duration || this.lastEnd || 1);
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    ctx.fillRect(x0, 0, fieldW, 4);
    ctx.fillStyle = this.practice ? C_GOLD : C_BLUE;
    ctx.fillRect(x0, 0, fieldW * clamp((gt - p0) / (p1 - p0 || 1), 0, 1), 4);

    // 피버 게이지 (오른쪽 레일) + FEVER 표시
    const fv = this.fever;
    const gh = judgeY - 20;
    const inFever = fv.mult > 1 && gt <= fv.until + 0.2;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(x0 + fieldW + 2, 10, 6, gh);
    const ratio = inFever ? clamp((fv.until - gt) / FEVER_SEC, 0, 1) : fv.gauge / 100;
    const gg = ctx.createLinearGradient(0, judgeY, 0, 10);
    gg.addColorStop(0, inFever ? '#ff7a3d' : C_BLUE); gg.addColorStop(1, inFever ? C_GOLD : C_CYAN);
    ctx.fillStyle = gg;
    ctx.fillRect(x0 + fieldW + 2, 10 + gh * (1 - ratio), 6, gh * ratio);
    if (inFever && settings.skin.fever) {
      const pulse = 0.5 + 0.5 * Math.sin(now / 90);
      ctx.fillStyle = `rgba(255,170,40,${0.05 + 0.05 * pulse})`;
      ctx.fillRect(x0, 0, fieldW, judgeY);
      const pop = clamp((now - this.feverPop) / 250, 0, 1);
      ctx.save();
      ctx.translate(x0 + fieldW / 2, 34);
      ctx.transform(1, 0, -0.18, 1, 0, 0);
      ctx.scale(1 + 0.4 * (1 - pop), 1 + 0.4 * (1 - pop));
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `900 ${laneW < 60 ? 18 : 24}px ${UI_FONT}`;
      ctx.fillStyle = C_GOLD;
      ctx.shadowColor = '#ff7a3d';
      ctx.shadowBlur = 16 + 10 * pulse;
      ctx.fillText(`FEVER x${fv.mult}`, 0, 0);
      ctx.restore();
    }
    if (this.practice) {
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.font = `800 11px ${UI_FONT}`;
      ctx.fillStyle = C_GOLD;
      ctx.fillText(this.hl ? 'HIGHLIGHT' : `PRACTICE x${this.rate}${this.practice.loop ? ' · LOOP' : ''}`, x0 + 6, 10);
    }

    // 점수 / 정확도 (기어 옆에 자리가 있으면 바깥, 없으면 안쪽)
    ctx.textBaseline = 'top';
    const roomR = w - (x0 + fieldW) >= 115, roomL = x0 >= 130;
    const outside = roomR || roomL;
    ctx.textAlign = roomR ? 'left' : 'right';
    const sx = roomR ? x0 + fieldW + 18 : roomL ? x0 - 18 : x0 + fieldW - 10;
    ctx.fillStyle = '#fff';
    ctx.font = `800 ${outside ? 13 : 11}px ${UI_FONT}`;
    ctx.fillStyle = 'rgba(160,190,255,0.7)';
    if (outside) ctx.fillText('SCORE', sx, 0);
    ctx.fillStyle = '#fff';
    ctx.font = `800 ${outside ? 26 : 18}px ${UI_FONT}`;
    ctx.fillText(String(this.score()).padStart(7, '0'), sx, 16);
    ctx.font = '500 14px "JetBrains Mono", monospace';
    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    ctx.fillText(this.acc().toFixed(2) + '%', sx, outside ? 46 : 40);
    if (this.ghost && settings.ghost !== false && this.phase !== 'loading' && this.phase !== 'ready') this.drawGhost(ctx, sx, outside ? 74 : 62, outside, roomR || !outside);

    const cx = x0 + fieldW / 2;
    if (this.stage) this.stage.draw({ beat: Math.max(0, Math.floor((gt - off) / bl)), fever: inFever && settings.skin.fever, label: settings.nick || '' });
    drawCombo(L, this.fcAt ? 0 : this.combo, this.comboPop, now);   // 풀콤보 글자가 뜨면 콤보 숫자는 숨김 (글자 아래에 콤보 수 표시)
    drawMilestone(L, this.fx, now);
    this.drawChorus(L, judgeY, gt, now);
    this.drawFullCombo(L, now);
    drawJudgePopup(L, this.popup, now);
    ctx.restore();

    // 상태 문구
    ctx.textBaseline = 'middle';
    let msg = '';
    if (this.phase === 'loading') msg = '불러오는 중...';
    else if (this.phase === 'ready') msg = this.multi ? '다른 플레이어를 기다리는 중...' : '';
    else if (this.phase === 'countdown' && this.clock.now() < this.startT) msg = String(Math.ceil((this.startT - this.clock.now()) / this.rate));
    else if (this.phase === 'waitVideo' && now - this.waitSince > 600) msg = '영상 시작 대기 중...';
    if (msg) {
      ctx.textAlign = 'center';
      ctx.font = msg.length <= 2 ? `900 84px ${UI_FONT}` : '700 20px "Noto Sans KR", sans-serif';
      ctx.fillStyle = '#fff';
      ctx.fillText(msg, cx, h * 0.45);
    }
  }

  renderLive() {
    if (!this.multi || !net.room) return;
    const rows = net.room.players.map((p) => {
      const me = p.id === net.id;
      const d = me ? { score: this.score(), combo: this.combo } : this.peers[p.id] || { score: 0, combo: 0 };
      const diff = me ? this.diff : p.diff, keys = me ? this.nl : p.keys;
      return { name: p.name, me, avatar: p.avatar, diff, keys, ...d };
    }).sort((a, b) => b.score - a.score);
    $('#liveBoard').innerHTML = rows.map((r) =>
      `<li class="${r.me ? 'me' : ''}"><span class="n">${typeof miniHtml === 'function' ? miniHtml(r.avatar, 24) : ''} ${esc(r.name)}${r.diff ? ` <small class="ld">${r.keys || 4}K ${(typeof DIFF_EN !== 'undefined' && DIFF_EN[r.diff]) || ''}</small>` : ''}</span><span class="s">${String(r.score).padStart(7, '0')}</span><span class="c">${r.combo}x</span></li>`
    ).join('');
    if (typeof paintMinis === 'function') paintMinis($('#liveBoard'));
  }

  /* ---------------- 일시정지 / 종료 */
  pause() {
    if (this.phase === 'ended' || this.phase === 'aborted') return;
    if (this.multi && !this.gotStart) {
      overlay('나가기', '아직 게임이 시작되기 전이에요.', [
        ['계속', () => { hideOverlay(); if (this.tapResolve) this.showTap(); }, 'primary'],
        ['방으로 나가기', () => { hideOverlay(); this.leaveBeforeStart(); }],
      ]);
      return;
    }
    if (this.multi) {
      overlay('나가기', '게임은 계속 진행 중이에요.', [
        ['계속하기', () => hideOverlay(), 'primary'],
        ['포기하고 나가기', () => { hideOverlay(); this.finish(true); }],
      ]);
      return;
    }
    if (!['playing', 'countdown', 'waitVideo', 'preroll'].includes(this.phase)) return;
    this.prevPhase = this.phase;
    this.phase = 'paused';          // 영상 멈춤 알림이 바로 와도 다시 일시정지를 부르지 않게 먼저 바꿈
    yt.pause();
    this.clock.stop();
    this.slew = null;
    // 누르고 있던 긴 노트는 일시정지하면 놓친 것으로 처리
    for (let l = 0; l < this.nl; l++) {
      const h = this.activeHold[l];
      if (h) { h.tail = 'miss'; this.judge('miss', l, 0, true, h.t + h.d); this.activeHold[l] = null; }
    }
    this.pressed.fill(false);
    this.touchMap.clear();
    overlay('일시정지', '', [
      ['계속하기', () => this.resume(), 'primary'],
      ['처음부터', () => { hideOverlay(); this.destroy(); startSolo(this.song.id, this.diff, this.nl, this.customNotes, this.practice); }],
      ['나가기', () => { hideOverlay(); this.destroy(); this.onExit && this.onExit(); }],
    ]);
  }

  restartPractice() {
    const acc = this.judged ? (this.sum / this.judged) * 100 : 0;
    this.loops = (this.loops || 0) + 1;
    toast(`${this.loops}회차 정확도 ${acc.toFixed(1)}% · 최대 콤보 ${this.maxCombo}`, 2200);
    this.phase = 'restarting';
    yt.pause();
    this.clock.stop();
    for (const n of this.notes) { n.head = null; n.tail = null; }
    this.laneHead.fill(0);
    this.activeHold.fill(null);
    this.drawFrom = 0;
    this.resetStats();
    this.begin(1.5);
  }

  resume() {
    hideOverlay();
    if (this.prevPhase === 'countdown') { this.phase = 'countdown'; this.clock.start(); return; }
    this.phase = 'resuming';
    yt.play();
  }

  stopSpec() { if (this.spec) { this.spec.destroy(); this.spec = null; } }

  finish(incomplete = false) {
    if (this.phase === 'ended') return;
    this.stopSpec();
    // 남은 노트는 미스 처리
    for (const n of this.notes) {
      if (!n.head) { n.head = 'miss'; this.counts.miss++; this.judged++; }
      if (n.d > 0 && !n.tail) {
        n.tail = n.head === 'miss' || incomplete ? 'miss' : 'perfect';
        this.counts[n.tail]++; this.judged++; this.sum += WEIGHT[n.tail];
      }
    }
    this.phase = 'ended';
    cancelAnimationFrame(this.raf);
    yt.pause();
    this.unsub();
    this.unbindTouch();
    const acc = this.totalUnits ? (this.sum / this.totalUnits) * 100 : 0;
    if (this.practice) yt.rate(1);
    const result = {
      score: this.score(), acc: +acc.toFixed(2), maxCombo: this.maxCombo, counts: { ...this.counts },
      rank: rankOf(acc), fc: this.counts.miss === 0 && this.totalUnits > 0, incomplete,
    };
    if (!incomplete) {               // 고스트용 점수 흐름 (끝까지 채움)
      const g = this.curve.slice(0, 21);
      while (g.length < 21) g.push(result.score);
      g[20] = result.score;
      result.g = g;
    }
    if (this.multi) net.send(this.gotStart ? { type: 'finish', result } : { type: 'loaded', error: true });
    showResult(this, result);
  }

  abort(msg) {
    if (this.phase === 'aborted' || this.phase === 'ended') return;   // 두 번 불려도 한 번만
    this.phase = 'aborted';
    this.stopSpec();
    if (this.practice) yt.rate(1);
    cancelAnimationFrame(this.raf);
    this.unsub();
    this.unbindTouch();
    try { yt.pause(); } catch { /* 무시 */ }
    hideOverlay();
    if (this.multi) net.send({ type: this.gotStart ? 'finish' : 'loaded', error: true, result: { score: 0, acc: 0, incomplete: true } });
    toast(msg || '게임을 진행할 수 없어요.', 4000);
    this.onExit && this.onExit();
  }

  destroy() {
    this.phase = 'aborted';
    this.stopSpec();
    cancelAnimationFrame(this.raf);
    this.unsub();
    this.unbindTouch();
    yt.pause();
    if (this.practice) yt.rate(1);
  }
}

/* ---------------- 오버레이 */
function overlay(title, text, buttons) {
  $('#ovTitle').textContent = title;
  $('#ovText').textContent = text;
  const box = $('#ovButtons');
  box.innerHTML = '';
  buttons.forEach(([label, fn, cls]) => {
    const b = document.createElement('button');
    b.textContent = label;
    if (cls) b.className = cls;
    b.onclick = fn;
    box.appendChild(b);
  });
  $('#gameOverlay').classList.remove('hidden');
}
function hideOverlay() { $('#gameOverlay').classList.add('hidden'); }
