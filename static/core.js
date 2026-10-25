/* 링크비트 공통 기능: 설정, API, 유튜브 플레이어, 시계, 효과음, 네트워크 */
'use strict';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const DIFF_NAME = { easy: '쉬움', normal: '보통', hard: '어려움', extreme: '극한' };

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function fmtTime(sec, ms = false) {
  sec = Math.max(0, sec || 0);
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return ms ? `${m}:${s.toFixed(3).padStart(6, '0')}` : `${m}:${String(Math.floor(s)).padStart(2, '0')}`;
}
function keyLabel(code) {
  if (!code) return '?';
  const map = {
    Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Space: 'SPACE', BracketLeft: '[', BracketRight: ']',
    Backslash: '\\', Backquote: '`', Minus: '-', Equal: '=', Escape: 'ESC', Enter: 'ENTER', Tab: 'TAB', Backspace: 'BKSP',
    ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', ShiftLeft: 'L-SHIFT', ShiftRight: 'R-SHIFT',
    ControlLeft: 'L-CTRL', ControlRight: 'R-CTRL', AltLeft: 'L-ALT', AltRight: 'R-ALT', CapsLock: 'CAPS',
    NumpadAdd: 'N+', NumpadSubtract: 'N-', NumpadMultiply: 'N*', NumpadDivide: 'N/', NumpadEnter: 'N-ENT', NumpadDecimal: 'N.',
  };
  if (map[code]) return map[code];
  return code.replace(/^Key/, '').replace(/^Digit/, '').replace(/^Numpad/, 'N');
}

