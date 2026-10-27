/* 링크비트 플레이 화면 */
'use strict';

const JUDGE = { perfect: 0.055, great: 0.09, good: 0.14, bad: 0.18 };
const EARLIEST_NOTE = 0.15;
const LEAD_GAP = 0.8;      // 세 번째 '딱'(노래 시작) 뒤 이만큼(초) 지나서 첫 노트가 화면 맨 위에 들어오게   // 곡 처음부터 할 때 이보다 앞(또는 음수 시간)의 노트는 빼요   // PERFECT ±55ms (예전 ±45ms에서 조금 넓힘)
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
  drawRails(ctx, x0, fieldW, h);
  ctx.fillStyle = 'rgba(80,140,255,0.5)';
  ctx.fillRect(x0 - 1, 0, 1, h);
  ctx.fillRect(x0 + fieldW, 0, 1, h);
}

/* 기어 테두리 (꾸미기·상점): 금속(기본) · 투명 · 나무 · 네온 · 크롬 · 황금 */
const RAIL_STOPS = { metal: ['#2a3148', '#9aa6c4', '#d6dcef', '#2a3148'], wood: ['#3b2412', '#8a5a2e', '#c08a52', '#3b2412'],
  chrome: ['#4b5160', '#e8edf8', '#ffffff', '#4b5160'], gold: ['#5a3d06', '#d9a520', '#fff1a8', '#5a3d06'],
  halloween: ['#26093a', '#ff7a1a', '#ffc36b', '#26093a'] };
