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
/* 점수·콤보·판정 글자: 길쭉하고 읽기 쉬운 Saira (기울임) — 3과 8, 5와 S가 헷갈리지 않게 */
const NUM_FONT = '"Saira", "Orbitron", "Noto Sans KR", sans-serif';
function numFont(ctx, weight, px, italic = true, stretch = 'condensed') {
  ctx.font = `${italic ? 'italic ' : ''}${weight} ${Math.round(px)}px ${NUM_FONT}`;
  if ('fontStretch' in ctx) ctx.fontStretch = stretch;
}
function plainFont(ctx) { if ('fontStretch' in ctx) ctx.fontStretch = 'normal'; }

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
    if (pressed && pressed[l]) {        // 누르는 줄: 판정선 근처만 은은하게 (노트가 빛에 묻히지 않게)
      const g = ctx.createLinearGradient(0, judgeY, 0, judgeY - h * 0.3);
      g.addColorStop(0, colors[l] + '38');
      g.addColorStop(1, colors[l] + '00');
      ctx.fillStyle = g;
      ctx.fillRect(x + 1, judgeY - h * 0.3, laneW - 1, h * 0.3);
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
  } else if (sk.note === 'diamond') {
    // 마름모
    const r = Math.min(nw * 0.42, nh * 0.9 + 4);
    const cx = x + nw / 2;
    ctx.beginPath();
    ctx.moveTo(cx, yHead - r); ctx.lineTo(cx + r * 1.08, yHead); ctx.lineTo(cx, yHead + r); ctx.lineTo(cx - r * 1.08, yHead); ctx.closePath();
    const dg = ctx.createLinearGradient(0, yHead - r, 0, yHead + r);
    dg.addColorStop(0, state === 'dead' ? '#6a7088' : '#ffffff'); dg.addColorStop(0.45, col); dg.addColorStop(1, state === 'dead' ? '#30354a' : shade(col));
    ctx.fillStyle = dg;
    ctx.fill();
    if (state !== 'dead') { ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 1.5; ctx.stroke(); }
    return;
  } else if (sk.note === 'hollow') {
    // 속 빈 원 (링)
    const r = Math.min(nw * 0.42, nh * 0.9 + 4);
    ctx.beginPath();
    ctx.arc(x + nw / 2, yHead, r - 2, 0, Math.PI * 2);
    ctx.lineWidth = Math.max(4, r * 0.32);
    ctx.strokeStyle = col;
    ctx.shadowColor = col;
    ctx.shadowBlur = state === 'dead' ? 0 : 10;
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.arc(x + nw / 2, yHead, Math.max(2, r * 0.22), 0, Math.PI * 2);
    ctx.fillStyle = state === 'dead' ? '#4a5066' : '#ffffff';
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

/* 판정선 모양: 자동이면 원형·속 빈 원 노트일 때 원형 받침, 아니면 막대 */
function lineStyleOf() {
  const sk = settings.skin;
  const st = sk.lineStyle || 'auto';
  if (st !== 'auto') return st;
  return sk.note === 'circle' || sk.note === 'hollow' || sk.note === 'diamond' ? 'ring' : 'bar';
}
function receptorR(L) {
  const nw = L.laneW - 4;
  return Math.min(nw * 0.42, settings.skin.noteH * 0.9 + 4);
}
function drawJudgeLine(L, judgeY, pressed, fx = null, now = performance.now()) {
  const { ctx, laneW, fieldW, x0, nl, colors } = L;
  // 판정선 + 아래 기어 패널
  const pg = ctx.createLinearGradient(0, judgeY, 0, L.h);
  pg.addColorStop(0, '#1a2038'); pg.addColorStop(1, '#0b0e1c');
  ctx.fillStyle = pg;
  const style = lineStyleOf();
  const lc = LINE_COLORS[settings.skin.line] || C_RED;
  if (style === 'ring') {
    // 원형 받침 (동그란 노트 전용): 줄마다 노트 크기의 동그란 받침, 누르면 차오르고 칠 때 링이 퍼짐
    const r = receptorR(L);
    ctx.fillRect(x0 - 9, judgeY + r + 6, fieldW + 18, L.h - judgeY - r - 6);
    ctx.fillStyle = lc + '40';
    ctx.fillRect(x0, judgeY - 1, fieldW, 2);
    for (let l = 0; l < nl; l++) {
      const cx = x0 + l * laneW + laneW / 2;
      const on = pressed && pressed[l];
      const hit = fx ? (now - (fx.flash[l] || -1e9)) / 180 : 9;
      const grow = hit < 1 ? (1 - hit) * 0.18 : 0;
      ctx.beginPath();
      ctx.arc(cx, judgeY, r * (1 + grow), 0, Math.PI * 2);
      ctx.fillStyle = on ? colors[l] + 'cc' : 'rgba(10,14,28,0.85)';
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = on ? '#ffffff' : lc;
      ctx.shadowColor = on ? colors[l] : lc;
      ctx.shadowBlur = on ? 22 : 12;
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.beginPath();
      ctx.arc(cx, judgeY, r * 0.55, 0, Math.PI * 2);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = on ? 'rgba(255,255,255,0.9)' : colors[l] + '66';
      ctx.stroke();
      if (hit < 1) {                       // 칠 때 퍼지는 링
        ctx.beginPath();
        ctx.arc(cx, judgeY, r * (1 + hit * 0.9), 0, Math.PI * 2);
        ctx.lineWidth = 3 * (1 - hit);
        ctx.strokeStyle = `rgba(255,255,255,${(0.8 * (1 - hit)).toFixed(3)})`;
        ctx.stroke();
      }
    }
  } else {
    ctx.fillRect(x0 - 9, judgeY + 6, fieldW + 18, L.h - judgeY - 6);
    const th = style === 'thin' ? 2 : 6;
    ctx.fillStyle = lc;
    ctx.shadowColor = lc;
    ctx.shadowBlur = style === 'thin' ? 12 : 18;
    ctx.fillRect(x0, judgeY - th / 2, fieldW, th);
    ctx.shadowBlur = 0;
    if (style !== 'thin') {
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.fillRect(x0, judgeY - 1, fieldW, 1);
    }
  }
  // 키(터치 영역) 표시
  const keys = keysFor(nl);
  ctx.font = `700 ${laneW < 60 ? 12 : 15}px "JetBrains Mono", monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const bh = isTouch ? 64 : 40;
  if (style === 'ring') {       // 원형 받침: 키 이름은 받침 안에 (아래 칸 없이)
    if (!isTouch) {
      ctx.font = `700 ${laneW < 60 ? 10 : 12}px "JetBrains Mono", monospace`;
      for (let l = 0; l < nl; l++) {
        const on = pressed && pressed[l];
        ctx.fillStyle = on ? '#0b0b14' : 'rgba(255,255,255,0.55)';
        ctx.fillText(keyLabel(keys[l]), x0 + l * laneW + laneW / 2, judgeY + 1);
      }
    }
    return;
  }
  const top = judgeY + 14;
  for (let l = 0; l < nl; l++) {
    const x = x0 + l * laneW;
    const on = pressed && pressed[l];
    ctx.fillStyle = on ? colors[l] : 'rgba(255,255,255,0.07)';
    ctx.fillRect(x + 3, top, laneW - 6, bh);
    ctx.fillStyle = on ? 'rgba(255,255,255,0.6)' : colors[l] + '55';
    ctx.fillRect(x + 3, top, laneW - 6, 3);
    if (!isTouch) {
      ctx.fillStyle = on ? '#0b0b14' : 'rgba(255,255,255,0.6)';
      ctx.fillText(keyLabel(keys[l]), x + laneW / 2, top - 2 + bh / 2);
    }
  }
}

/* ============================================================ 타격 이펙트 / 콤보 / 판정 글자 */
function fxNew(nl) {
  return {
    flash: new Array(nl).fill(0), rings: [], parts: [],
    // 타격감: 폭발·파편·키 빔·판정선 펄스·기어 반동·흔들림·미스 번쩍임·콤보 축하
    bursts: [], shards: [], glints: [], beamOff: new Array(nl).fill(-1e9), miss: new Array(nl).fill(-1e9),
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
/* PERFECT 보너스: 다른 판정 연출은 그대로 두고, PERFECT일 때만 작은 별빛 반짝임을 하나 더 얹음 */
function fxPerfect(fx, lane, now = performance.now()) {
  if (settings.skin.perfectGlint === false || settings.skin.effect === 'off') return;
  fx.glints.push({ lane, at: now, rot: Math.random() * Math.PI });
  if (fx.glints.length > 24) fx.glints.shift();
}
function drawGlints(L, judgeY, fx, now) {
  if (!fx.glints || !fx.glints.length) return;
  const { ctx, laneW, x0 } = L;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  fx.glints = fx.glints.filter((g) => now - g.at < 320);
  for (const g of fx.glints) {
    const k = (now - g.at) / 320;
    const cx = x0 + g.lane * laneW + laneW / 2, cy = judgeY;
    const len = laneW * (0.28 + 0.32 * Math.sin(Math.min(1, k * 1.6) * Math.PI / 2)) * (1 - k * 0.35);
    ctx.save();
    ctx.globalAlpha = (1 - k) * 0.95;
    ctx.translate(cx, cy);
    ctx.rotate(g.rot + k * 0.6);
    const grad = ctx.createLinearGradient(-len, 0, len, 0);
    grad.addColorStop(0, 'rgba(255,240,170,0)'); grad.addColorStop(0.5, 'rgba(255,250,220,1)'); grad.addColorStop(1, 'rgba(255,240,170,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(-len, -1.2, len * 2, 2.4);           // 가로 빛줄기
    ctx.rotate(Math.PI / 2);
    ctx.fillRect(-len * 0.7, -1, len * 1.4, 2);       // 세로 빛줄기 (조금 짧게)
    ctx.restore();
  }
  ctx.restore();
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
/* 롱노트를 누르는 동안: 판정선 위가 숨 쉬듯 빛나고 살짝 떨림 */
function drawHoldGlow(L, judgeY, lane, now) {
  if (settings.skin.effect === 'off') return;
  const { ctx, laneW, x0, colors } = L;
  const cx = x0 + lane * laneW + laneW / 2 + Math.sin(now / 23 + lane) * 1.5;
  const pulse = 0.65 + 0.35 * Math.sin(now / 70);
  const r = laneW * 0.55;
  const g = ctx.createRadialGradient(cx, judgeY, 2, cx, judgeY, r);
  g.addColorStop(0, `rgba(255,255,255,${(0.55 * pulse).toFixed(3)})`);
  g.addColorStop(0.35, colors[lane] + 'aa');
  g.addColorStop(1, colors[lane] + '00');
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = g;
  ctx.fillRect(cx - r, judgeY - r, r * 2, r * 2);
  ctx.restore();
}

/* 판정 오차 막대: 가운데가 정확, 왼쪽 빠름 · 오른쪽 느림. 최근 친 노트가 점으로 찍히고 3초 동안 서서히 사라짐 */
function drawErrorBar(L, judgeY, hist, now) {
  const { ctx, fieldW, x0, laneW, h } = L;
  const w = Math.min(fieldW * 0.62, 260);
  const cx = x0 + fieldW / 2;
  // 키 칸 아래에 자리가 있으면 거기, 없으면 판정선 바로 위에 (가리지 않게 얇게)
  const below = lineStyleOf() === 'ring' ? judgeY + receptorR(L) + 16 : judgeY + (isTouch ? 86 : 64);
  const y = below + 8 <= h - 2 ? below : judgeY - (lineStyleOf() === 'ring' ? receptorR(L) + 14 : 22);
  const sc = (w / 2) / JUDGE.good;
  ctx.save();
  // 판정 구간 (GOOD · GREAT · PERFECT)
  ctx.globalAlpha = 0.55;
  ctx.fillStyle = JUDGE_COLORS.good; ctx.fillRect(cx - JUDGE.good * sc, y - 2, JUDGE.good * sc * 2, 4);
  ctx.fillStyle = JUDGE_COLORS.great; ctx.fillRect(cx - JUDGE.great * sc, y - 2, JUDGE.great * sc * 2, 4);
  ctx.fillStyle = JUDGE_COLORS.perfect; ctx.fillRect(cx - JUDGE.perfect * sc, y - 2, JUDGE.perfect * sc * 2, 4);
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(cx - 1, y - 7, 2, 14);
  // 최근 타격
  let sum = 0, cnt = 0;
  for (const e of hist || []) {
    const age = (now - e.at) / 3000;
    if (age >= 1) continue;
    const x = cx + clamp(e.dt, -JUDGE.good, JUDGE.good) * sc;
    ctx.globalAlpha = 1 - age;
    ctx.fillStyle = JUDGE_COLORS[e.kind] || '#fff';
    ctx.fillRect(x - 1, y - 6, 2, 12);
    sum += e.dt; cnt++;
  }
  // 평균 위치 (요즘 빠른지 느린지)
  if (cnt >= 3) {
    const ax = cx + clamp(sum / cnt, -JUDGE.good, JUDGE.good) * sc;
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.moveTo(ax, y - 8); ctx.lineTo(ax - 4, y - 14); ctx.lineTo(ax + 4, y - 14); ctx.closePath(); ctx.fill();
  }
  ctx.globalAlpha = 0.6;
  ctx.font = `600 9px ${UI_FONT}`;
  ctx.fillStyle = '#cfd8ff';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'right'; ctx.fillText('빠름', cx - w / 2 - 6, y);
  ctx.textAlign = 'left'; ctx.fillText('느림', cx + w / 2 + 6, y);
  ctx.restore();
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
    // 짧은 빛 (osu!mania·DJMAX처럼 판정선 위 조금만) — 타격감 '강하게'면 조금 더 길게
    const top = judgeY - L.h * (0.14 + 0.1 * Math.min(1.6, k));
    const g = ctx.createLinearGradient(0, judgeY, 0, top);
    g.addColorStop(0, colors[l] + '99'); g.addColorStop(0.35, colors[l] + '33'); g.addColorStop(1, colors[l] + '00');
    ctx.globalAlpha = a * Math.min(1, 0.5 + 0.25 * k);
    ctx.fillStyle = g;
    ctx.fillRect(cx - laneW * 0.46, top, laneW * 0.92, judgeY - top);
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
  if (tl < 1 && lineStyleOf() !== 'ring') {
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
    const r = laneW * (0.3 + 0.55 * Math.sqrt(e)) * b.size * Math.min(1.4, 0.75 + 0.3 * k);
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
  const cx = x0 + fieldW / 2, cy = hudY(L);
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
  ctx.translate(cx, cy - comboSize(L) * 0.62 - 26);
  ctx.scale(1.5 - 0.5 * pop, 1.5 - 0.5 * pop);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  numFont(ctx, 900, 20);
  ctx.fillStyle = C_GOLD;
  ctx.shadowColor = '#ff7a3d';
  ctx.shadowBlur = 12;
  ctx.fillText(`${m.combo} COMBO!`, 0, 0);
  ctx.restore();
  plainFont(ctx);
  ctx.globalAlpha = 1;
}
function comboColor(combo) {
  return combo >= 200 ? ['#ffffff', '#ffd36b', 'rgba(255,170,40,0.85)']
    : combo >= 100 ? ['#ffffff', '#ffe08a', 'rgba(255,200,61,0.8)']
      : combo >= 50 ? ['#ffffff', '#8ff0ff', 'rgba(77,225,255,0.8)']
        : ['#ffffff', '#9fc4ff', 'rgba(63,140,255,0.8)'];
}

/* 콤보·판정 글자 자리: 기어 가운데보다 조금 위 (노트 뒤에 그려서 노트를 가리지 않음) */
function hudY(L) { return L.h * 0.33; }
function comboSize(L) { return Math.round(Math.min(60, L.laneW * 0.62 + 22)); }
function drawCombo(L, combo, popAt, now) {
  if (!settings.skin.combo || combo < 2) return;
  const { ctx, x0, fieldW } = L;
  const cx = x0 + fieldW / 2, cy = hudY(L), fs = comboSize(L);
  const p = clamp((now - popAt) / 140, 0, 1);
  const sc = 1 + 0.14 * punchK() * (1 - p) * (1 - p);
  const cc = comboColor(combo);
  ctx.save();
  ctx.globalAlpha = 0.88;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.translate(cx, cy);
  ctx.scale(sc, sc);
  numFont(ctx, 800, fs);
  const cg = ctx.createLinearGradient(0, -fs / 2, 0, fs / 2);
  cg.addColorStop(0, cc[0]); cg.addColorStop(1, cc[1]);
  ctx.lineWidth = 5; ctx.lineJoin = 'round'; ctx.strokeStyle = 'rgba(3,6,16,0.55)';
  ctx.strokeText(combo, 0, 0);
  ctx.fillStyle = cg;
  ctx.shadowColor = cc[2];
  ctx.shadowBlur = 10;
  ctx.fillText(combo, 0, 0);
  ctx.restore();
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  numFont(ctx, 700, 12, false);
  ctx.fillStyle = 'rgba(190,210,255,0.6)';
  if ('letterSpacing' in ctx) ctx.letterSpacing = '4px';
  ctx.fillText('COMBO', cx, cy - fs * 0.62);
  ctx.restore();
  plainFont(ctx);
}
function judgeFs(L) { return Math.round((L.laneW < 60 ? 24 : 30) * (settings.skin.judgeText === 'small' ? 0.68 : 1)); }
/* 판정 글자 높이: 기본은 판정선 위 (노트를 치는 곳 가까이 — 눈을 덜 움직이게), '위쪽'이면 예전처럼 콤보 바로 아래 */
function judgePopY(L, judgeY) {
  if (settings.skin.judgePos === 'top') return hudY(L) + (settings.skin.combo ? comboSize(L) * 0.5 + judgeFs(L) * 0.75 : 0);
  return judgeY - Math.max(judgeY * 0.42, 140);
}
function drawJudgePopup(L, popup, now, judgeY = judgeLineY(L.h)) {
  const mode = settings.skin.judgeText;
  if (!popup || mode === 'off') return;
  const age = (now - popup.at) / 1000;
  if (age >= 0.5) return;
  const { ctx, x0, fieldW } = L;
  const small = mode === 'small';
  const pk = punchK();
  const big = (popup.kind === 'perfect' ? 0.3 : popup.kind === 'miss' ? 0.08 : 0.2) * Math.min(pk, 1.2);
  const sc = age < 0.08 ? 1 + big * (1 - age / 0.08) ** 2 : 1;
  const fs = judgeFs(L);
  const y = judgePopY(L, judgeY);
  ctx.save();
  ctx.textAlign = 'center';
  ctx.globalAlpha = (age > 0.35 ? 1 - (age - 0.35) / 0.15 : 1) * 0.95;
  ctx.translate(x0 + fieldW / 2, y);
  ctx.scale(sc, sc);
  ctx.textBaseline = 'middle';
  numFont(ctx, 900, fs, true, 'semi-condensed');
  if ('letterSpacing' in ctx) ctx.letterSpacing = '1px';
  ctx.lineWidth = 4; ctx.lineJoin = 'round'; ctx.strokeStyle = 'rgba(3,6,16,0.6)';
  ctx.strokeText(JUDGE_TEXT[popup.kind], 0, 0);
  ctx.fillStyle = JUDGE_COLORS[popup.kind];
  ctx.shadowColor = JUDGE_COLORS[popup.kind];
  ctx.shadowBlur = small ? 6 : 10;
  ctx.fillText(JUDGE_TEXT[popup.kind], 0, 0);
  ctx.shadowBlur = 0;
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  plainFont(ctx);
  if (popup.sub && settings.skin.earlyLate) {      // 빠름·느림 + 몇 ms (빠르면 파랑, 늦으면 주황)
    const early = popup.ms != null ? popup.ms < 0 : popup.sub === '빠름';
    const msTxt = popup.ms != null ? ` ${popup.ms > 0 ? '+' : popup.ms < 0 ? '−' : '±'}${Math.abs(popup.ms)}ms` : '';
    ctx.font = `800 ${small ? 11 : 14}px "Noto Sans KR", sans-serif`;
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(3,6,16,0.6)';
    ctx.strokeText(popup.sub + msTxt, 0, fs * 0.9);
    ctx.fillStyle = early ? '#7fd4ff' : '#ffb36b';
    ctx.fillText(popup.sub + msTxt, 0, fs * 0.9);
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
    const shift = (+song.noteShift || 0) / 1000;   // 곡마다 노트 전체 타이밍 (호스트가 곡 정보에서 ±)
    this.notes = src.map((n) => ({ t: +n.t + shift, l: map[n.l | 0] ?? (n.l | 0), d: +n.d || 0, a: n.a ? 1 : 0, head: null, tail: null }))
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
    // AI 일러스트가 있으면 캐릭터 칸 오른쪽에 크게 (도트는 왼쪽 앞)
    const ilUrl = typeof aiIllustUrl === 'function' ? aiIllustUrl(settings.avatar) : '';
    this.ilEl = $('#stageIl');
    this.ilOn = !!ilUrl && !!this.ilEl;
    if (this.ilEl) {
      this.ilEl.classList.toggle('hidden', !this.ilOn);
      this.ilEl.className = 'stage-il' + (this.ilOn ? '' : ' hidden');
      if (this.ilOn && $('#stageIlImg').getAttribute('src') !== ilUrl) $('#stageIlImg').src = ilUrl;
    }
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
    if (kind !== 'miss') { this.offsets.push(dt); (this.errHist || (this.errHist = [])).push({ dt, kind, at: performance.now() }); if (this.errHist.length > 40) this.errHist.shift(); }
    this.judge(kind, lane, dt, false, n.t);
    if (n.a && kind !== 'miss') { fxAccent(this.fx, lane, kind); sfx.accent(); }   // 드럼 강타: 크게 터지고 묵직한 소리
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
    else { n.tail = 'perfect'; this.judge('perfect', lane, 0, true, n.t + n.d); this.holdDone(lane); }
  }

  /* 롱노트를 정확히 끝까지 눌렀다 뗌: '딱' + 작은 폭발 */
  holdDone(lane) {
    const now = performance.now();
    fxHit(this.fx, lane, now);
    fxBurst(this.fx, lane, 'great', now);
    sfx.release();
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
      if (this.combo >= 20) { fxShake(this.fx, 1.5, now); sfx.comboBreak(); }   // 긴 콤보가 끊기면 살짝 흔들림 + '툭'
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
        if (kind === 'perfect') fxPerfect(this.fx, lane, now);
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
      // 친 노트는 판정과 함께 얼마나 빨랐는지·늦었는지 (ms) — 그냥 지나간 미스는 없음
      const ms = !tail && dt ? Math.round(dt * 1000) : null;
      const sub = ms == null ? '' : ms < 0 ? '빠름' : ms > 0 ? '느림' : '정확';
      this.popup = { kind, sub, ms, at: performance.now() };
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
        this.holdDone(l);
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
    ctx.font = `700 ${outside ? 11 : 10}px "Noto Sans KR", sans-serif`;
    ctx.fillStyle = 'rgba(200,170,255,0.9)';
    ctx.fillText(`VS ${this.ghost.label}`, sx, y);
    numFont(ctx, 800, outside ? 19 : 15, false);
    ctx.fillStyle = this.judged === 0 ? 'rgba(255,255,255,0.5)' : d >= 0 ? '#4dffa6' : '#ff5a72';
    ctx.fillText(`${d >= 0 ? '+' : '−'}${Math.abs(d).toLocaleString()}`, sx, y + 14);
    plainFont(ctx);
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

  /* 배경 연출: 화면 뒤에 곡 썸네일을 흐리게 깔고, 박자마다 살짝 밝아지고 커짐 (후렴 금빛 · 피버 분홍빛)
     CSS 변수만 바꿔서 가볍게 (흐림은 한 번만 그려 둠) */
  drawBg(gt) {
    const el = this.bgEl || (this.bgEl = document.getElementById('gameBg'));
    if (!el) return;
    const mode = settings.skin.bgFx || 'soft';
    const on = mode !== 'off' && (this.phase === 'playing' || this.phase === 'preroll' || this.phase === 'countdown' || this.phase === 'paused');
    el.classList.toggle('on', mode !== 'off');
    if (!on) { el.style.setProperty('--pulse', '0'); el.style.setProperty('--tint', '0'); return; }
    const beats = this.bgBeats || (this.bgBeats = (Array.isArray(this.song.beats) && this.song.beats.length > 8) ? this.song.beats.map(Number) : null);
    let ph;
    if (beats) {
      let i = this.bgBi || 0;
      while (i + 1 < beats.length && beats[i + 1] <= gt) i++;
      while (i > 0 && beats[i] > gt) i--;
      this.bgBi = i;
      const a = beats[i], b = beats[i + 1] || a + 0.5;
      ph = gt < a ? 1 : (gt - a) / Math.max(0.05, b - a);
    } else {
      const bl = 60 / (this.song.bpm || 120);
      ph = (((gt - (this.song.offset || 0)) / bl) % 1 + 1) % 1;
    }
    const k = mode === 'strong' ? 1 : 0.55;
    let chorus = 0;
    for (const c of this.chorus) if (gt >= c[0] && gt < c[1]) { chorus = clamp((gt - c[0]) / 0.5, 0, 1) * clamp((c[1] - gt) / 0.6, 0, 1); break; }
    const fv = this.fever;
    const fever = fv && fv.mult > 1 && gt <= fv.until + 0.2 ? 1 : 0;
    const pulse = Math.exp(-ph * 6) * k * (1 + chorus * 0.8);
    el.style.setProperty('--pulse', pulse.toFixed(3));
    el.style.setProperty('--tint', (chorus * k).toFixed(3));
    el.style.setProperty('--fever', (fever * k).toFixed(3));
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
      ctx.scale(1.6 - 0.6 * pop, 1.6 - 0.6 * pop);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.globalAlpha *= 0.85;
      numFont(ctx, 900, fieldW < 260 ? 18 : 22);
      if ('letterSpacing' in ctx) ctx.letterSpacing = '2px';
      ctx.fillStyle = '#fff';
      ctx.shadowColor = C_GOLD;
      ctx.shadowBlur = 18;
      ctx.fillText('HIGHLIGHT', 0, 0);
      ctx.restore();
      plainFont(ctx);
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
    this.drawBg(gt);
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

    // 노트 뒤에 그리는 것들 (콤보·판정 글자·후렴·피버 글자) — 노트가 늘 맨 위에 보이게
    const fv = this.fever;
    const inFever = fv.mult > 1 && gt <= fv.until + 0.2;
    this.drawChorus(L, judgeY, gt, now);
    if (inFever && settings.skin.fever) {
      const pulse = 0.5 + 0.5 * Math.sin(now / 90);
      ctx.fillStyle = `rgba(255,170,40,${0.05 + 0.05 * pulse})`;
      ctx.fillRect(x0, 0, fieldW, judgeY);
      const pop = clamp((now - this.feverPop) / 250, 0, 1);
      ctx.save();
      ctx.translate(x0 + fieldW / 2, 34);
      ctx.scale(1 + 0.35 * (1 - pop), 1 + 0.35 * (1 - pop));
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      numFont(ctx, 900, laneW < 60 ? 20 : 26);
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = C_GOLD;
      ctx.shadowColor = '#ff7a3d';
      ctx.shadowBlur = 12 + 8 * pulse;
      ctx.fillText(`FEVER ×${fv.mult}`, 0, 0);
      ctx.restore();
      plainFont(ctx);
    }
    drawCombo(L, this.fcAt ? 0 : this.combo, this.comboPop, now);   // 풀콤보 글자가 뜨면 콤보 숫자는 숨김 (글자 아래에 콤보 수 표시)
    drawMilestone(L, this.fx, now);
    drawJudgePopup(L, this.popup, now, judgeY);

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

    drawJudgeLine(L, judgeY, this.pressed, this.fx, now);
    drawFx(L, judgeY, this.fx, now);   // 타격 이펙트
    for (let l = 0; l < this.nl; l++) if (this.activeHold[l] && (this.phase === 'playing' || this.phase === 'preroll')) { fxHoldSpark(this.fx, l, now); drawHoldGlow(L, judgeY, l, now); }
    if (settings.skin.errorBar !== false) drawErrorBar(L, judgeY, this.errHist, now);
    drawPunch(L, judgeY, this.fx, now);
    drawGlints(L, judgeY, this.fx, now);

    // 진행 바
    const p0 = this.startT, p1 = this.practice ? this.practice.end : (this.song.duration || this.lastEnd || 1);
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    ctx.fillRect(x0, 0, fieldW, 4);
    ctx.fillStyle = this.practice ? C_GOLD : C_BLUE;
    ctx.fillRect(x0, 0, fieldW * clamp((gt - p0) / (p1 - p0 || 1), 0, 1), 4);

    // 피버 게이지 (오른쪽 레일) — FEVER 글자는 노트 뒤에 그렸음
    const gh = judgeY - 20;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(x0 + fieldW + 2, 10, 6, gh);
    const ratio = inFever ? clamp((fv.until - gt) / FEVER_SEC, 0, 1) : fv.gauge / 100;
    const gg = ctx.createLinearGradient(0, judgeY, 0, 10);
    gg.addColorStop(0, inFever ? '#ff7a3d' : C_BLUE); gg.addColorStop(1, inFever ? C_GOLD : C_CYAN);
    ctx.fillStyle = gg;
    ctx.fillRect(x0 + fieldW + 2, 10 + gh * (1 - ratio), 6, gh * ratio);
    if (this.practice) {
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.font = `800 11px ${UI_FONT}`;
      ctx.fillStyle = C_GOLD;
      ctx.fillText(this.hl ? 'HIGHLIGHT' : `PRACTICE x${this.rate}${this.practice.loop ? ' · LOOP' : ''}`, x0 + 6, 10);
    }

    // 점수 / 정확도: 글자 폭을 재서 기어 옆에 다 들어가면 바깥, 아니면 기어 안 오른쪽 위 (잘리지 않게)
    ctx.textBaseline = 'top';
    const scoreTxt = String(this.score()).padStart(7, '0');
    numFont(ctx, 800, 30, false);
    const w30 = ctx.measureText('0000000').width;          // 30px일 때 폭 → 자리에 맞게 글자 크기를 정함
    const spaceR = w - (x0 + fieldW) - 18 - 8, spaceL = x0 - 18 - 8;
    const fitR = Math.min(30, Math.floor(30 * spaceR / w30)), fitL = Math.min(30, Math.floor(30 * spaceL / w30));
    const roomR = fitR >= 20, roomL = !roomR && fitL >= 20;
    const outside = roomR || roomL;
    const sfs = roomR ? fitR : roomL ? fitL : 20;
    ctx.textAlign = roomR ? 'left' : 'right';
    const sx = roomR ? x0 + fieldW + 18 : roomL ? x0 - 18 : x0 + fieldW - 10;
    // 기어 옆 빈칸이 있으면 판정 글자와 같은 높이에 (노트를 가리지 않게), 없으면 기어 안 오른쪽 위
    const sy = outside ? (settings.skin.judgePos === 'top' ? 4 : Math.max(4, judgePopY(L, judgeY) - sfs * 0.55)) : 8;
    numFont(ctx, 800, sfs, false);
    ctx.lineWidth = 4; ctx.lineJoin = 'round'; ctx.strokeStyle = 'rgba(3,6,16,0.55)';
    ctx.strokeText(scoreTxt, sx, sy);
    ctx.fillStyle = '#fff';
    ctx.fillText(scoreTxt, sx, sy);
    numFont(ctx, 700, outside ? Math.max(13, sfs * 0.55) : 13, false);
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fillText(this.acc().toFixed(2) + '%', sx, outside ? sy + 4 + sfs : 30);
    plainFont(ctx);
    if (this.ghost && settings.ghost !== false && this.phase !== 'loading' && this.phase !== 'ready') this.drawGhost(ctx, sx, outside ? sy + 60 : 50, outside, roomR || !outside);

    const cx = x0 + fieldW / 2;
    if (this.stage) this.stage.draw({ beat: Math.max(0, Math.floor((gt - off) / bl)), fever: inFever && settings.skin.fever, label: settings.nick || '', cxr: this.ilOn ? 0.3 : 0.5 });
    this.drawFullCombo(L, now);
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
      if (msg.length <= 2) numFont(ctx, 900, 96); else ctx.font = '700 20px "Noto Sans KR", sans-serif';
      ctx.fillStyle = '#fff';
      ctx.fillText(msg, cx, h * 0.45);
      plainFont(ctx);
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