/* ------------------------------------------------------------ 저장소 */
const store = {
  get(k, d) { try { const v = localStorage.getItem('lb_' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('lb_' + k, JSON.stringify(v)); } catch { /* 무시 */ } },
};

const DEFAULT_KEYS4 = ['KeyD', 'KeyF', 'KeyJ', 'KeyK'];
const DEFAULT_KEYS6 = ['KeyS', 'KeyD', 'KeyF', 'KeyJ', 'KeyK', 'KeyL'];
const DEFAULT_FN = { pause: 'Escape', syncDown: 'Minus', syncUp: 'Equal', speedUp: 'ArrowUp', speedDown: 'ArrowDown' };
const FN_NAMES = { pause: '일시정지', syncDown: '싱크 −', syncUp: '싱크 +', speedUp: '속도 +', speedDown: '속도 −' };
const settings = Object.assign(
  { keys: [...DEFAULT_KEYS4], keys6: [...DEFAULT_KEYS6],
    speed: 5, offset: 0, volume: 80, hit: 0, dim: 0.8, diff: 'normal', mode: 4, sort: 'new', nick: '' },
  store.get('settings', {})
);
settings.fnKeys = Object.assign({ ...DEFAULT_FN }, settings.fnKeys || {});
if (!Array.isArray(settings.keys) || settings.keys.length !== 4) settings.keys = [...DEFAULT_KEYS4];

/* ------------------------------------------------------------ 꾸미기 (사람마다 브라우저에 저장) */
const THEMES = {
  classic: { name: '클래식', a: '#eef3ff', b: '#3f8cff', c: '#ffc83d' },
  neon:    { name: '네온',   a: '#4de1ff', b: '#ff5fa2', c: '#b98cff' },
  sunset:  { name: '선셋',   a: '#ffd39a', b: '#ff7a3d', c: '#ff3b8a' },
  mint:    { name: '민트',   a: '#e6fff6', b: '#2fe0a8', c: '#4de1ff' },
  mono:    { name: '모노',   a: '#ffffff', b: '#8a93ad', c: '#d6dcef' },
  custom:  { name: '커스텀' },
};
const LINE_COLORS = { red: '#ff3b55', cyan: '#4de1ff', gold: '#ffc83d', white: '#ffffff', pink: '#ff5fa2' };
const DEFAULT_SKIN = {
  theme: 'classic', colors: { a: '#eef3ff', b: '#3f8cff', c: '#ffc83d' },
  note: 'bar', noteH: 16, laneScale: 1, gearPos: 'center', line: 'red', judgeY: 110,
  effect: 'flash', hitSound: 'off', hitVol: 60, judgeText: 'normal', judgePos: 'low', earlyLate: true, combo: true, fever: true,
  punch: 'mid', shake: true,   // 타격감 강도, 화면 흔들림
  chorusFx: true,              // 후렴(하이라이트)에 들어갈 때 연출
  applause: true,              // 풀콤보·올퍼펙트 박수
  accentSound: false,          // 드럼 강타 노트: 묵직한 소리(킥+심벌)를 겹침 (기본 꺼짐)
  holdSound: false,            // 롱노트를 정확히 뗐을 때 '딱' (기본 꺼짐)
  breakSound: false,           // 긴 콤보가 끊길 때 '툭' (기본 꺼짐)
  sndV: 2,                     // 효과음 기본값 판 (2: 위 세 소리 기본 꺼짐)
  errorBar: true,              // 판정 오차 막대 (빠름 ← → 느림)
  perfectGlint: true,          // PERFECT일 때만 작은 별빛 반짝임을 하나 더
  lineStyle: 'auto',           // 판정선 모양: auto(원형 노트면 원형 받침) | bar | ring | thin
  bgFx: 'soft',                // 배경 연출: off | soft | strong
};
const savedSndV = settings.skin && typeof settings.skin === 'object' ? settings.skin.sndV : 2;   // 저장된 꾸미기가 없으면 새 기본값 그대로
settings.skin = Object.assign({ ...DEFAULT_SKIN, hitSound: settings.hit ? 'click' : 'off' }, settings.skin || {});
settings.skin.colors = Object.assign({ ...DEFAULT_SKIN.colors }, settings.skin.colors || {});
if (savedSndV !== 2) {   // 예전엔 세 소리가 기본 켜짐으로 저장돼 있어서, 한 번만 꺼짐으로 바꿈 (다시 켜면 그대로 유지)
  Object.assign(settings.skin, { accentSound: false, holdSound: false, breakSound: false, sndV: 2 });
  store.set('settings', settings);
}
const skin = () => settings.skin;
function themeColors() {
  const sk = settings.skin;
  return sk.theme === 'custom' || !THEMES[sk.theme] ? sk.colors : THEMES[sk.theme];
}
if (!Array.isArray(settings.keys6) || settings.keys6.length !== 6) settings.keys6 = [...DEFAULT_KEYS6];
/* 화면 테마 (곡 선택·결과·창): neon(기본) · sunshine · mint · cherry · sage · slate · latte · lavender */
/* 화면 테마 — g: 고르기 창의 묶음 (dark 어두운 · light 밝은), tone: 밝은 바탕이면 별·판정 색을 진하게, 'dark'는 오른쪽 곡 카드도 어둡게
   pv: 고르기 창 미리보기 [바탕, 칸, 강조1, 강조2, 글자] */
const UI_THEMES = [
  { id: 'neon', name: '네온', g: 'dark', tone: '', pv: ['#04060d', '#141c34', '#3f8cff', '#4de1ff', '#e9eefc'] },
  { id: 'midnight', name: '미드나잇', g: 'dark', tone: 'dark', pv: ['#0b0a1a', '#1c1840', '#7a5cff', '#c06bff', '#ece8ff'] },
  { id: 'ocean', name: '오션', g: 'dark', tone: 'dark', pv: ['#041a22', '#08333f', '#0f9fb5', '#22c9b8', '#e2f7fa'] },
  { id: 'sunset', name: '선셋', g: 'dark', tone: 'dark', pv: ['#2b1238', '#3a1844', '#ff5f6d', '#ffa94d', '#fff0ea'] },
  { id: 'retro', name: '레트로', g: 'dark', tone: 'dark', pv: ['#0c0a06', '#1c160b', '#ff9d00', '#ffc233', '#ffe6b0'] },
  { id: 'sunshine', name: '선샤인', g: 'dark', tone: '', pv: ['#8c7535', '#6f5c25', '#f07a2a', '#ffab3d', '#fffaf0'] },
  { id: 'sage', name: '세이지', g: 'dark', tone: 'dark', pv: ['#1f2620', '#313c32', '#6f8f5e', '#87a46f', '#e3e8dc'] },
  { id: 'slate', name: '슬레이트', g: 'dark', tone: 'dark', pv: ['#1b2029', '#2b3342', '#56709e', '#6a86b3', '#dde3ee'] },
  { id: 'graphite', name: '그라파이트', g: 'dark', tone: 'dark', pv: ['#151618', '#26282c', '#c9ced6', '#f2f4f7', '#ececee'] },
  { id: 'snow', name: '스노우', g: 'light', tone: 'light', pv: ['#eef1f6', '#ffffff', '#2f6bff', '#3d8bff', '#1b2333'] },
  { id: 'mint', name: '민트', g: 'light', tone: 'light', pv: ['#e6f6f5', '#ffffff', '#1fb2c6', '#1c94d0', '#12313a'] },
  { id: 'cherry', name: '체리', g: 'light', tone: 'light', pv: ['#ffe8f0', '#ffffff', '#f0457f', '#ff7f6a', '#3a1a29'] },
  { id: 'peach', name: '피치', g: 'light', tone: 'light', pv: ['#ffeee4', '#ffffff', '#ff6f4f', '#ff9e5c', '#3b2219'] },
  { id: 'latte', name: '라떼', g: 'light', tone: 'light', pv: ['#ece3d6', '#f5efe6', '#a9805a', '#bd946a', '#4a3c2f'] },
  { id: 'lavender', name: '라벤더', g: 'light', tone: 'light', pv: ['#e7e5ee', '#f3f2f8', '#8b7ab8', '#a194c8', '#3d3850'] },
];
for (const t of UI_THEMES) t.sw = `linear-gradient(135deg,${t.pv[0]},${t.pv[2]})`;
function applyUiTheme() {
  const th = UI_THEMES.find((x) => x.id === settings.uiTheme) || UI_THEMES[0];
  const el = document.documentElement;
  if (th.id === 'neon') delete el.dataset.theme;
  else el.dataset.theme = th.id;
  if (th.tone) el.dataset.tone = th.tone;
  else delete el.dataset.tone;
}
applyUiTheme();
function saveSettings() {
  if (window.__lbReloading) return;   // 프로필을 불러와 새로고침하는 중엔 덮어쓰지 않음
  store.set('settings', settings);
  if (typeof profileSync === 'function') profileSync();
}
function keysFor(nl) { return nl === 6 ? settings.keys6 : settings.keys; }
const isTouch = window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 1 && !window.matchMedia('(pointer: fine)').matches;

/* ------------------------------------------------------------ 난이도 별점
   chartgen.py 의 star_rating() 과 똑같은 계산식이에요. 바꿀 땐 둘 다 바꾸세요. */
function lowerBound(arr, x) {
  let lo = 0, hi = arr.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] < x) lo = m + 1; else hi = m; }
  return lo;
}
function starRating(notes, nl = 4) {
  if (!notes || !notes.length) return 0;
  const ns = notes.map((n) => ({ t: +n.t, l: n.l | 0, d: +n.d || 0 })).sort((a, b) => a.t - b.t || a.l - b.l);
  const T = ns.map((n) => n.t);
  let end = -Infinity;
  for (const n of ns) end = Math.max(end, n.t + n.d);
  const cum = [0];
  for (const n of ns) cum.push(cum[cum.length - 1] + (1 + Math.min(n.d, 2) * 0.25));
  const stop = Math.max(T[0], end - 2) + 0.25;
  const cnt = Math.ceil((stop - T[0]) / 0.5);
  const nz = [];
  for (let i = 0; i < cnt; i++) {
    const st = T[0] + i * 0.5;
    const v = (cum[lowerBound(T, st + 2)] - cum[lowerBound(T, st)]) / 2;
    if (v > 0) nz.push(v);
  }
  if (!nz.length) return 0;
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const sorted = [...nz].sort((a, b) => b - a);
  const top = sorted.slice(0, Math.max(1, Math.ceil(nz.length * 0.25)));
  const dens = 0.75 * mean(top) + 0.25 * mean(nz);
  let jack = 0, chord = 0, hold = 0, prevT = null;
  const lastIn = {}, holdEnd = {};
  for (const x of ns) {
    if (x.l in lastIn && x.t - lastIn[x.l] < 0.3) jack++;
    if (prevT !== null && Math.abs(x.t - prevT) < 0.005) chord++;
    for (const k in holdEnd) { if (+k !== x.l && holdEnd[k] > x.t + 0.005) { hold++; break; } }
    lastIn[x.l] = x.t;
    if (x.d > 0) holdEnd[x.l] = x.t + x.d;
    prevT = x.t;
  }
  const n = ns.length;
  const tech = 1 + 0.6 * jack / n + 0.35 * chord / n + 0.4 * hold / n;
  const keys = nl === 6 ? 1.08 : 1;
  return Math.floor(1.05 * Math.pow(dens, 0.8) * tech * keys * 10 + 0.5) / 10;
}
function starClass(v) {
  return v < 2.5 ? 's1' : v < 4 ? 's2' : v < 5.5 ? 's3' : v < 7 ? 's4' : v < 8.5 ? 's5' : 's6';
}
function starHtml(v) { return `<span class="star ${starClass(v)}">★${(+v || 0).toFixed(1)}</span>`; }
function chartOf(song, diff, nl) { return ((nl === 6 ? song.charts6 : song.charts) || {})[diff] || []; }
/* AI 채보 (4키만, 기존 채보와 따로 저장) — 없으면 null */
function aiChartOf(song, diff, nl) { const c = nl === 4 && song && song.ai && song.ai.charts && song.ai.charts[diff]; return c && c.length ? c : null; }