function drawRails(ctx, x0, fieldW, h) {
  const st = settings.skin.gear || 'metal';
  if (st === 'clear') {
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    ctx.fillRect(x0 - 2, 0, 1, h); ctx.fillRect(x0 + fieldW + 1, 0, 1, h);
    return;
  }
  const now = performance.now();
  for (const rx of [x0 - 9, x0 + fieldW + 1]) {
    if (st === 'neon') {
      ctx.fillStyle = 'rgba(77,225,255,0.12)';
      ctx.fillRect(rx, 0, 8, h);
      ctx.save();
      ctx.shadowColor = '#4de1ff'; ctx.shadowBlur = 14;
      ctx.fillStyle = `rgba(150,240,255,${(0.75 + 0.25 * Math.sin(now / 260)).toFixed(3)})`;
      ctx.fillRect(rx + 3, 0, 2, h);
      ctx.restore();
      continue;
    }
    const c = RAIL_STOPS[st] || RAIL_STOPS.metal;
    const g = ctx.createLinearGradient(rx, 0, rx + 8, 0);
    g.addColorStop(0, c[0]); g.addColorStop(0.45, c[1]); g.addColorStop(0.55, c[2]); g.addColorStop(1, c[3]);
    ctx.fillStyle = g;
    ctx.fillRect(rx, 0, 8, h);
    if (st === 'wood') {          // 나뭇결
      ctx.fillStyle = 'rgba(40,20,5,0.35)';
      for (let y = (rx * 7) % 19; y < h; y += 19) ctx.fillRect(rx + 1 + ((y * 3) % 3), y, 5, 1);
    } else if (st === 'halloween') {    // 보라빛이 숨 쉬듯 + 작은 호박이 천천히 내려옴
      ctx.fillStyle = `rgba(176,107,255,${(0.18 + 0.12 * Math.sin(now / 420)).toFixed(3)})`;
      ctx.fillRect(rx, 0, 8, h);
      for (let y = ((now / 40 + (rx > x0 ? 90 : 0)) % 180) - 20; y < h; y += 180) drawPumpkin(ctx, rx + 4, y, 5);
    } else if (st === 'gold' || st === 'chrome') {    // 위에서 아래로 흐르는 광택
      const sy = ((now / 5 + (rx > x0 ? 140 : 0)) % (h + 240)) - 120;
      const sg = ctx.createLinearGradient(0, sy - 70, 0, sy + 70);
      sg.addColorStop(0, 'rgba(255,255,255,0)'); sg.addColorStop(0.5, 'rgba(255,255,255,0.6)'); sg.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = sg;
      ctx.fillRect(rx, sy - 70, 8, 140);
    }
  }
}
/* 흐르는 무지개 (판정선·콤보 꾸미기) */
function hslHex(h, s, l) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = (n) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1))))).toString(16).padStart(2, '0');
  return `#${f(0)}${f(8)}${f(4)}`;
}
function rainbowAt(now, off = 0) { return hslHex(((now / 9 + off) % 360 + 360) % 360, 95, 62); }
function rainbowGrad(ctx, x, w, now) {
  const g = ctx.createLinearGradient(x, 0, x + w, 0);
  for (let i = 0; i <= 6; i++) g.addColorStop(i / 6, rainbowAt(now, -i * 50));
  return g;
}
/* 노트 모양 꾸미기: 별 · 하트 · 보석 */
function starPath(ctx, cx, cy, ro, ri, n = 5) {
  for (let i = 0; i < n * 2; i++) {
    const r = i % 2 ? ri : ro, a = -Math.PI / 2 + (i * Math.PI) / n;
    const px = cx + Math.cos(a) * r, py = cy + Math.sin(a) * r;
    if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
  }
  ctx.closePath();
}
function heartPath(ctx, cx, cy, r) {
  const top = cy - r * 0.45;
  ctx.moveTo(cx, cy + r * 0.9);
  ctx.bezierCurveTo(cx - r * 1.35, cy + r * 0.05, cx - r * 0.95, top - r * 0.75, cx, top);
  ctx.bezierCurveTo(cx + r * 0.95, top - r * 0.75, cx + r * 1.35, cy + r * 0.05, cx, cy + r * 0.9);
  ctx.closePath();
}
/* 한 번 그려 둔 그림을 다시 씀 (빛 번짐·그라데이션을 매 프레임 그리면 GPU에서 무거워서 끊김) */
const SPRITES = new Map();
function spriteOf(key, w, h, paint) {
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  const k = `${key}|${dpr}`;
  let sp = SPRITES.get(k);
  if (!sp) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.ceil(w * dpr)); c.height = Math.max(1, Math.ceil(h * dpr));
    const x = c.getContext('2d');
    x.scale(dpr, dpr);
    paint(x, w, h);
    sp = { c, w, h };
    SPRITES.set(k, sp);
    if (SPRITES.size > 600) SPRITES.delete(SPRITES.keys().next().value);
  }
  return sp;
}
function drawSprite(ctx, sp, cx, cy, sc = 1) {
  ctx.drawImage(sp.c, cx - sp.w * sc / 2, cy - sp.h * sc / 2, sp.w * sc, sp.h * sc);
}
/* 호박: 둥근 몸통 세 쪽 + 꼭지 — face면 잭오랜턴 얼굴(이벤트 호박 노트) · 크기·모양마다 한 번만 그려 두고 재사용 */
function drawPumpkin(ctx, cx, cy, r, opts = {}) {
  const rr = Math.max(2, Math.round(r * 2) / 2);
  const { rim = null, face = false, dead = false, glow = 0 } = opts;
  const pad = glow + 6, size = rr * 2.4 + pad * 2;
  const sp = spriteOf(`pk|${rr}|${rim}|${face}|${dead}|${glow}`, size, size, (x, w, h) => paintPumpkin(x, w / 2, h / 2 + rr * 0.1, rr, opts));
  drawSprite(ctx, sp, cx, cy - rr * 0.1, r / rr);
}
function paintPumpkin(ctx, cx, cy, r, { rim = null, face = false, dead = false, glow = 0 } = {}) {
  ctx.save();
  const body = dead ? ['#7a7f92', '#4a5066', '#2e3244'] : ['#ffd08a', '#ff8a1e', '#b8460a'];
  if (glow) { ctx.shadowColor = '#ff8a1e'; ctx.shadowBlur = glow; }
  for (const [ox, sc] of [[-0.42, 0.62], [0.42, 0.62], [0, 0.72]]) {   // 양옆 쪽 → 가운데 쪽 (가운데가 앞)
    const g = ctx.createRadialGradient(cx + ox * r - r * 0.15, cy - r * 0.35, r * 0.1, cx + ox * r, cy, r * 0.95);
    g.addColorStop(0, body[0]); g.addColorStop(0.5, body[1]); g.addColorStop(1, body[2]);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.ellipse(cx + ox * r, cy, r * sc, r * 0.82, 0, 0, Math.PI * 2); ctx.fill();
  }
  ctx.shadowBlur = 0;
  if (rim && !dead) {               // 줄 색 테두리 (어느 줄 노트인지 알아보게)
    ctx.strokeStyle = rim; ctx.lineWidth = 2; ctx.shadowColor = rim; ctx.shadowBlur = 8;
    ctx.beginPath(); ctx.ellipse(cx, cy, r * 1.08, r * 0.86, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.shadowBlur = 0;
  }
  ctx.strokeStyle = dead ? 'rgba(20,22,32,0.5)' : 'rgba(120,40,0,0.45)'; ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.moveTo(cx - r * 0.2, cy - r * 0.7); ctx.quadraticCurveTo(cx - r * 0.32, cy, cx - r * 0.2, cy + r * 0.7);
  ctx.moveTo(cx + r * 0.2, cy - r * 0.7); ctx.quadraticCurveTo(cx + r * 0.32, cy, cx + r * 0.2, cy + r * 0.7); ctx.stroke();
  ctx.fillStyle = dead ? '#3b4052' : '#3f8a2a';           // 꼭지
  ctx.beginPath(); ctx.moveTo(cx - r * 0.1, cy - r * 0.72); ctx.lineTo(cx + r * 0.12, cy - r * 0.72); ctx.lineTo(cx + r * 0.2, cy - r * 1.08); ctx.lineTo(cx + r * 0.02, cy - r * 1.05); ctx.closePath(); ctx.fill();
  if (face && !dead) {              // 눈·입에서 불빛
    ctx.fillStyle = 'rgba(255,230,120,1)';
    ctx.shadowColor = '#ffe27a'; ctx.shadowBlur = 8;
    for (const sx of [-1, 1]) { ctx.beginPath(); ctx.moveTo(cx + sx * r * 0.42, cy - r * 0.12); ctx.lineTo(cx + sx * r * 0.18, cy - r * 0.12); ctx.lineTo(cx + sx * r * 0.3, cy - r * 0.42); ctx.closePath(); ctx.fill(); }
    ctx.beginPath(); ctx.moveTo(cx - r * 0.48, cy + r * 0.12);
    for (let i = 0; i <= 6; i++) ctx.lineTo(cx - r * 0.48 + i * r * 0.16, cy + r * (i % 2 ? 0.26 : 0.18));
    ctx.quadraticCurveTo(cx, cy + r * 0.62, cx - r * 0.48, cy + r * 0.12); ctx.fill();
  }
  ctx.restore();
}
/* 이벤트 호박 노트: 치면 🍬 +1 (점수와는 상관없음) */
function drawPumpkinNote(L, lane, yHead, now) {
  const { ctx, laneW, x0, colors } = L;
  const cx = x0 + lane * laneW + laneW / 2;
  const r = Math.min((laneW - 4) * 0.36, settings.skin.noteH * 0.9 + 8);
  const bob = Math.sin(now / 160 + lane) * 1.2;
  const pulse = 0.6 + 0.4 * Math.sin(now / 140 + lane);
  const rr = Math.max(2, Math.round(r));
  const halo = spriteOf(`halo|${rr}`, rr * 4.4, rr * 4.4, (x, w, h) => {
    const hg = x.createRadialGradient(w / 2, h / 2, rr * 0.4, w / 2, h / 2, rr * 2.1);
    hg.addColorStop(0, 'rgba(255,211,107,0.55)'); hg.addColorStop(1, 'rgba(255,140,30,0)');
    x.fillStyle = hg; x.fillRect(0, 0, w, h);
  });
  const a0 = ctx.globalAlpha;
  ctx.globalAlpha = a0 * pulse;
  drawSprite(ctx, halo, cx, yHead + bob, r / rr);
  ctx.globalAlpha = a0;
  drawPumpkin(ctx, cx, yHead + bob, r * 1.08, { rim: colors[lane], face: true, glow: 16 });
  for (let i = 0; i < 3; i++) {          // 둘레를 도는 반짝이
    const a = now / 260 + i * 2.094;
    ctx.fillStyle = i ? '#fff3b0' : '#ff9de0';
    ctx.beginPath(); starPath(ctx, cx + Math.cos(a) * r * 1.55, yHead + bob + Math.sin(a) * r * 1.1, 3, 1.1, 4); ctx.fill();
  }
}
function gemPath(ctx, cx, cy, r) {
  ctx.moveTo(cx - r * 0.62, cy - r * 0.6); ctx.lineTo(cx + r * 0.62, cy - r * 0.6); ctx.lineTo(cx + r * 1.05, cy - r * 0.12);
  ctx.lineTo(cx, cy + r * 0.88); ctx.lineTo(cx - r * 1.05, cy - r * 0.12); ctx.closePath();
}

/* ---------------- 세련된 원형 노트 (진주 · 글라스 오브 · 보석 컷 · 메탈 버튼 · 도트 링 · 헤일로 링 · 네온 튜브 링 · 세그먼트 링): 한 번 그려 둔 그림을 다시 씀 */
const ROUND_NOTES = new Set(['pearl', 'orb', 'brilliant', 'bezel', 'dotring', 'halo', 'tube', 'segring']);
function hexRgb(hex) { const n = parseInt(hex.slice(1, 7), 16); return [n >> 16, (n >> 8) & 255, n & 255]; }
function mixHex(hex, to, t) {          // hex 색을 to(#fff·#000 등) 쪽으로 t만큼
  const a = hexRgb(hex), b = hexRgb(to);
  return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(',')})`;
}
function rgba(hex, a) { const [r, g, b] = hexRgb(hex); return `rgba(${r},${g},${b},${a})`; }
function paintRoundNote(c, st, col, r, m, dead) {
  const cx = m + r, cy = m + r, TAU = Math.PI * 2;
  const C = dead ? '#5a6078' : col;
  const disc = (rr) => { c.beginPath(); c.arc(cx, cy, rr, 0, TAU); };
  const glow = (a, k) => { if (!dead) { c.shadowColor = rgba(col, a); c.shadowBlur = r * k; } };
  if (st === 'pearl') {                  // 진주: 매끈한 구슬 + 부드러운 반사광
    glow(0.55, 0.6);
    const g = c.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.05, cx, cy, r);
    g.addColorStop(0, dead ? '#9aa0b4' : '#ffffff'); g.addColorStop(0.28, mixHex(C, '#ffffff', 0.5)); g.addColorStop(0.72, C); g.addColorStop(1, mixHex(C, '#000000', 0.5));
    c.fillStyle = g; disc(r); c.fill();
    c.shadowBlur = 0;
    c.save(); disc(r); c.clip();                         // 아래쪽 은은한 되비침
    const b = c.createRadialGradient(cx + r * 0.15, cy + r * 0.7, 0, cx + r * 0.15, cy + r * 0.7, r * 0.55);
    b.addColorStop(0, `rgba(255,255,255,${dead ? 0.08 : 0.38})`); b.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = b; c.fillRect(cx - r, cy - r, r * 2, r * 2);
    c.restore();
    const hx = cx - r * 0.32, hy = cy - r * 0.4;          // 반짝 하이라이트
    const s = c.createRadialGradient(hx, hy, 0, hx, hy, r * 0.36);
    s.addColorStop(0, `rgba(255,255,255,${dead ? 0.35 : 0.95})`); s.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = s; c.beginPath(); c.ellipse(hx, hy, r * 0.36, r * 0.24, -0.6, 0, TAU); c.fill();
    c.strokeStyle = 'rgba(255,255,255,0.4)'; c.lineWidth = 1; disc(r - 0.5); c.stroke();
  } else if (st === 'orb') {             // 글라스 오브: 투명한 유리구슬 속에서 색이 빛남
    glow(0.7, 0.7);
    c.fillStyle = rgba(C, dead ? 0.12 : 0.22); disc(r); c.fill();
    c.shadowBlur = 0;
    const k = c.createRadialGradient(cx, cy + r * 0.08, 0, cx, cy + r * 0.08, r * 0.8);
    k.addColorStop(0, dead ? rgba(C, 0.45) : '#ffffff'); k.addColorStop(0.28, rgba(C, dead ? 0.4 : 1)); k.addColorStop(1, rgba(C, 0));
    c.fillStyle = k; disc(r); c.fill();
    c.save(); disc(r - 1); c.clip();                     // 위쪽 유리 반사
    const t = c.createLinearGradient(0, cy - r, 0, cy - r * 0.1);
    t.addColorStop(0, `rgba(255,255,255,${dead ? 0.2 : 0.62})`); t.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = t; c.beginPath(); c.ellipse(cx, cy - r * 0.48, r * 0.7, r * 0.42, 0, 0, TAU); c.fill();
    c.restore();
    c.lineWidth = 1.5; c.strokeStyle = dead ? '#6a7088' : mixHex(col, '#ffffff', 0.45); disc(r - 0.75); c.stroke();
    c.strokeStyle = 'rgba(255,255,255,0.35)'; c.lineWidth = 1;     // 아래 테두리 빛
    c.beginPath(); c.arc(cx, cy, r * 0.8, Math.PI * 0.22, Math.PI * 0.78); c.stroke();
  } else if (st === 'brilliant') {       // 보석 컷: 위에서 본 원형 보석 (면마다 밝기가 달라 반짝임)
    glow(0.6, 0.6);
    c.fillStyle = C; disc(r); c.fill();
    c.shadowBlur = 0;
    c.save(); disc(r); c.clip();
    const N = 16;
    for (let i = 0; i < N; i++) {
      const a0 = i / N * TAU - Math.PI / 2, a1 = (i + 1) / N * TAU - Math.PI / 2, am = (a0 + a1) / 2;
      const t = (i % 2 ? 0.14 : 0) + (Math.cos(am + 2.2) + 1) / 2 * 0.6;     // 왼쪽 위에서 빛
      c.fillStyle = t > 0.36 ? mixHex(C, '#ffffff', Math.min(0.85, (t - 0.36) * 1.5)) : mixHex(C, '#000000', (0.36 - t) * 1.1);
      c.beginPath(); c.moveTo(cx, cy); c.arc(cx, cy, r + 1, a0, a1); c.closePath(); c.fill();
    }
    const T = r * 0.5, oct = [];                          // 가운데 판판한 면 (팔각)
    for (let i = 0; i < 8; i++) { const a = i / 8 * TAU + Math.PI / 8; oct.push([cx + Math.cos(a) * T, cy + Math.sin(a) * T, a]); }
    c.strokeStyle = 'rgba(255,255,255,0.22)'; c.lineWidth = 1;
    c.beginPath(); for (const [px, py, a] of oct) { c.moveTo(px, py); c.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); } c.stroke();
    const tg = c.createLinearGradient(cx - T, cy - T, cx + T, cy + T);
    tg.addColorStop(0, mixHex(C, '#ffffff', dead ? 0.25 : 0.62)); tg.addColorStop(1, mixHex(C, '#ffffff', 0.08));
    c.fillStyle = tg; c.beginPath(); oct.forEach(([px, py], i) => (i ? c.lineTo(px, py) : c.moveTo(px, py))); c.closePath(); c.fill();
    c.strokeStyle = 'rgba(255,255,255,0.55)'; c.stroke();
    c.restore();
    c.lineWidth = 1.5; c.strokeStyle = dead ? '#7a8098' : 'rgba(255,255,255,0.8)'; disc(r - 0.75); c.stroke();
    if (!dead) { c.fillStyle = '#ffffff'; c.beginPath(); starPath(c, cx - r * 0.3, cy - r * 0.32, r * 0.34, r * 0.08, 4); c.fill(); }
  } else if (st === 'bezel') {           // 메탈 버튼: 은색 금속 테두리 + 볼록한 색 버튼
    glow(0.45, 0.5);
    const sv = dead ? ['#7d8396', '#4c5164', '#6f7588', '#454a5c'] : ['#f6f8ff', '#8a93a8', '#e3e8f5', '#6b7489'];
    let ring;
    if (c.createConicGradient) {
      ring = c.createConicGradient(-Math.PI / 4, cx, cy);
      for (let i = 0; i <= 8; i++) ring.addColorStop(i / 8, sv[i % 4]);
    } else {
      ring = c.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
      ring.addColorStop(0, sv[0]); ring.addColorStop(0.5, sv[1]); ring.addColorStop(1, sv[2]);
    }
    c.fillStyle = ring; disc(r); c.fill();
    c.shadowBlur = 0;
    c.fillStyle = '#161a25'; disc(r * 0.76); c.fill();     // 홈
    const d = c.createRadialGradient(cx - r * 0.2, cy - r * 0.25, r * 0.05, cx, cy, r * 0.68);
    d.addColorStop(0, mixHex(C, '#ffffff', dead ? 0.2 : 0.62)); d.addColorStop(0.5, C); d.addColorStop(1, mixHex(C, '#000000', 0.42));
    c.fillStyle = d; disc(r * 0.67); c.fill();
    const h = c.createLinearGradient(0, cy - r * 0.6, 0, cy - r * 0.05);    // 버튼 윗면 반사
    h.addColorStop(0, `rgba(255,255,255,${dead ? 0.2 : 0.6})`); h.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = h; c.beginPath(); c.ellipse(cx, cy - r * 0.3, r * 0.44, r * 0.26, 0, 0, TAU); c.fill();
    c.strokeStyle = 'rgba(0,0,0,0.35)'; c.lineWidth = 1; disc(r - 0.5); c.stroke();
  } else if (st === 'dotring') {         // 도트 링: 얇은 링 + 꽉 찬 점 (깔끔한 플랫)
    const lw = Math.max(1.6, r * 0.11);
    glow(0.8, 0.55);
    c.lineWidth = lw; c.strokeStyle = rgba(C, dead ? 0.55 : 0.95); disc(r - lw / 2); c.stroke();
    c.shadowBlur = 0;
    const g = c.createLinearGradient(0, cy - r * 0.58, 0, cy + r * 0.58);
    g.addColorStop(0, mixHex(C, '#ffffff', dead ? 0.1 : 0.35)); g.addColorStop(1, C);
    glow(0.6, 0.35);
    c.fillStyle = g; disc(r * 0.58); c.fill();
    c.shadowBlur = 0;
  } else if (st === 'halo') {            // 헤일로 링: 빛나는 링 + 바깥 가는 테 + 가운데 하얀 점
    c.lineWidth = 1.2; c.strokeStyle = rgba(C, dead ? 0.3 : 0.55); disc(r - 0.6); c.stroke();
    const lw = Math.max(3.5, r * 0.28), rr = r * 0.74;
    glow(0.9, 0.6);
    c.lineWidth = lw; c.strokeStyle = C; disc(rr); c.stroke();
    c.shadowBlur = 0;
    c.lineWidth = Math.max(1, lw * 0.3); c.strokeStyle = dead ? 'rgba(255,255,255,0.15)' : mixHex(col, '#ffffff', 0.7); disc(rr); c.stroke();
    if (!dead) { c.shadowColor = '#ffffff'; c.shadowBlur = r * 0.3; }
    c.fillStyle = dead ? '#6a7088' : '#ffffff'; disc(Math.max(1.6, r * 0.17)); c.fill();
    c.shadowBlur = 0;
  } else if (st === 'tube') {            // 네온 튜브 링: 둥근 유리관처럼 입체감 있는 링 (속은 비어 있음)
    const rr = r * 0.74, lw = Math.max(4, r * 0.36);
    glow(0.85, 0.65);
    c.lineWidth = lw; c.strokeStyle = mixHex(C, '#000000', 0.15); disc(rr); c.stroke();
    c.shadowBlur = 0;
    c.lineWidth = lw * 0.55; c.strokeStyle = mixHex(C, '#ffffff', dead ? 0.1 : 0.35); disc(rr); c.stroke();
    c.lineWidth = Math.max(1, lw * 0.18); c.strokeStyle = dead ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.9)'; c.lineCap = 'round';
    c.beginPath(); c.arc(cx, cy, rr - lw * 0.12, Math.PI * 1.08, Math.PI * 1.5); c.stroke();
    c.lineWidth = Math.max(1, lw * 0.12); c.strokeStyle = dead ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.45)';
    c.beginPath(); c.arc(cx, cy, rr + lw * 0.1, Math.PI * 0.15, Math.PI * 0.4); c.stroke();
    c.lineCap = 'butt';
  } else if (st === 'segring') {         // 세그먼트 링: 네 조각으로 나뉜 링 (계기판 느낌) + 가는 안쪽 링 + 가운데 점
    const lw = Math.max(2.5, r * 0.2), rr = r - lw / 2 - 0.5, gap = 0.2;
    glow(0.85, 0.55);
    c.lineWidth = lw; c.strokeStyle = C; c.lineCap = 'round';
    for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 - Math.PI / 4; c.beginPath(); c.arc(cx, cy, rr, a + gap, a + Math.PI / 2 - gap); c.stroke(); }
    c.lineCap = 'butt'; c.shadowBlur = 0;
    c.lineWidth = 1; c.strokeStyle = rgba(C, dead ? 0.3 : 0.6); disc(r * 0.5); c.stroke();
    glow(0.8, 0.3);
    c.fillStyle = dead ? '#6a7088' : mixHex(col, '#ffffff', 0.75); disc(Math.max(1.6, r * 0.2)); c.fill();
    c.shadowBlur = 0;
  }
}
function drawRoundNote(L, lane, yHead, yTail, state, st) {
  const { ctx, laneW, x0, colors } = L;
  const nw = laneW - 4, cx = x0 + lane * laneW + 2 + nw / 2;
  const r = Math.round(Math.min(nw * 0.42, settings.skin.noteH * 0.9 + 4) * 2) / 2;
  const col = colors[lane], dead = state === 'dead';
  const spr = (rr) => { const m = Math.ceil(rr * 0.8) + 4; return spriteOf(`rn|${st}|${col}|${rr}|${dead}`, rr * 2 + m * 2, rr * 2 + m * 2, (c) => paintRoundNote(c, st, col, rr, m, dead)); };
  if (yTail !== null && yTail < yHead) {   // 긴 노트: 머리 원과 거의 같은 폭의 굵은 몸통 + 끝에도 같은 폭의 원 (알약 모양)
    const bw = Math.max(8, Math.round(r * 1.84));
    const body = spriteOf(`rnb|${st}|${col}|${bw}|${dead}|${state === 'hold'}`, bw, 8, (c, w) => {
      const a = dead ? 0.35 : state === 'hold' ? 0.95 : 0.78, K = dead ? '#5a6078' : col;
      const g = c.createLinearGradient(0, 0, w, 0);
      g.addColorStop(0, rgba(K, a * 0.45)); g.addColorStop(0.5, rgba(K, st === 'orb' ? a * 0.75 : a)); g.addColorStop(1, rgba(K, a * 0.45));
      c.fillStyle = g; c.fillRect(0, 0, w, 8);
      c.fillStyle = dead ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.5)';      // 양쪽 테두리
      c.fillRect(0, 0, 1.2, 8); c.fillRect(w - 1.2, 0, 1.2, 8);
      c.fillStyle = dead ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.55)'; c.fillRect(w / 2 - 1, 0, 2, 8);   // 가운데 빛줄
    });
    ctx.drawImage(body.c, cx - bw / 2, yTail, bw, yHead - yTail);
    drawSprite(ctx, spr(Math.max(4, Math.round(r * 1.84) / 2)), cx, yTail);
  }
  const sp = spr(r);
  drawSprite(ctx, sp, cx, yHead);
  if (state === 'hold') {                // 누르는 중: 살짝 더 밝게
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.35; drawSprite(ctx, sp, cx, yHead); ctx.restore();
  }
}

function drawNote(L, lane, yHead, yTail, state, accent = false) {
  if (accent && state !== 'dead') drawAccentGlow(L, lane, yHead);
  if (ROUND_NOTES.has(settings.skin.note)) { drawRoundNote(L, lane, yHead, yTail, state, settings.skin.note); return; }
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
  } else if (sk.note === 'star' || sk.note === 'heart' || sk.note === 'gem') {
    const dead = state === 'dead';
    const r = Math.min(nw * 0.42, nh * 0.9 + 7);
    const cx = x + nw / 2;
    ctx.beginPath();
    if (sk.note === 'star') starPath(ctx, cx, yHead, r * 1.12, r * 0.5);
    else if (sk.note === 'heart') heartPath(ctx, cx, yHead, r);
    else gemPath(ctx, cx, yHead, r);
    const sg = ctx.createLinearGradient(0, yHead - r, 0, yHead + r);
    sg.addColorStop(0, dead ? '#6a7088' : '#ffffff'); sg.addColorStop(0.45, col); sg.addColorStop(1, dead ? '#30354a' : shade(col));
    ctx.fillStyle = sg;
    ctx.shadowColor = col;
    ctx.shadowBlur = dead ? 0 : 9;
    ctx.fill();
    ctx.shadowBlur = 0;
    if (!dead) {
      ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 1.5; ctx.stroke();
      if (sk.note === 'gem') {        // 보석 면
        ctx.beginPath();
        ctx.moveTo(cx - r * 1.05, yHead - r * 0.12); ctx.lineTo(cx + r * 1.05, yHead - r * 0.12);
        ctx.moveTo(cx - r * 0.3, yHead - r * 0.6); ctx.lineTo(cx - r * 0.45, yHead - r * 0.12); ctx.lineTo(cx, yHead + r * 0.88);
        ctx.moveTo(cx + r * 0.3, yHead - r * 0.6); ctx.lineTo(cx + r * 0.45, yHead - r * 0.12); ctx.lineTo(cx, yHead + r * 0.88);
        ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.lineWidth = 1; ctx.stroke();
        const tw = 0.5 + 0.5 * Math.sin(performance.now() / 180 + lane);      // 반짝
        ctx.fillStyle = `rgba(255,255,255,${(0.35 + 0.5 * tw).toFixed(3)})`;
        ctx.beginPath(); starPath(ctx, cx - r * 0.4, yHead - r * 0.32, r * 0.28, r * 0.08, 4); ctx.fill();
      }
    }
    return;
  } else if (sk.note === 'pumpkin') {
    const r = Math.min(nw * 0.4, nh * 0.9 + 6);
    drawPumpkin(ctx, x + nw / 2, yHead, r, { rim: col, dead: state === 'dead' });
    return;
  } else if (sk.note === 'neon') {
    // 네온 테두리 막대 (속은 은은하게)
    const dead = state === 'dead';
    roundRect(ctx, x + 2, yHead - nh / 2 + 1, nw - 4, nh - 2, Math.min(6, nh / 2));
    ctx.fillStyle = col + (dead ? '18' : '30');
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = dead ? '#4a5066' : col;
    ctx.shadowColor = col;
    ctx.shadowBlur = dead ? 0 : 14;
    ctx.stroke();
    ctx.shadowBlur = 0;
    if (!dead) { ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.fillRect(x + 6, yHead - 1, nw - 12, 2); }
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
  return ['circle', 'hollow', 'diamond', 'star', 'heart', 'gem', 'pumpkin'].includes(sk.note) || ROUND_NOTES.has(sk.note) ? 'ring' : 'bar';
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
  const rb = settings.skin.line === 'rainbow';
  const lc = rb ? rainbowAt(now) : (LINE_COLORS[settings.skin.line] || C_RED);
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
    if (settings.skin.line === 'ghost') drawGhostWisps(ctx, x0, fieldW, judgeY, now);
    ctx.fillStyle = rb ? rainbowGrad(ctx, x0, fieldW, now) : lc;
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

/* ============================================================ 풀콤보 연출 (플레이·꾸미기 미리보기·상점이 같이 씀)
   basic: 빛 고리·반짝이 · fireworks: 불꽃놀이 · stars: 별가루 폭죽 · hero: 내 캐릭터 승리 · bats: 박쥐 떼(할로윈) */
const FC_DUR = { basic: 2000, fireworks: 2700, stars: 2500, hero: 2700, bats: 2700 };
const fcDur = (st) => FC_DUR[st] || FC_DUR.basic;
function fcRand(i, k = 1) { const x = Math.sin(i * 127.1 + k * 311.7) * 43758.5453; return x - Math.floor(x); }   // 매 프레임 같은 값 (시드 고정)
function drawFcLabel(ctx, cx, cy, e, now, ap, combo, fieldW, style) {
  const pop = Math.min(1, e / 0.08);
  const out = e > 0.8 ? (1 - e) / 0.2 : 1;
  ctx.save();
  ctx.globalAlpha = Math.max(0, out);
  ctx.translate(cx, cy);
  ctx.transform(1, 0, -0.18, 1, 0, 0);
  const sc = (2.1 - 1.1 * pop) * (fieldW < 300 ? 0.75 : 1);
  ctx.scale(sc, sc);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = `900 30px ${UI_FONT}`;
  const label = ap ? 'ALL PERFECT!' : 'FULL COMBO!';
  if (style === 'bats') {
    const g = ctx.createLinearGradient(-110, 0, 110, 0);
    g.addColorStop(0, '#ffb347'); g.addColorStop(0.5, '#ff7a1a'); g.addColorStop(1, '#c58bff');
    ctx.fillStyle = g; ctx.shadowColor = '#8a2be2';
  } else if (ap) {
    const g = ctx.createLinearGradient(-110, 0, 110, 0);
    const sh = (now / 600) % 1;
    g.addColorStop(0, '#ff9de0'); g.addColorStop(clamp(0.35 + sh * 0.3, 0, 1), '#fff3b0'); g.addColorStop(1, '#9ff6ff');
    ctx.fillStyle = g; ctx.shadowColor = C_GOLD;
  } else { ctx.fillStyle = '#ffffff'; ctx.shadowColor = C_CYAN; }
  ctx.shadowBlur = 22;
  ctx.fillText(label, 0, 0);
  ctx.shadowBlur = 0;
  ctx.font = `700 11px ${UI_FONT}`;
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fillText(ap ? `${combo} PERFECT` : `${combo} COMBO`, 0, 28);
  ctx.restore();
}
function drawFcFx(L, style, ap, at, now, combo, avatar = settings.avatar) {
  if (!FC_DUR[style]) style = 'basic';
  const e = (now - at) / fcDur(style);
  if (e < 0 || e >= 1) return;
  const { ctx, h, x0, fieldW } = L;
  const cx = x0 + fieldW / 2, cy = h * 0.4;
  ctx.save();
  ctx.beginPath(); ctx.rect(x0 - 40, 0, fieldW + 80, h); ctx.clip();
  const ms = now - at;
  if (style === 'basic') {
    ctx.fillStyle = ap ? `rgba(255,240,200,${(0.22 * (1 - e)).toFixed(3)})` : `rgba(120,200,255,${(0.16 * (1 - e)).toFixed(3)})`;
    ctx.fillRect(x0, 0, fieldW, h);
    for (const [d, w] of [[0, 4], [0.12, 2]]) {        // 퍼지는 고리 두 개
      const k = clamp((e - d) / 0.5, 0, 1);
      if (k <= 0 || k >= 1) continue;
      ctx.globalAlpha = 1 - k;
      ctx.strokeStyle = ap ? C_GOLD : C_CYAN;
      ctx.lineWidth = w;
      ctx.beginPath(); ctx.arc(cx, cy, 30 + fieldW * 0.7 * k, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    for (let i = 0; i < 26; i++) {                     // 반짝이
      const a = (i * 2.399) % (Math.PI * 2), sp = 0.55 + ((i * 37) % 11) / 20;
      const r = fieldW * 0.62 * sp * Math.min(1, e * 2.2);
      const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r * 0.8 + 60 * e * e;
      ctx.globalAlpha = Math.max(0, 1 - e * 1.15);
      ctx.fillStyle = ap ? ['#fff3b0', C_GOLD, '#ff9de0', '#9ff6ff'][i % 4] : ['#ffffff', C_CYAN, '#9fc4ff'][i % 3];
      const s2 = 2 + (i % 3);
      ctx.fillRect(x - s2 / 2, y - s2 / 2, s2, s2);
    }
    ctx.globalAlpha = 1;
  } else if (style === 'fireworks') {
    ctx.fillStyle = `rgba(10,8,30,${(0.35 * Math.min(1, e * 6) * (1 - e)).toFixed(3)})`;   // 밤하늘처럼 살짝 어둡게
    ctx.fillRect(x0, 0, fieldW, h);
    ctx.globalCompositeOperation = 'lighter';
    const pal = ap ? [['#fff3b0', '#ffc83d'], ['#ff9de0', '#ff4fd8'], ['#9ff6ff', '#4de1ff']] : [['#ffffff', '#4de1ff'], ['#ffd1f0', '#ff5fa2'], ['#fff6c8', '#ffc83d']];
    for (let b = 0; b < 7; b++) {
      const t0 = b * 260, bt = (ms - t0) / 1300;       // 터진 뒤 지난 비율
      const bx = x0 + fieldW * (0.18 + 0.64 * fcRand(b, 1)), by = h * (0.14 + 0.32 * fcRand(b, 2));
      if (ms < t0) continue;
      if (bt < 0.18) {                                   // 올라가는 꼬리
        const k = (ms - t0) / (1300 * 0.18);
        ctx.fillStyle = '#ffe9b0';
        ctx.globalAlpha = 0.9;
        ctx.fillRect(bx - 1.5, h - (h - by) * k, 3, 14);
        continue;
      }
      const k = (bt - 0.18) / 0.82;
      if (k >= 1) continue;
      const [c1, c2] = pal[b % pal.length];
      const R = fieldW * (0.26 + 0.14 * fcRand(b, 3)) * Math.sqrt(k);
      for (const [ring, n, rr, sz] of [[0, 44, 1, 2.8], [1, 22, 0.55, 2.2]]) {
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2 + fcRand(b, 4 + ring);
          const x = bx + Math.cos(a) * R * rr, y = by + Math.sin(a) * R * rr + 46 * k * k;
          ctx.globalAlpha = Math.max(0, 1 - k) * (0.6 + 0.4 * Math.sin(now / 40 + i));
          ctx.fillStyle = (i + ring) % 3 ? c2 : c1;
          ctx.beginPath(); ctx.arc(x, y, sz * (1 - k * 0.45), 0, Math.PI * 2); ctx.fill();
          if (!ring && k < 0.6) {          // 꼬리
            ctx.globalAlpha *= 0.4;
            ctx.beginPath(); ctx.arc(bx + Math.cos(a) * R * 0.82, by + Math.sin(a) * R * 0.82 + 30 * k * k, sz * 0.6, 0, Math.PI * 2); ctx.fill();
          }
        }
      }
      if (k < 0.15) {                                     // 터지는 순간 번쩍
        ctx.globalAlpha = (0.15 - k) / 0.15 * 0.6;
        const fg = ctx.createRadialGradient(bx, by, 2, bx, by, 60);
        fg.addColorStop(0, c1); fg.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = fg; ctx.fillRect(bx - 60, by - 60, 120, 120);
      }
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  } else if (style === 'stars') {
    ctx.globalCompositeOperation = 'lighter';
    const pal = ['#fff3b0', '#ffc83d', '#ff9de0', '#9ff6ff', '#ffffff'];
    for (let i = 0; i < 14; i++) {                      // 큰 별이 가운데서 터져 나감
      const a = (i / 14) * Math.PI * 2 + 0.3;
      const k = Math.min(1, e * 1.6);
      const r = fieldW * (0.25 + 0.35 * fcRand(i, 5)) * (1 - (1 - k) * (1 - k));
      const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r * 0.85 + 50 * e * e;
      ctx.globalAlpha = Math.max(0, 1 - e * 1.1);
      ctx.fillStyle = pal[i % pal.length];
      ctx.shadowColor = pal[i % pal.length]; ctx.shadowBlur = 12;
      ctx.save(); ctx.translate(x, y); ctx.rotate(now / 300 + i);
      ctx.beginPath(); starPath(ctx, 0, 0, 9 + 5 * fcRand(i, 6), 4, 5); ctx.fill();
      ctx.restore();
    }
    ctx.shadowBlur = 0;
    for (let i = 0; i < 60; i++) {                      // 위에서 내리는 별가루
      const t0 = fcRand(i, 7) * 0.4, k = (e - t0) / (1 - t0);
      if (k <= 0) continue;
      const x = x0 + fieldW * fcRand(i, 8) + Math.sin(now / 200 + i) * 6, y = -10 + (h * 0.9) * k;
      ctx.globalAlpha = Math.max(0, 1 - k) * (0.5 + 0.5 * Math.sin(now / 60 + i * 3));
      ctx.fillStyle = pal[i % pal.length];
      ctx.beginPath(); starPath(ctx, x, y, 3, 1, 4); ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  } else if (style === 'hero') {
    const k = Math.min(1, ms / 520);                     // 아래에서 통! 튀어 오름
    const ease = k < 1 ? 1 - Math.pow(1 - k, 3) * Math.cos(k * Math.PI * 2.2) : 1;
    const out = e > 0.85 ? (1 - e) / 0.15 : 1;
    ctx.globalAlpha = 0.5 * out;                         // 뒤에서 도는 햇살
    ctx.save(); ctx.translate(cx, h * 0.62); ctx.rotate(now / 1400);
    for (let i = 0; i < 12; i++) {
      ctx.rotate(Math.PI / 6);
      ctx.fillStyle = i % 2 ? (ap ? 'rgba(255,214,90,0.55)' : 'rgba(120,200,255,0.5)') : 'rgba(255,255,255,0.18)';
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-fieldW * 0.11, -fieldW * 0.9); ctx.lineTo(fieldW * 0.11, -fieldW * 0.9); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
    ctx.globalAlpha = out;
    const foot = h * 0.95 - (h * 0.24) * ease;
    const sc = Math.max(3, Math.min(fieldW / 60, h / 110));
    if (typeof drawAvatar === 'function' && avatar) {
      const bounce = Math.abs(Math.sin(ms / 170)) * 6 * (ms > 520 ? 1 : 0);
      drawAvatar(ctx, avatar, { expr: 'cheer', pose: 'up', eyes: 'happy', mouth: 'open' }, cx, foot - bounce, sc);
    }
    for (let i = 0; i < 16; i++) {                       // 캐릭터 주변 반짝이
      const a = (i / 16) * Math.PI * 2 + now / 900, r = fieldW * 0.32 + 10 * Math.sin(now / 200 + i);
      ctx.fillStyle = ['#fff3b0', '#ff9de0', '#9ff6ff'][i % 3];
      ctx.globalAlpha = out * (0.5 + 0.5 * Math.sin(now / 90 + i));
      ctx.beginPath(); starPath(ctx, cx + Math.cos(a) * r, h * 0.62 + Math.sin(a) * r * 0.6, 4, 1.4, 4); ctx.fill();
    }
    ctx.globalAlpha = 1;
  } else if (style === 'bats') {
    const mk = Math.min(1, ms / 700);                    // 보름달이 떠오름
    ctx.globalAlpha = 0.85 * (e > 0.85 ? (1 - e) / 0.15 : 1);
    const my = h * 0.2 + 40 * (1 - mk);
    const mg = ctx.createRadialGradient(cx, my, 10, cx, my, fieldW * 0.32);
    mg.addColorStop(0, 'rgba(255,236,170,0.95)'); mg.addColorStop(0.35, 'rgba(255,214,120,0.55)'); mg.addColorStop(1, 'rgba(255,180,80,0)');
    ctx.fillStyle = mg; ctx.fillRect(cx - fieldW * 0.4, my - fieldW * 0.4, fieldW * 0.8, fieldW * 0.8);
    ctx.fillStyle = 'rgba(255,240,190,0.9)';
    ctx.beginPath(); ctx.arc(cx, my, fieldW * 0.11, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
    for (let i = 0; i < 26; i++) {                       // 아래에서 위로 날아오르는 박쥐 떼
      const t0 = fcRand(i, 9) * 0.35, k = (e - t0) / 0.65;
      if (k <= 0 || k >= 1) continue;
      const sx = x0 + fieldW * fcRand(i, 10);
      const x = sx + Math.sin(k * 6 + i) * fieldW * 0.08 + (fcRand(i, 11) - 0.5) * fieldW * 0.5 * k;
      const y = h + 20 - (h + 60) * k;
      ctx.globalAlpha = k > 0.85 ? (1 - k) / 0.15 : 1;
      drawBat(ctx, x, y, 5 + 5 * fcRand(i, 12), now / 45 + i);
    }
    ctx.globalAlpha = 1;
  }
  drawFcLabel(ctx, cx, style === 'hero' ? h * 0.22 : cy, e, now, ap, combo, fieldW, style);
  ctx.restore();
}

/* 유령 판정선: 선 위로 희미한 연기가 피어올라 사라짐 */
function drawGhostWisps(ctx, x0, fieldW, judgeY, now) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 7; i++) {
    const k = ((now / 2600) + i / 7) % 1;
    const x = x0 + fieldW * ((i * 0.37 + 0.11) % 1) + Math.sin(now / 500 + i) * 8;
    const y = judgeY - 4 - k * 46;
    const sp = spriteOf('wisp', 52, 52, (c, w, h) => {
      const g = c.createRadialGradient(w / 2, h / 2, 1, w / 2, h / 2, 24);
      g.addColorStop(0, 'rgba(184,255,224,1)'); g.addColorStop(1, 'rgba(184,255,224,0)');
      c.fillStyle = g; c.fillRect(0, 0, w, h);
    });
    ctx.globalAlpha = 0.22 * (1 - k);
    drawSprite(ctx, sp, x, y, (14 + k * 10) / 24);
  }
  ctx.restore();
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
const FX_NEW = { petal: 950, stardust: 800, bolt: 260, fire: 620, snow: 1150, bat: 900, leaf: 1050 };   // 새 이펙트와 조각이 사는 시간(ms)
const PETAL_C = ['#ffc4dd', '#ff9cc6', '#ffe1ee', '#ff7fb5'];
const LEAF_C = ['#ff8a1e', '#e2451b', '#ffc93d', '#c8321b'];
function fxNewParts(fx, lane, e, now) {
  const R = Math.random;
  if (e === 'bolt') {
    const pts = [[0, 0]];
    for (let y = -24; y > -190; y -= 22 + R() * 14) pts.push([(R() - 0.5) * 26, y]);
    fx.parts.push({ lane, at: now, kind: e, pts, vx: 0, vy: 0, life: 260 });
    for (let i = 0; i < 4; i++) fx.parts.push({ lane, at: now, kind: 'boltSpark', vx: (R() - 0.5) * 300, vy: -100 - R() * 220, gr: 700, s: 2 + R() * 2, life: 300 });
    return;
  }
  const n = { petal: 7, stardust: 10, fire: 10, snow: 8, bat: 3, leaf: 6 }[e];
  for (let i = 0; i < n; i++) {
    const base = { lane, at: now, kind: e, dx: (R() - 0.5) * 0.5, life: FX_NEW[e] * (0.7 + R() * 0.3) };
    if (e === 'petal') fx.parts.push({ ...base, vx: (R() - 0.5) * 170, vy: -140 - R() * 160, gr: 230, s: 4 + R() * 4, r: R() * 6, vr: (R() - 0.5) * 9, sw: 4 + R() * 4, c: PETAL_C[i % PETAL_C.length] });
    else if (e === 'leaf') fx.parts.push({ ...base, vx: (R() - 0.5) * 180, vy: -150 - R() * 150, gr: 240, s: 5 + R() * 4, r: R() * 6, vr: (R() - 0.5) * 7, sw: 3 + R() * 3, c: LEAF_C[i % LEAF_C.length] });
    else if (e === 'stardust') fx.parts.push({ ...base, vx: (R() - 0.5) * 240, vy: -80 - R() * 240, gr: 160, s: 3 + R() * 4, ph: R() * 6, c: R() < 0.5 ? '#fff6c8' : '#ffd84d' });
    else if (e === 'fire') fx.parts.push({ ...base, vx: (R() - 0.5) * 60, vy: -150 - R() * 170, gr: -60, s: 6 + R() * 6, dx: (R() - 0.5) * 0.6 });
    else if (e === 'bat') fx.parts.push({ ...base, vx: (i - 1) * (70 + R() * 60), vy: -170 - R() * 120, gr: -40, s: 8 + R() * 3, ph: R() * 6 });
    else fx.parts.push({ ...base, vx: (R() - 0.5) * 140, vy: -110 - R() * 130, gr: 110, s: 2 + R() * 3, sw: 2 + R() * 3 });
  }
}
function drawFxNew(L, judgeY, fx, now, e) {
  const { ctx, laneW, x0, colors } = L;
  for (let l = 0; l < L.nl; l++) {      // 판정선 위 짧은 번쩍임
    const k = (now - fx.flash[l]) / 140;
    if (k < 1) {
      ctx.globalAlpha = (1 - k) * 0.55;
      ctx.fillStyle = e === 'fire' || e === 'bat' || e === 'leaf' ? '#ff9d3d' : e === 'petal' ? '#ffb3d1' : e === 'snow' ? '#e8f6ff' : colors[l];
      roundRect(ctx, x0 + l * laneW + 2, judgeY - 12, laneW - 4, 24, 8);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
  fx.parts = fx.parts.filter((p) => now - p.at < (p.life || 600));
  ctx.save();
  if (e !== 'petal' && e !== 'snow' && e !== 'bat' && e !== 'leaf') ctx.globalCompositeOperation = 'lighter';
  for (const p of fx.parts) {
    const t = (now - p.at) / 1000, k = (now - p.at) / (p.life || 600);
    const cx = x0 + (p.lane + 0.5 + (p.dx || 0)) * laneW;
    const x = cx + p.vx * t + (p.sw ? Math.sin(t * p.sw * 3) * 7 : 0), y = judgeY + p.vy * t + (p.gr || 0) * t * t;
    ctx.globalAlpha = Math.max(0, 1 - k);
    if (p.kind === 'petal') {
      ctx.save(); ctx.translate(x, y); ctx.rotate(p.r + t * p.vr);
      ctx.fillStyle = p.c; ctx.beginPath(); ctx.ellipse(0, 0, p.s, p.s * 0.55, 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    } else if (p.kind === 'stardust') {
      ctx.globalAlpha = Math.max(0, 1 - k) * (0.55 + 0.45 * Math.sin(t * 28 + p.ph));
      ctx.fillStyle = p.c; ctx.beginPath(); starPath(ctx, x, y, p.s, p.s * 0.32, 4); ctx.fill();
    } else if (p.kind === 'fire') {
      const r = p.s * (1 - k * 0.65);
      ctx.fillStyle = k < 0.25 ? '#fff3b0' : k < 0.55 ? '#ffb340' : '#ff5a2a';
      ctx.beginPath(); ctx.arc(x, y, Math.max(0.5, r), 0, Math.PI * 2); ctx.fill();
    } else if (p.kind === 'snow') {
      ctx.fillStyle = '#ffffff'; ctx.shadowColor = '#bfe8ff'; ctx.shadowBlur = 6;
      ctx.beginPath(); ctx.arc(x, y, p.s, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x - p.s * 2, y); ctx.lineTo(x + p.s * 2, y); ctx.moveTo(x, y - p.s * 2); ctx.lineTo(x, y + p.s * 2); ctx.stroke();
    } else if (p.kind === 'bat') {
      drawBat(ctx, x, y, p.s, t * 22 + p.ph);
    } else if (p.kind === 'leaf') {            // 단풍잎: 다섯 갈래 잎 + 꼭지
      ctx.save(); ctx.translate(x, y); ctx.rotate(p.r + t * p.vr);
      ctx.fillStyle = p.c; ctx.beginPath(); starPath(ctx, 0, 0, p.s, p.s * 0.48, 5); ctx.fill();
      ctx.strokeStyle = 'rgba(90,30,0,0.6)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, p.s * 1.1); ctx.stroke();
      ctx.restore();
    } else if (p.kind === 'bolt') {
      ctx.lineJoin = 'round';
      for (const [w, c] of [[6 * (1 - k) + 2, colors[p.lane]], [2, '#ffffff']]) {
        ctx.strokeStyle = c; ctx.lineWidth = w; ctx.shadowColor = colors[p.lane]; ctx.shadowBlur = 16;
        ctx.beginPath();
        p.pts.forEach(([px, py], i) => (i ? ctx.lineTo(cx + px, judgeY + py) : ctx.moveTo(cx + px, judgeY + py)));
        ctx.stroke();
      }
      ctx.shadowBlur = 0;
    } else if (p.kind === 'boltSpark') {
      ctx.fillStyle = '#ffffff'; ctx.fillRect(x - p.s / 2, y - p.s / 2, p.s, p.s);
    }
  }
  ctx.restore();
}
/* 박쥐 한 마리 (날갯짓 flap: 라디안) */
function drawBat(ctx, x, y, s, flap, col = '#9466e0') {
  const ss = Math.max(2, Math.round(s * 2) / 2);
  const fi = ((Math.round(flap / (Math.PI / 4)) % 8) + 8) % 8;
  const sp = spriteOf(`bat|${ss}|${fi}|${col}`, ss * 5 + 26, ss * 3.4 + 26, (c, w, h) => paintBat(c, w / 2, h / 2, ss, fi * Math.PI / 4, col));
  drawSprite(ctx, sp, x, y, s / ss);
}
function paintBat(ctx, x, y, s, flap, col) {
  const w = Math.sin(flap) * 0.7;
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = col;
  ctx.shadowColor = '#ff9a3d'; ctx.shadowBlur = 10;
  ctx.beginPath();
  ctx.moveTo(0, -s * 0.3);
  for (const sx of [-1, 1]) {      // 양쪽 날개 (끝이 들쭉날쭉)
    ctx.moveTo(0, -s * 0.2);
    ctx.quadraticCurveTo(sx * s * 1.2, -s * (0.9 + w), sx * s * 2.3, -s * (0.2 + w * 1.2));
    ctx.quadraticCurveTo(sx * s * 1.8, s * 0.05, sx * s * 1.5, s * 0.35);
    ctx.quadraticCurveTo(sx * s * 1.1, s * 0.05, sx * s * 0.8, s * 0.4);
    ctx.quadraticCurveTo(sx * s * 0.5, s * 0.1, 0, s * 0.35);
  }
  ctx.fill();
  ctx.beginPath(); ctx.ellipse(0, 0, s * 0.42, s * 0.55, 0, 0, Math.PI * 2); ctx.fill();   // 몸
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#ffd36b';
  ctx.fillRect(-s * 0.22, -s * 0.18, s * 0.14, s * 0.14); ctx.fillRect(s * 0.08, -s * 0.18, s * 0.14, s * 0.14);   // 눈
  ctx.restore();
}
function fxHit(fx, lane, now = performance.now()) {
  fx.flash[lane] = now;
  const e = settings.skin.effect;
  if (FX_NEW[e]) fxNewParts(fx, lane, e, now);
  else if (e === 'ring') fx.rings.push({ lane, at: now });
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
  if (FX_NEW[e]) { drawFxNew(L, judgeY, fx, now, e); return; }
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
function drawMilestone(L, fx, now, judgeY = judgeLineY(L.h)) {
  const m = fx.mile;
  if (!m || !settings.skin.combo) return;
  const e = (now - m.at) / 900;
  if (e >= 1) { fx.mile = null; return; }
  const { ctx, h, x0, fieldW } = L;
  const cx = x0 + fieldW / 2, cy = comboY(L, judgeY);
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
/* 콤보 숫자 높이: '판정선 가까이'면 판정 글자 바로 위 (콤보·판정을 한 묶음으로), '위쪽'이면 예전 자리 */
function comboY(L, judgeY) {
  if (settings.skin.judgePos === 'top') return hudY(L);
  return judgePopY(L, judgeY) - judgeFs(L) * 0.55 - 6 - comboSize(L) * 0.5;
}
function comboSize(L) { return Math.round(Math.min(60, L.laneW * 0.62 + 22)); }
function drawCombo(L, combo, popAt, now, judgeY = judgeLineY(L.h)) {
  if (!settings.skin.combo || combo < 2) return;
  const { ctx, x0, fieldW } = L;
  const cx = x0 + fieldW / 2, cy = comboY(L, judgeY), fs = comboSize(L);
  const p = clamp((now - popAt) / 140, 0, 1);
  const sc = 1 + 0.14 * punchK() * (1 - p) * (1 - p);
  const cs = settings.skin.comboStyle || 'normal';
  const cc = cs === 'gold' ? ['#fff7cc', '#ffb300', 'rgba(255,157,0,0.9)'] : cs === 'neon' ? ['#ffffff', '#4de1ff', '#4de1ff'] : comboColor(combo);
  ctx.save();
  ctx.globalAlpha = 0.88;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.translate(cx, cy);
  ctx.scale(sc, sc);
  numFont(ctx, 800, fs);
  let cg = ctx.createLinearGradient(0, -fs / 2, 0, fs / 2);
  cg.addColorStop(0, cc[0]); cg.addColorStop(1, cc[1]);
  if (cs === 'rainbow') cg = rainbowGrad(ctx, -fs, fs * 2, now);
  ctx.lineWidth = 5; ctx.lineJoin = 'round'; ctx.strokeStyle = cs === 'neon' ? 'rgba(77,225,255,0.35)' : 'rgba(3,6,16,0.55)';
  ctx.strokeText(combo, 0, 0);
  ctx.fillStyle = cg;
  ctx.shadowColor = cs === 'rainbow' ? rainbowAt(now) : cc[2];
  ctx.shadowBlur = cs === 'neon' ? 22 : 10;
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
  return judgeY - Math.max(judgeY * 0.45, 150);
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
      .filter((n) => n.l >= 0 && n.l < this.nl && (!practice || (n.t >= from - 0.001 && n.t <= practice.end))
        && (practice || n.t >= EARLIEST_NOTE))   // 곡 맨 앞(영상이 켜지는 순간)에 있는 노트는 칠 수 없어서 뺌
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
    if (!this.leadDone) { this.leadDone = true; this.makeLeadIn(); this.markPumpkins(); }
    if (this.practice) { yt.rate(this.rate); yt.seek(this.startT); }
    else if (Math.abs(yt.time() - this.startT) > 0.05) yt.seek(this.startT);    // 영상이 시작 위치에 있는지 한 번 더
    this.clock.set(this.startT - lead * this.rate);
    this.clock.start();
    // 카운트인: 곡 박자(너무 빠르거나 느리면 0.35~0.8초)로 '딱' 세 번 — 세 번째가 시작 위치
    const gap = clamp(60 / (+this.song.bpm || 120), 0.35, 0.8) * this.rate;
    this.clicks = [this.startT - 2 * gap, this.startT - gap, this.startT];
    // 영상이 켜지는 데 걸리는 시간(학습값)만큼 미리 재생을 요청 → 세 번째 '딱'과 거의 같이 소리가 남 (멈칫하는 시간이 줄어듦)
    this.prerollAt = this.startT - Math.min(ytLag * 0.85, 0.5) * this.rate;
    this.jumpFixAt = 0;
    this.badSince = 0;
    this.trustAt = 0;
    this.clickN = this.clicks.filter((c) => c < this.clock.now()).length;   // 이미 지난 박은 건너뜀 (늦게 합류한 멀티 등)
    this.clickAt = 0;
    this.phase = 'countdown';
  }

  onYT(st, err) {
    if (st === 'error') {
      if (this.phase !== 'ended') this.abort(err.message);
      return;
    }
    if (st === YTS.PLAYING) {
      if (this.phase === 'countdown') {     // 카운트인 중에 영상이 먼저 켜짐 (폰에서 탭한 재생이 늦게 걸린 경우 등) → 멈추고 시작 위치로
        try { yt.pause(); yt.seek(this.startT); } catch { /* 무시 */ }
        this.strayPauseAt = performance.now();
        return;
      }
      if (this.phase === 'paused') { yt.pause(); return; }   // 일시정지 창이 떠 있는데 (미디어 키 등으로) 영상이 재생됨 → 다시 멈춤
      // ※ 재생이 막 시작된 순간의 유튜브 시간 값은 믿지 않음: 유튜브가 마지막으로 알려 준 값에 '지난 시간'을 더해서
      //    최대 1초쯤 앞선 값을 잠깐 돌려줄 때가 있음 → 예전엔 이 값 때문에 노트가 튀거나(MISS) 영상을 되감아 소리가 끊겼음
      const now = performance.now();
      if (this.phase === 'preroll' || this.phase === 'waitVideo') {
        // 영상은 시작 위치에 멈춰 있다가 지금 막 그 자리에서 재생됨 → 시계도 시작 위치에서 같이 출발
        ytLagLearn((now - this.playAt) / 1000);
        this.finishClicks();
        this.slew = null;
        this.clock.set(this.startT);
        this.clock.start();
        this.softUntil = now + 2500;
        this.trustAt = now + 380;
        this.badSince = 0;
        this.lastVT = -1;
        this.phase = 'playing';
        return;
      }
      if (this.phase === 'playing' || this.phase === 'resuming') {
        // 버퍼링·일시정지 뒤 다시 재생: 영상은 멈췄던 자리에서 이어지므로 시계도 멈춘 자리에서 그대로 이어감
        this.slew = null;
        this.clock.start();
        this.trustAt = now + 450;
        this.badSince = 0;
        this.lastVT = -1;
        this.phase = 'playing';
      }
    } else if (st === YTS.BUFFERING) {
      if (this.phase === 'playing') { this.clock.stop(); this.slew = null; }
    } else if (st === YTS.PAUSED) {
      if (this.phase === 'playing') {
        if (this.multi) { this.clock.stop(); this.slew = null; yt.play(); }   // 멀티는 멈출 수 없음 → 시계도 멈추고 다시 재생 (노트가 혼자 내려가 MISS 나지 않게)
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
    if (n.pk && kind !== 'miss') { this.pumpkins = (this.pumpkins || 0) + 1; (this.candyPops ||= []).push({ lane, at: performance.now() }); }   // 소리 없이 🍬 +1만
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
      this.fcStyle = settings.skin.fcFx || 'basic';
      if (typeof fcSound === 'function') fcSound(this.fcStyle);
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
    const fcHold = this.fcAt && performance.now() - this.fcAt < fcDur(this.fcStyle) - 100;   // 풀콤보 연출을 볼 시간
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
      t: +gt.toFixed(3), c: this.cutT || 0, p: bits, h: this.sentHits, m: this.laneMap, f: fv.mult > 1 && gt <= fv.until,
    });
    this.sentHits = [];
    if (now - this.lastLive > 400) { this.lastLive = now; this.renderLive(); }
  }

  loop() {
    cancelAnimationFrame(this.raf);
    const step = () => {
      if (this.phase === 'ended' || this.phase === 'aborted') return;
      const t = this.clock.now();
      if (this.phase === 'countdown' || this.phase === 'preroll') {
        while (this.clickN < this.clicks.length && t >= this.clicks[this.clickN]) {
          this.clickN++;
          this.clickAt = performance.now();
          sfx.stick(this.clickN === this.clicks.length);
        }
      }
      if (this.phase === 'countdown' && t >= this.prerollAt) {
        this.phase = 'preroll';
        this.waitSince = this.playAt = performance.now();
        this.retryAt = 0;
        if (yt.state() === YTS.PLAYING && performance.now() - (this.strayPauseAt || 0) > 1000) {   // 이미 재생 중이면 '재생됨' 알림이 다시 안 오므로 시작 위치로 맞추고 바로 시작
          yt.seek(this.startT);
          this.finishClicks();
          this.clock.set(this.startT);
          this.softUntil = performance.now() + 2500;
          this.trustAt = performance.now() + 600;
          this.badSince = 0;
          this.lastVT = -1;
          this.phase = 'playing';
        } else yt.play();
      }
      if (this.phase === 'preroll' && t >= this.startT) {
        // 세 번째 '딱'까지 영상이 아직 안 켜짐 → 영상이 진짜로 재생될 때까지 노트를 시작 위치에 멈춰 둠
        // (소리 없이 노트만 지나가거나, 늦게 켜진 영상을 쫓아가느라 노트가 빨라지지 않게)
        this.clock.stop();
        this.clock.set(this.startT);
        this.phase = 'waitVideo';
        this.waitSince = performance.now();
      }
      if (this.phase === 'waitVideo') {
        // 재생 요청이 씹히면 다시 요청, 10초가 지나도 안 되면 포기
        const wait = performance.now() - this.waitSince;
        if (wait > 10000) { this.abort('영상이 시작되지 않아요. 인터넷 연결을 확인하고 다시 시도해 주세요.'); return; }
        if (wait - (this.retryAt || 0) > 1000 && yt.state() !== YTS.PLAYING && yt.state() !== YTS.BUFFERING) { this.retryAt = wait; yt.play(); }
        if (wait > 400 && yt.state() === YTS.PLAYING) {   // '재생됨' 알림을 놓친 경우 (이미 재생된 지 오래라 유튜브 시간이 정확함)
          this.onYT(YTS.PLAYING);
          this.clock.set(Math.max(this.startT, yt.time()));
        }
      }
      if (this.phase === 'resuming') {
        const wait = performance.now() - this.waitSince;
        if (wait > 10000) { this.abort('영상이 다시 재생되지 않아요. 인터넷 연결을 확인하고 다시 시도해 주세요.'); return; }
        if (yt.state() === YTS.PLAYING && wait > 150) this.onYT(YTS.PLAYING);   // '재생됨' 알림을 놓쳤거나 이미 재생 중이었음
        else if (wait - (this.retryAt || 0) > 1000 && yt.state() !== YTS.BUFFERING) { this.retryAt = wait; yt.play(); }
      }
      if (this.phase === 'playing') {
        const now = performance.now();
        if (!this.clock.running && yt.state() === YTS.PLAYING && now - (this.jumpFixAt || 0) > 300) {
          this.clock.start();             // '다시 재생됨' 알림을 놓쳐도 시계를 다시 움직임
          this.trustAt = now + 450;
          this.lastVT = -1;
        }
        const vt = yt.time();
        if (this.clock.running && now >= (this.trustAt || 0) && vt !== this.lastVT) {
          const err = vt - this.clock.now();
          const snap = now < (this.softUntil || 0) ? 0.6 : 0.4;
          if (Math.abs(err) > snap) {
            // 크게 어긋남: 유튜브가 잠깐 엉뚱한 값을 줄 때가 있어 0.35초 넘게 계속될 때만 고침
            if (!this.badSince) this.badSince = now;
            else if (now - this.badSince > 350) {
              this.badSince = 0;
              if (err > 1.2 * this.rate && now - (this.jumpFixAt || 0) > 1500) {
                // 영상이 앞으로 크게 튐 → 노트가 한꺼번에 MISS 되지 않게 영상을 게임 위치로 되돌림
                this.jumpFixAt = now;
                this.trustAt = now + 600;
                yt.seek(this.clock.now());
              } else this.clock.set(vt);   // 영상이 멈칫해서 뒤처짐 등 → 시계를 영상에 맞춤
            }
          } else {
            this.badSince = 0;
            const offT = settings.offset / 1000 * this.rate;
            if (this.nextNoteT() > Math.max(this.gt, vt - offT) + this.lookahead()) this.clock.set(vt);   // 맞춘 뒤에도 화면에 노트가 없으면 바로 맞춤 (눈에 안 보임)
            else this.clock.follow(vt, Infinity);   // 노트가 보일 땐 빠르기만 살짝(최대 ±8%) 바꿔 따라감
          }
          this.lastVT = vt;
        }
        this.update();
      }
      this.draw();
      this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  }

  /* 아직 안 친 첫 노트 시간 (누르고 있는 롱노트가 있으면 -Infinity) — 화면에 노트가 없을 때를 알기 위해 */
  nextNoteT() {
    for (let i = this.drawFrom; i < this.notes.length; i++) {
      const n = this.notes[i];
      if (!n.head || n.head === 'miss') return n.t;   // MISS 난 노트도 판정선 아래로 잠깐 그려지므로 '보이는 노트'로 침
      if (n.d > 0 && !n.tail) return -Infinity;
    }
    return Infinity;
  }
  /* 노트가 위에서 판정선까지 내려오는 데 걸리는 시간(초) */
  lookahead() {
    const h = this.L ? this.L.h : 900;
    return judgeLineY(h) / ((150 + settings.speed * 90) * (h < 600 ? h / 600 : 1));
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

  /* 풀콤보 / 올퍼펙트 연출 (꾸미기에서 고른 것) */
  drawFullCombo(L, now) {
    if (!this.fcAt) return;
    drawFcFx(L, this.fcStyle || 'basic', this.fcKind === 'ap', this.fcAt, now, this.maxCombo);
  }

  /* ---------------- 그리기 */
  draw() {
    const L = fitCanvas(this.cv, this.nl, { scale: settings.skin.laneScale, pos: settings.skin.gearPos });
    this.L = L;
    const { ctx, w, h, laneW, fieldW, x0 } = L;
    const judgeY = judgeLineY(h);
    const gt = this.phase === 'loading' || this.phase === 'ready' ? this.startT - 3 : this.gt;
    // 카운트인 중에 속도를 바꾸거나 창 크기가 바뀌어 노트가 일찍 보이게 되면 그만큼 더 뺌 ('딱 딱 딱' 동안엔 노트가 안 보이게)
    if (this.leadDone && (this.phase === 'countdown' || this.phase === 'preroll' || this.phase === 'waitVideo')) this.makeLeadIn(true);
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
    drawCombo(L, this.fcAt ? 0 : this.combo, this.comboPop, now, judgeY);   // 풀콤보 글자가 뜨면 콤보 숫자는 숨김 (글자 아래에 콤보 수 표시)
    drawMilestone(L, this.fx, now, judgeY);
    drawJudgePopup(L, this.popup, now, judgeY);

    // 노트
    while (this.drawFrom < this.notes.length) {
      const n = this.notes[this.drawFrom];
      if (n.t + n.d < gt - 0.6 && n.head && (n.d === 0 || n.tail)) this.drawFrom++;
      else break;
    }
    const preStart = this.phase === 'loading' || this.phase === 'ready';   // 시작 전엔 노트를 안 보여 줌 (곧 빠질 앞부분 노트가 보이지 않게)
    for (let i = this.drawFrom; i < this.notes.length; i++) {
      const n = this.notes[i];
      if (preStart || n.t > tTop + 0.1) break;
      const holding = this.activeHold[n.l] === n;
      if (n.head && n.head !== 'miss' && !holding) continue; // 처리 끝난 노트
      let yHead = judgeY - (n.t - gt) * pps;
      const yTail = n.d > 0 ? judgeY - (n.t + n.d - gt) * pps : null;
      if (holding) yHead = judgeY;
      if (yTail !== null && yTail > h) continue;
      if (yTail === null && yHead > h + 20) continue;
      const state = n.head === 'miss' || n.tail === 'miss' ? 'dead' : holding ? 'hold' : 'live';
      if (n.pk && state === 'live') drawPumpkinNote(L, n.l, yHead, now);
      else drawNote(L, n.l, yHead, yTail, state, n.a);
    }

    drawJudgeLine(L, judgeY, this.pressed, this.fx, now);
    drawFx(L, judgeY, this.fx, now);   // 타격 이펙트
    for (let l = 0; l < this.nl; l++) if (this.activeHold[l] && (this.phase === 'playing' || this.phase === 'preroll')) { fxHoldSpark(this.fx, l, now); drawHoldGlow(L, judgeY, l, now); }
    if (settings.skin.errorBar !== false) drawErrorBar(L, judgeY, this.errHist, now);
    drawPunch(L, judgeY, this.fx, now);
    drawGlints(L, judgeY, this.fx, now);
    if (this.candyPops && this.candyPops.length) {     // 🍬 +1 이 떠오름
      this.candyPops = this.candyPops.filter((c) => now - c.at < 800);
      ctx.save();
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (const c of this.candyPops) {
        const k = (now - c.at) / 800;
        const sc = k < 0.15 ? 0.7 + k * 3 : 1.15 - Math.min(0.15, (k - 0.15));
        ctx.globalAlpha = 1 - k * k;
        const sp = spriteOf('candy+1', 96, 44, (x, w, h) => {
          x.font = `900 23px ${UI_FONT}`; x.textAlign = 'center'; x.textBaseline = 'middle';
          x.lineWidth = 4; x.strokeStyle = 'rgba(60,20,0,0.85)'; x.shadowColor = '#ff7a1a'; x.shadowBlur = 12;
          x.strokeText('🍬+1', w / 2, h / 2); x.fillStyle = '#ffe9a8'; x.fillText('🍬+1', w / 2, h / 2);
        });
        drawSprite(ctx, sp, x0 + c.lane * laneW + laneW / 2, judgeY - 40 - 52 * k, sc);
      }
      ctx.restore();
    }

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
    if (this.ghost && settings.ghost !== false && this.phase !== 'loading' && this.phase !== 'ready') this.drawGhost(ctx, sx, outside ? sy + 60 : 50, outside, roomR);   // 기어 안이면 오른쪽 맞춤 (잘리지 않게)

    const cx = x0 + fieldW / 2;
    if (this.stage) this.stage.draw({ beat: Math.max(0, Math.floor((gt - off) / bl)), fever: inFever && settings.skin.fever, label: settings.nick || '', cxr: this.ilOn ? 0.3 : 0.5 });
    this.drawFullCombo(L, now);
    ctx.restore();

    // 상태 문구
    ctx.textBaseline = 'middle';
    let msg = '';
    if (this.phase === 'loading') msg = '불러오는 중...';
    else if (this.phase === 'ready') msg = this.multi ? '다른 플레이어를 기다리는 중...' : '';
    else if (this.phase === 'countdown' || this.phase === 'preroll') msg = this.clickN ? String(this.clicks.length + 1 - this.clickN) : 'READY';
    else if (this.phase === 'waitVideo' && now - this.waitSince <= 600) msg = '1';
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
      return { id: p.id, name: p.name, me, avatar: p.avatar, diff, keys, ...d };
    }).sort((a, b) => b.score - a.score);
    $('#liveBoard').innerHTML = rows.map((r) =>
      `<li class="${r.me ? 'me' : ''}" data-pl="${esc(r.id)}" title="눌러서 캐릭터·자주 하는 노래 보기"><span class="n">${typeof miniHtml === 'function' ? miniHtml(r.avatar, 24) : ''} ${esc(r.name)}${r.diff ? ` <small class="ld">${r.keys || 4}K ${(typeof DIFF_EN !== 'undefined' && DIFF_EN[r.diff]) || ''}</small>` : ''}</span><span class="s">${String(r.score).padStart(7, '0')}</span><span class="c">${r.combo}x</span></li>`
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
    if (!['playing', 'countdown', 'waitVideo', 'preroll', 'resuming'].includes(this.phase)) return;
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

  /* '딱 딱 딱'이 끝날 때까지 화면에 노트가 하나도 안 보이게:
     첫 노트가 노래 시작 뒤 LEAD_GAP초에 화면 맨 위로 들어오도록
     - 연습·하이라이트: 영상을 그만큼 앞에서부터 틀어 줌 (노트는 그대로)
     - 곡 처음부터: 영상을 더 앞에서 틀 수 없으니 그 전에 나오는 노트를 뺌
     → 영상이 켜지는 순간(유튜브 반응이 들쭉날쭉한 때)에는 화면에 노트가 없어서 멈칫해도 안 보이고, 그사이 노래와 정확히 맞춤 */
  makeLeadIn(later = false) {
    if (!this.notes.length || this.noLeadCut) return;
    const look = this.lookahead() + LEAD_GAP * this.rate;
    const off = settings.offset / 1000 * this.rate;
    const firstT = this.notes[0].t;
    if (!later && this.practice && firstT - look + off < this.startT) {
      const st = Math.max(0, firstT - look + off);
      this.startT = st;
      if (st > 0) return;          // 영상을 앞에서부터 틀면 충분 → 노트는 그대로
    }
    const cut = +(this.startT - off + look).toFixed(3);
    if (firstT >= cut - 0.002) return;       // 0.002: 반올림 오차로 딱 맞춘 첫 노트가 빠지지 않게 (관전 화면도 같은 기준)
    this.cutT = cut;
    this.notes = this.notes.filter((n) => n.t >= cut - 0.002);
    if (this.notes.length) this.lastEnd = this.notes.reduce((m, n) => Math.max(m, n.t + n.d), 0);
    this.lanes = Array.from({ length: this.nl }, () => []);
    this.notes.forEach((n, i) => this.lanes[n.l].push(i));
    this.laneHead.fill(0);
    this.drawFrom = 0;
    this.totalUnits = this.notes.length + this.notes.filter((n) => n.d > 0).length;
    this.feverMax = feverMaxSum(this.notes);
  }

  /* 할로윈 이벤트: 노트 몇 개(약 3.5%)를 호박으로 — 치면 🍬 +1 (점수와 상관없음). 같은 곡이면 늘 같은 노트 */
  markPumpkins() {
    this.pumpkins = 0;
    this.candyPops = [];
    const ev = typeof myGrow !== 'undefined' && myGrow && myGrow.event;
    if (!ev || this.noLeadCut || this.customNotes || (this.practice && !this.hl)) return;
    let k = 0;
    for (const n of this.notes) {
      if (n.d > 0) continue;
      const hsh = (Math.imul(Math.round(n.t * 1000) + n.l * 7919, 2654435761) >>> 0) % 1000;
      if (hsh < 35) { n.pk = 1; k++; }
    }
    this.pkTotal = k;
  }

  /* 영상이 세 번째 '딱'보다 조금 먼저 켜졌을 때: 아직 안 울린 마지막 '딱'을 지금 울림 */
  finishClicks() {
    if (this.clicks && this.clickN < this.clicks.length) {
      this.clickN = this.clicks.length;
      this.clickAt = performance.now();
      sfx.stick(true);
    }
  }

  resume() {
    hideOverlay();
    if (this.prevPhase === 'countdown') { this.phase = 'countdown'; this.clock.start(); return; }
    if (this.prevPhase === 'preroll' || this.prevPhase === 'waitVideo') { this.begin(1.5); return; }
    if (this.prevPhase === 'resuming') this.prevPhase = 'playing';   // 시작 직전에 멈췄으면 카운트인부터 다시
    this.phase = 'resuming';
    this.waitSince = performance.now();
    this.retryAt = 0;
    this.clock.set(this.clock.now());   // 멈춘 자리에서 이어감
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