let hostKey = store.get('hostKey', '');
(function readHostParam() {
  const u = new URL(location.href);
  const k = u.searchParams.get('host');
  if (k) {
    hostKey = k;
    store.set('hostKey', k);
    u.searchParams.delete('host');
    history.replaceState(null, '', u.pathname + u.search);
  }
})();

/* ------------------------------------------------------------ API */
async function api(path, { method = 'GET', body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (hostKey) headers['X-Host-Key'] = hostKey;
  const r = await fetch('/api' + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let j = {};
  try { j = await r.json(); } catch { /* 무시 */ }
  if (!r.ok) throw new Error(j.error || `오류 (${r.status})`);
  return j;
}

/* ------------------------------------------------------------ 토스트 */
let toastTimer = 0;
function toast(msg, ms = 2200) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

/* ------------------------------------------------------------ 시계 */
class SongClock {
  constructor() { this.running = false; this.base = 0; this.anchor = 0; this.adj = 0; }
  now(perf = performance.now()) { return this.running ? this.base + (perf - this.anchor) / 1000 * (this.rate || 1) * (1 + this.adj) : this.base; }
  set(t, perf = performance.now()) { this.base = t; this.anchor = perf; this.adj = 0; }
  start(perf = performance.now()) { if (!this.running) { this.anchor = perf; this.running = true; } }
  stop() { if (this.running) { this.base = this.now(); this.running = false; } }
  /* 유튜브 시간과 맞추기: 크게 어긋나면 바로, 조금이면 부드럽게 */
  sync(vt, snap = 0.12, k = 0.12) {
    const cur = this.now();
    const err = vt - cur;
    if (Math.abs(err) > snap) this.set(vt);
    else this.set(cur + err * k);
  }
  /* 플레이용: 위치를 건드리지 않고 흐르는 빠르기만 살짝(최대 ±6%) 바꿔서 유튜브를 따라감 → 노트가 갑자기 빨라지거나 튀지 않음.
     아주 크게 어긋났을 때(snap)만 바로 맞춤 (최대 ±8%) */
  follow(vt, snap = 0.4, maxAdj = 0.08) {
    const p = performance.now(), cur = this.now(p), err = vt - cur;
    if (Math.abs(err) > snap) { this.set(vt, p); return; }
    const a = Math.abs(err) < 0.012 ? 0 : clamp(err * 0.8, -maxAdj, maxAdj);
    if (a !== this.adj) { this.base = cur; this.anchor = p; this.adj = a; }
  }
}

/* ------------------------------------------------------------ 효과음 */
const sfx = {
  ctx: null,
  ensure() {
    if (!this.ctx) {
      try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return null; }
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  },
  tick(vol = 0.25, freq = 1600) {
    const ctx = this.ensure();
    if (!ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(freq * 0.5, t + 0.05);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
    o.connect(g).connect(ctx.destination);
    o.start(t);
    o.stop(t + 0.07);
  },
};
/* 타격감 소리 (직접 합성): 강타 · 롱노트 마무리 · 콤보 끊김 — 음량은 전체 음량을 따름 */
sfx.fxVol = function (k) { return clamp((settings.volume ?? 80) / 100, 0, 1) * k; };
/* 시작 카운트인: 드럼 스틱 '딱' (마지막은 조금 더 세게) */
sfx.stick = function (accent = false) {
  const ctx = this.ensure();
  if (!ctx) return;
  const t = ctx.currentTime + 0.005, v = this.fxVol(accent ? 0.55 : 0.4);
  const n = this.noise(ctx, 0.06); const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = accent ? 2500 : 3100; bp.Q.value = 2.5;
  const g = ctx.createGain(); g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
  n.connect(bp).connect(g).connect(ctx.destination); n.start(t); n.stop(t + 0.06);
  const o = ctx.createOscillator(); o.type = 'triangle';            // 나무가 부딪히는 '똑' 울림
  o.frequency.setValueAtTime(accent ? 1500 : 1850, t); o.frequency.exponentialRampToValueAtTime(accent ? 850 : 1050, t + 0.045);
  const g2 = ctx.createGain(); g2.gain.setValueAtTime(v * 0.7, t); g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
  o.connect(g2).connect(ctx.destination); o.start(t); o.stop(t + 0.08);
};
/* 방: 모두 준비됐을 때 방장에게 '띵-동' */
sfx.ding = function () {
  const ctx = this.ensure();
  if (!ctx) return;
  const t = ctx.currentTime, v = this.fxVol(0.22);
  [[880, 0], [1318.5, 0.13]].forEach(([f, d]) => {
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(f, t + d);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t + d); g.gain.exponentialRampToValueAtTime(v, t + d + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.45);
    o.connect(g).connect(ctx.destination); o.start(t + d); o.stop(t + d + 0.5);
  });
};
sfx.accent = function () {
  if (settings.skin.accentSound === false) return;
  const ctx = this.ensure();
  if (!ctx) return;
  const t = ctx.currentTime, v = this.fxVol(0.55);
  const o = ctx.createOscillator(); o.type = 'sine';                 // 킥: 낮게 떨어지는 쿵
  o.frequency.setValueAtTime(130, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.18);
  const g = ctx.createGain(); g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.26);
  o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + 0.28);
  const n = this.noise(ctx, 0.45); const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 5500;   // 심벌: 치익
  const g2 = ctx.createGain(); g2.gain.setValueAtTime(v * 0.35, t); g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.42);
  n.connect(hp).connect(g2).connect(ctx.destination); n.start(t); n.stop(t + 0.45);
};
sfx.release = function () {
  if (settings.skin.holdSound === false) return;
  const ctx = this.ensure();
  if (!ctx) return;
  const t = ctx.currentTime, v = this.fxVol(0.3);
  const o = ctx.createOscillator(); o.type = 'triangle';
  o.frequency.setValueAtTime(2300, t); o.frequency.exponentialRampToValueAtTime(1500, t + 0.04);
  const g = ctx.createGain(); g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
  o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + 0.08);
  const n = this.noise(ctx, 0.04); const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 3200; bp.Q.value = 1.2;
  const g2 = ctx.createGain(); g2.gain.setValueAtTime(v * 0.6, t); g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.035);
  n.connect(bp).connect(g2).connect(ctx.destination); n.start(t); n.stop(t + 0.04);
};
sfx.comboBreak = function () {
  if (settings.skin.breakSound === false) return;
  const ctx = this.ensure();
  if (!ctx) return;
  const t = ctx.currentTime, v = this.fxVol(0.32);
  const o = ctx.createOscillator(); o.type = 'sine';
  o.frequency.setValueAtTime(240, t); o.frequency.exponentialRampToValueAtTime(95, t + 0.12);
  const g = ctx.createGain(); g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
  o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + 0.17);
  const n = this.noise(ctx, 0.06); const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 700;
  const g2 = ctx.createGain(); g2.gain.setValueAtTime(v * 0.5, t); g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
  n.connect(lp).connect(g2).connect(ctx.destination); n.start(t); n.stop(t + 0.06);
};
/* 꾸미기에서 고른 타격음 (모두 직접 합성 — 저작권 걱정 없음) */
sfx.noise = function (ctx, dur) {
  const b = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate * dur)), ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = b;
  return src;
};
/* 타격음 목록 (id, 이름) — 꾸미기 창과 설정 창의 선택 칸이 이 목록으로 만들어져요 */
const HIT_SOUNDS = [
  ['off', '끄기'], ['click', '클릭'], ['soft', '부드러운 톡'], ['drum', '드럼'], ['kick', '킥'],
  ['snare', '스네어'], ['hat', '하이햇'], ['rim', '림샷'], ['clap', '박수'], ['wood', '우드블록'],
  ['pop', '뽁'], ['chip', '8비트'], ['coin', '코인'], ['laser', '레이저'], ['bell', '벨'],
];
function hitSoundOptions() { return HIT_SOUNDS.map(([v, n]) => `<option value="${v}">${n}</option>`).join(''); }

sfx.hit = function (type = settings.skin.hitSound, vol = settings.skin.hitVol / 100) {
  if (!type || type === 'off' || vol <= 0) return;
  const ctx = this.ensure();
  if (!ctx) return;
  const t = ctx.currentTime;
  const out = ctx.createGain();
  out.gain.value = vol;
  out.connect(ctx.destination);
  const env = (node, a, d, at = t) => {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.setValueAtTime(a, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + d);
    node.connect(g).connect(out);
    return g;
  };
  const osc = (wave, f0, f1, dur, a, at = t) => {
    const o = ctx.createOscillator(); o.type = wave;
    o.frequency.setValueAtTime(f0, at);
    if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, at + dur * 0.8);
    env(o, a, dur, at); o.start(at); o.stop(at + dur + 0.01);
  };
  const noise = (ftype, freq, q, dur, a, at = t) => {
    const n = this.noise(ctx, dur + 0.01);
    const f = ctx.createBiquadFilter(); f.type = ftype; f.frequency.value = freq; if (q) f.Q.value = q;
    n.connect(f); env(f, a, dur, at); n.start(at); n.stop(at + dur + 0.01);
  };
  switch (type) {
    case 'click': osc('triangle', 1600, 800, 0.06, 0.35); break;
    case 'soft': osc('sine', 900, 600, 0.07, 0.4); noise('lowpass', 2500, 0, 0.02, 0.06); break;
    case 'drum': osc('sine', 160, 45, 0.16, 0.9); noise('highpass', 3000, 0, 0.04, 0.15); break;
    case 'kick': osc('sine', 120, 38, 0.22, 1.0); osc('triangle', 300, 60, 0.03, 0.25); break;
    case 'snare': osc('triangle', 220, 160, 0.08, 0.35); noise('highpass', 1800, 0, 0.13, 0.5); break;
    case 'hat': noise('highpass', 7500, 0, 0.045, 0.55); break;
    case 'rim': osc('square', 1700, 1700, 0.025, 0.18); osc('triangle', 520, 480, 0.04, 0.4); noise('bandpass', 3200, 2, 0.02, 0.3); break;
    case 'clap':
      for (let i = 0; i < 3; i++) noise('bandpass', 1400, 0.9, i === 2 ? 0.09 : 0.02, 0.7, t + i * 0.011);
      break;
    case 'wood': osc('sine', 1050, 980, 0.07, 0.6); osc('sine', 2600, 2500, 0.03, 0.15); break;
    case 'pop': osc('sine', 420, 1100, 0.06, 0.55); break;
    case 'chip': osc('square', 880, 880, 0.035, 0.32); osc('square', 1320, 1320, 0.04, 0.28, t + 0.035); break;
    case 'coin': osc('square', 988, 988, 0.06, 0.28); osc('square', 1319, 1319, 0.16, 0.28, t + 0.06); break;
    case 'laser': osc('sawtooth', 2400, 300, 0.1, 0.38); break;
    case 'bell':
      for (const [f, a] of [[1318, 0.3], [1976, 0.15], [2637, 0.08]]) osc('sine', f, f, 0.35, a);
      break;
    default: break;
  }
};
/* 풀콤보 박수: 여러 사람이 각자 박자로 치는 박수를 합성 (짧게 커졌다가 하나둘 멈춤).
   big(ALL PERFECT)이면 사람이 더 많고 길게 + 환호 휘파람 */
sfx.applause = function (big = false) {
  if (settings.skin.applause === false) return;
  const ctx = this.ensure();
  if (!ctx) return;
  const vol = clamp((settings.volume ?? 80) / 100, 0, 1) * 0.55;
  if (vol <= 0) return;
  if (this.clapStop) this.clapStop();            // 이전 박수가 남아 있으면 정리
  const t0 = ctx.currentTime + 0.04;
  const master = ctx.createGain();
  master.gain.value = vol;
  const warm = ctx.createBiquadFilter(); warm.type = 'lowpass'; warm.frequency.value = 7000;   // 너무 쨍하지 않게
  warm.connect(master).connect(ctx.destination);
  this.clapStop = () => { try { master.gain.setTargetAtTime(0, ctx.currentTime, 0.08); } catch { /* 무시 */ } this.clapStop = null; };
  if (!this.clapBuf) {                             // 박수 하나하나에 쓸 잡음 (한 번만 만들어 재사용)
    const n = Math.floor(ctx.sampleRate * 1.0);
    this.clapBuf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = this.clapBuf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  }
  const people = big ? 24 : 15;
  const hold = big ? 3.0 : 2.0;                    // 다 같이 치는 시간
  for (let p = 0; p < people; p++) {
    // 사람마다: 박수 소리 높이(손 모양), 위치(좌우), 빠르기, 세기, 언제 멈추는지가 다름
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass';
    bp.frequency.value = 900 + Math.random() * 1500; bp.Q.value = 0.9 + Math.random() * 0.8;
    let node = bp;
    if (ctx.createStereoPanner) { const pan = ctx.createStereoPanner(); pan.pan.value = Math.random() * 1.6 - 0.8; bp.connect(pan); node = pan; }
    node.connect(warm);
    const rate = 3.6 + Math.random() * 2.2;        // 초당 박수 수
    const loud = 0.35 + Math.random() * 0.5;
    const start = Math.random() * 0.35;
    const stop = hold + Math.random() * (big ? 1.6 : 1.2);
    for (let t = start; t < stop; t += (1 / rate) * (0.85 + Math.random() * 0.3)) {
      const fade = t < 0.4 ? 0.45 + t / 0.4 * 0.55 : t > hold ? Math.max(0.15, 1 - (t - hold) / (stop - hold + 0.2)) : 1;
      const at = t0 + t;
      // 실제 박수처럼 아주 짧은 '탁'이 1~2번 겹침
      for (let k = 0; k < (Math.random() < 0.6 ? 2 : 1); k++) {
        const src = ctx.createBufferSource(); src.buffer = this.clapBuf;
        const g = ctx.createGain();
        const a = at + k * (0.004 + Math.random() * 0.006);
        const dec = 0.025 + Math.random() * 0.035;
        g.gain.setValueAtTime(0.0001, a);
        g.gain.linearRampToValueAtTime(loud * fade * (k ? 0.6 : 1), a + 0.0015);
        g.gain.exponentialRampToValueAtTime(0.0001, a + dec);
        src.connect(g).connect(bp);
        src.start(a, Math.random() * 0.9, dec + 0.01);
      }
    }
  }
  // 웅성웅성 깔리는 소리 (박수가 많이 겹친 느낌을 채움)
  const bed = ctx.createBufferSource(); bed.buffer = this.clapBuf; bed.loop = true;
  const bf = ctx.createBiquadFilter(); bf.type = 'bandpass'; bf.frequency.value = 1500; bf.Q.value = 0.5;
  const bg = ctx.createGain();
  const end = hold + (big ? 1.8 : 1.4);
  bg.gain.setValueAtTime(0.0001, t0);
  bg.gain.linearRampToValueAtTime(big ? 0.09 : 0.06, t0 + 0.5);
  bg.gain.setValueAtTime(big ? 0.09 : 0.06, t0 + hold);
  bg.gain.exponentialRampToValueAtTime(0.0001, t0 + end);
  bed.connect(bf).connect(bg).connect(warm);
  bed.start(t0); bed.stop(t0 + end + 0.05);
  if (big) {
    // 환호 휘파람: 올라갔다 내려오는 '휘익~'
    for (const [at, f, pan] of [[0.25, 2100, -0.5], [0.9, 2500, 0.6], [1.7, 1900, 0.1]]) {
      const o = ctx.createOscillator(); o.type = 'sine';
      const g = ctx.createGain();
      const s = t0 + at + Math.random() * 0.2;
      o.frequency.setValueAtTime(f * 0.75, s);
      o.frequency.exponentialRampToValueAtTime(f * 1.15, s + 0.18);
      o.frequency.exponentialRampToValueAtTime(f * 0.95, s + 0.55);
      const lfo = ctx.createOscillator(); lfo.frequency.value = 6; const lg = ctx.createGain(); lg.gain.value = f * 0.015;
      lfo.connect(lg).connect(o.frequency);
      g.gain.setValueAtTime(0.0001, s);
      g.gain.linearRampToValueAtTime(0.07, s + 0.05);
      g.gain.setValueAtTime(0.07, s + 0.4);
      g.gain.exponentialRampToValueAtTime(0.0001, s + 0.6);
      let n = g;
      if (ctx.createStereoPanner) { const pn = ctx.createStereoPanner(); pn.pan.value = pan; g.connect(pn); n = pn; }
      o.connect(g); n.connect(master);
      o.start(s); o.stop(s + 0.62); lfo.start(s); lfo.stop(s + 0.62);
    }
  }
};
window.addEventListener('pointerdown', () => sfx.ensure(), { once: true });

/* ------------------------------------------------------------ 유튜브 */
const YTS = { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 };
const YT_ERRORS = {
  2: '영상 주소가 잘못됐어요.',
  5: '이 브라우저에서 재생할 수 없는 영상이에요.',
  100: '영상이 삭제됐거나 비공개예요.',
  101: '이 영상은 다른 사이트에서 재생이 막혀 있어요. 같은 곡의 다른 영상으로 다시 추가해 주세요.',
  150: '이 영상은 다른 사이트에서 재생이 막혀 있어요. 같은 곡의 다른 영상으로 다시 추가해 주세요.',
  153: '유튜브 플레이어가 막혔어요. 주소창이 http://localhost 또는 정상 주소인지 확인해 주세요.',
};

const yt = {
  player: null,
  listeners: new Set(),
  waiters: [],
  videoId: null,
  ready: null,
  init() {
    this.ready = new Promise((resolve, reject) => {
      const to = setTimeout(() => reject(new Error('유튜브 플레이어를 불러오지 못했어요. 인터넷 연결을 확인해 주세요.')), 20000);
      window.onYouTubeIframeAPIReady = () => {
        this.player = new YT.Player('ytPlayer', {
          width: '100%', height: '100%',
          playerVars: { controls: 0, disablekb: 1, rel: 0, playsinline: 1, fs: 0, iv_load_policy: 3, modestbranding: 1, origin: location.origin },
          events: {
            onReady: () => { clearTimeout(to); resolve(); },
            onStateChange: (e) => this.emit(e.data),
            onError: (e) => this.fail(e.data),
          },
        });
      };
      const s = document.createElement('script');
      s.src = 'https://www.youtube.com/iframe_api';
      s.onerror = () => reject(new Error('유튜브에 연결할 수 없어요.'));
      document.head.appendChild(s);
    });
    this.ready.catch(() => {});
  },
  emit(st) {
    this.listeners.forEach((f) => { try { f(st); } catch (e) { console.error(e); } });
    this.waiters = this.waiters.filter((w) => {
      if (w.states.includes(st)) { clearTimeout(w.to); w.resolve(st); return false; }
      return true;
    });
  },
  fail(code) {
    const err = new Error(YT_ERRORS[code] || `유튜브 오류 (${code})`);
    this.lastError = err;
    this.waiters.forEach((w) => { clearTimeout(w.to); w.reject(err); });
    this.waiters = [];
    this.listeners.forEach((f) => { try { f('error', err); } catch { /* 무시 */ } });
  },
  on(f) { this.listeners.add(f); return () => this.listeners.delete(f); },
  waitState(states, ms) {
    return new Promise((resolve, reject) => {
      const w = { states, resolve, reject };
      w.to = setTimeout(() => { this.waiters = this.waiters.filter((x) => x !== w); reject(new Error('영상이 너무 늦게 시작돼요. 인터넷 상태를 확인해 주세요.')); }, ms);
      this.waiters.push(w);
    });
  },
  state() { try { return this.player.getPlayerState(); } catch { return -1; } },
  time() { try { return this.player.getCurrentTime() || 0; } catch { return 0; } },
  /* 미리 버퍼링: 음소거로 잠깐 재생했다가 0초로 되돌림 */
  async preload(videoId) {
    await this.ready;
    const p = this.player;
    this.lastError = null;
    p.mute();
    const playing = this.waitState([YTS.PLAYING], 20000);
    p.loadVideoById({ videoId, startSeconds: 0 });
    await playing;
    p.pauseVideo();
    p.seekTo(0, true);
    await sleep(250);
    for (let i = 0; i < 8 && (p.getCurrentTime() || 0) > 0.05; i++) { p.seekTo(0, true); await sleep(100); }
    p.unMute();
    p.setVolume(settings.volume);
    p.setPlaybackRate(1);
    this.videoId = videoId;
  },
  play() { try { this.player.playVideo(); } catch { /* 무시 */ } },
  pause() { try { this.player.pauseVideo(); } catch { /* 무시 */ } },
  seek(t) { try { this.player.seekTo(Math.max(0, t), true); } catch { /* 무시 */ } },
  rate(r) { try { this.player.setPlaybackRate(r); } catch { /* 무시 */ } },
  volume(v) { try { this.player.setVolume(v); } catch { /* 무시 */ } },
};

/* 플레이어를 화면별 자리(slot) 위에 겹쳐 놓기 (iframe을 옮기면 다시 로딩되므로 위치만 바꿈) */
let ytSlot = null;
const slotObserver = new ResizeObserver(() => placePlayer(ytSlot));
function placePlayer(slot) {
  const w = $('#ytWrap');
  if (ytSlot !== slot) {
    if (ytSlot) slotObserver.unobserve(ytSlot);
    ytSlot = slot;
    if (slot) slotObserver.observe(slot);
  }
  if (!slot || !slot.offsetParent) { w.classList.add('parked'); return; }
  const r = slot.getBoundingClientRect();
  w.classList.remove('parked');
  Object.assign(w.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
}
window.addEventListener('resize', () => placePlayer(ytSlot));
window.addEventListener('scroll', () => placePlayer(ytSlot), true);

/* ------------------------------------------------------------ 네트워크 (멀티) */
/* 방에 있다가 연결이 끊기거나(서버 업데이트) 새로고침하면 같은 방 코드로 다시 들어감 — 3분 안이면 */
const LAST_ROOM_MS = 180000;
function loadLastRoom() {
  try { const v = JSON.parse(sessionStorage.getItem('lb_lastRoom') || 'null'); return v && Date.now() - v.at < LAST_ROOM_MS ? v : null; } catch { return null; }
}
const net = {
  ws: null,
  id: null,
  room: null,
  ver: null,            // 처음 받은 서버 코드 버전 (= 이 화면의 버전)
  lastRoom: loadLastRoom(),
  setLastRoom(v) {
    this.lastRoom = v;
    try { if (v) sessionStorage.setItem('lb_lastRoom', JSON.stringify(v)); else sessionStorage.removeItem('lb_lastRoom'); } catch { /* 무시 */ }
  },
  offset: 0,
  samples: [],
  handlers: {},
  open: false,
  pingTimer: 0,
  connect() {
    const url = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
    let ws;
    try { ws = new WebSocket(url); } catch { setTimeout(() => this.connect(), 3000); return; }
    this.ws = ws;
    ws.onopen = () => {
      this.open = true;
      this.samples = [];
      this.send(helloMsg());
      const lr = this.lastRoom && Date.now() - this.lastRoom.at < LAST_ROOM_MS ? this.lastRoom : null;
      if (lr) { this.rejoining = true; this.send({ type: 'join', code: lr.code, rejoin: true, lead: lr.lead, songId: lr.songId }); }
      let n = 0;
      clearInterval(this.pingTimer);
      this.ping();
      this.pingTimer = setInterval(() => { n++; if (n < 6 || n % 6 === 0) this.ping(); }, 500);
      this.emit('status', true);
    };
    ws.onmessage = (e) => {
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      if (m.type === 'pong') return this.onPong(m);
      if (m.type === 'welcome') {
        this.id = m.id;
        if (m.ver) { if (!this.ver) this.ver = m.ver; else if (m.ver !== this.ver) this.emit('newver', m); }
      }
      if (m.type === 'room') {
        this.room = m;
        this.setLastRoom({ code: m.code, lead: m.leader === this.id, songId: m.leader === this.id ? m.songId : null, at: Date.now() });
        if (this.rejoining) { this.rejoining = false; this.emit('rejoined', m); }
      }
      if (m.type === 'left') { this.room = null; this.setLastRoom(null); }
      if (m.type === 'error' && this.rejoining) { this.rejoining = false; this.setLastRoom(null); }
      this.emit(m.type, m);
    };
    ws.onclose = () => {
      this.open = false;
      clearInterval(this.pingTimer);
      const hadRoom = !!this.room;
      if (hadRoom) this.setLastRoom(Object.assign({}, this.lastRoom, { at: Date.now() }));     // 다시 연결되면 이 방으로
      this.room = null;
      this.emit('status', false);
      if (hadRoom) this.emit('left', { lost: true });
      setTimeout(() => this.connect(), 2000);
    };
  },
  send(o) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(o)); },
  ping() { this.send({ type: 'ping', c: Date.now() }); },
  onPong(m) {
    const now = Date.now();
    const rtt = now - m.c;
    this.samples.push({ rtt, off: m.s - (m.c + rtt / 2) });
    if (this.samples.length > 12) this.samples.shift();
    const best = this.samples.reduce((a, b) => (b.rtt < a.rtt ? b : a));
    this.offset = best.off;
  },
  serverNow() { return Date.now() + this.offset; },
  on(type, f) { (this.handlers[type] ||= []).push(f); },
  emit(type, m) { (this.handlers[type] || []).forEach((f) => { try { f(m); } catch (e) { console.error(e); } }); },
  isLeader() { return this.room && this.room.leader === this.id; },
};

/* ------------------------------------------------------------ 화면 전환 */
let currentScreen = 'lobby';
function showScreen(name) {
  currentScreen = name;
  if (typeof onScreenChange === 'function') { try { onScreenChange(name); } catch { /* 무시 */ } }
  $$('.screen').forEach((s) => s.classList.toggle('active', s.id === 'screen-' + name));
  const slot = { game: '#slotGame', editor: '#slotEditor' }[name];
  const slotEl = slot ? $(slot) : null;
  requestAnimationFrame(() => placePlayer(slotEl));
  if (name === 'lobby' && typeof drawBeatLine === 'function') requestAnimationFrame(drawBeatLine);   // 숨겨져 있던 동안은 크기를 몰라서
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
}

/* ------------------------------------------------------------ 기록 */
/* hl: 하이라이트 모드 기록은 전체곡 기록과 따로 */
function bestKey(id, diff, nl = 4, hl = false, ai = false) {
  const h = hl ? 'hl' : '';
  if (nl !== 6 && ai) return `best_${id}_ai_${h ? h + '_' : ''}${diff}`;   // AI 채보 기록은 따로
  return nl === 6 ? `best_${id}_${h}6_${diff}` : `best_${id}_${h ? h + '_' : ''}${diff}`;
}
function getBest(id, diff, nl = 4, hl = false, ai = false) { return store.get(bestKey(id, diff, nl, hl, ai), null); }
function setBest(id, diff, nl, r, hl = false, ai = false) {
  const b = getBest(id, diff, nl, hl, ai);
  if (!b || r.score > b.score) {
    store.set(bestKey(id, diff, nl, hl, ai), {
      score: r.score, acc: r.acc, rank: r.rank, fc: r.fc, maxCombo: r.maxCombo,
      ...(r.counts ? { counts: { perfect: r.counts.perfect, great: r.counts.great, good: r.counts.good, miss: r.counts.miss } } : {}),
      ...(Array.isArray(r.g) ? { g: r.g } : {}),
    });
    if (typeof profileSync === 'function') profileSync();
    return true;
  }
  return false;
}
/* 등급 (정확도): MAX 100%(전부 PERFECT) · SSS 99% · SS 98% · S 95% · A 90% · B 80% · C 70% · D */
/* 서버에 보내는 내 정보 (이름·캐릭터·칭호·Lv·업적 요약) — 여러 곳에서 같은 모양으로 */
function helloMsg() {
  const m = { type: 'hello', name: settings.nick || '', avatar: settings.avatar, title: typeof achTitle === 'function' ? achTitle() : '',
    diff: settings.diff, keys: settings.mode, level: typeof myLevel === 'function' ? myLevel() : 0 };
  if (typeof achSummary === 'function') { try { Object.assign(m, achSummary()); } catch { /* 무시 */ } }
  return m;
}
const RANKS = ['D', 'C', 'B', 'A', 'S', 'SS', 'SSS', 'MAX'];
function rankOf(acc) {
  if (acc >= 100) return 'MAX';
  if (acc >= 99) return 'SSS';
  if (acc >= 98) return 'SS';
  if (acc >= 95) return 'S';
  if (acc >= 90) return 'A';
  if (acc >= 80) return 'B';
  if (acc >= 70) return 'C';
  return 'D';
}
/* 저장된 기록의 등급: 정확도가 있으면 지금 기준으로 다시 (SSS·MAX가 생기기 전 기록도) — MAX는 판정 개수로도 확인 */
function rankFor(r) {
  if (!r) return '';
  const acc = r.acc != null ? +r.acc : NaN;
  if (!Number.isFinite(acc)) return r.rank || '';
  let k = rankOf(acc);
  const c = r.counts;
  if (k === 'MAX' && c && (c.great || c.good || c.miss)) k = 'SSS';   // 소수점 반올림으로 100%가 된 경우
  return k;
}
