/* 링크비트 도트 캐릭터: 부품을 조합해 24×30 픽셀 스프라이트를 만들고 자동으로 외곽선을 그림 */
'use strict';

const AV_W = 24, AV_H = 30;
const AV_OPTS = {
  skin: ['#ffe0c4', '#f6c7a0', '#d99a6c', '#8d5a3b'],
  hairColor: ['#2b2233', '#6b4226', '#e8c15a', '#f27da6', '#5bb7ff', '#a98cff', '#eeeeee', '#ff6a3d'],
  hair: [['short', '짧은 머리'], ['long', '긴 머리'], ['twin', '양갈래'], ['spiky', '삐죽 머리'], ['bob', '단발']],
  eyes: [['dot', '동글'], ['happy', '웃음'], ['sparkle', '반짝'], ['sleepy', '졸린']],
  outfit: [['hoodie', '후드티'], ['jacket', '재킷'], ['dress', '원피스']],
  outfitColor: ['#3f8cff', '#ff5fa2', '#2fe0a8', '#ffc83d', '#8a93ad', '#ff3b55', '#b98cff', '#2b2f45'],
  acc: [['none', '없음'], ['phones', '헤드폰'], ['cap', '모자'], ['ribbon', '리본'], ['cat', '고양이 귀'], ['glasses', '안경']],
};
const DEFAULT_AVATAR = { skin: 0, hair: 'twin', hairColor: 3, eyes: 'sparkle', outfit: 'hoodie', outfitColor: 0, acc: 'phones' };
const AV_OUT = '#1b1430';

function avatarValid(a) {
  const o = Object.assign({}, DEFAULT_AVATAR);
  if (!a || typeof a !== 'object') return o;
  const pick = (k, list, isIdx) => {
    const v = a[k];
    if (isIdx) { if (Number.isInteger(v) && v >= 0 && v < list.length) o[k] = v; }
    else if (list.some((x) => x[0] === v)) o[k] = v;
  };
  pick('skin', AV_OPTS.skin, true); pick('hairColor', AV_OPTS.hairColor, true); pick('outfitColor', AV_OPTS.outfitColor, true);
  pick('hair', AV_OPTS.hair); pick('eyes', AV_OPTS.eyes); pick('outfit', AV_OPTS.outfit); pick('acc', AV_OPTS.acc);
  return o;
}
settings.avatar = avatarValid(settings.avatar);

function avLighter(hex, f = 0.4) {
  const n = parseInt(hex.slice(1), 16);
  const c = (v) => Math.round(v + (255 - v) * f).toString(16).padStart(2, '0');
  return '#' + c(n >> 16) + c((n >> 8) & 255) + c(n & 255);
}
function avDarker(hex, f = 0.7) {
  const n = parseInt(hex.slice(1), 16);
  const c = (v) => Math.round(v * f).toString(16).padStart(2, '0');
  return '#' + c(n >> 16) + c((n >> 8) & 255) + c(n & 255);
}

/* state: { pose: idle|left|right|up|sad, eyes: null|closed, mouth: smile|open|sad, sweat } */
function buildAvatar(a, st = {}) {
  const g = Array.from({ length: AV_H }, () => new Array(AV_W).fill(null));
  const px = (x, y, c) => { if (x >= 0 && x < AV_W && y >= 0 && y < AV_H) g[y][x] = c; };
  const rect = (x0, y0, x1, y1, c) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) px(x, y, c); };
  const skin = AV_OPTS.skin[a.skin], hair = AV_OPTS.hairColor[a.hairColor], cloth = AV_OPTS.outfitColor[a.outfitColor];
  const hairD = avDarker(hair, 0.78), clothD = avDarker(cloth, 0.72);
  const pose = st.pose || 'idle';

  // ---- 뒤쪽 머리 (긴 머리, 양갈래)
  if (a.hair === 'long') { rect(3, 8, 5, 22, hairD); rect(18, 8, 20, 22, hairD); }
  if (a.hair === 'twin') {
    for (const sx of [0, 20]) { rect(sx, 9, sx + 3, 16, hair); rect(sx + 1, 8, sx + 2, 17, hair); px(sx + 1, 16, hairD); px(sx + 2, 16, hairD); }
    px(3, 8, '#ff3b55'); px(20, 8, '#ff3b55');
  }

  // ---- 몸
  rect(10, 17, 13, 17, skin);   // 목
  const legY = a.outfit === 'dress' ? 26 : 25;
  rect(9, legY, 10, 27, '#2b2f45'); rect(13, legY, 14, 27, '#2b2f45');
  rect(8, 28, 10, 28, AV_OUT); rect(13, 28, 15, 28, AV_OUT);
  if (a.outfit === 'dress') {
    rect(8, 18, 15, 21, cloth); rect(7, 22, 16, 22, cloth); rect(6, 23, 17, 23, cloth); rect(5, 24, 18, 25, cloth);
    rect(8, 21, 15, 21, clothD); px(11, 19, '#ffffff'); px(12, 19, '#ffffff');
  } else {
    rect(7, 18, 16, 24, cloth);
    if (a.outfit === 'hoodie') {
      rect(9, 22, 14, 22, clothD); px(10, 19, '#ffffff'); px(10, 20, '#ffffff'); px(13, 19, '#ffffff'); px(13, 20, '#ffffff');
      rect(7, 17, 9, 17, clothD); rect(14, 17, 16, 17, clothD);
    } else {
      rect(11, 18, 12, 24, '#f2f4ff'); px(10, 18, '#f2f4ff'); px(13, 18, '#f2f4ff'); rect(7, 24, 16, 24, clothD);
    }
  }
  // 팔 (포즈)
  const armDown = (x, inset) => { rect(x, 18, x + 1, 23, cloth); rect(x, 24, x + 1, 24, skin); if (inset) px(x, 18, clothD); };
  const leftUp = pose === 'left' || pose === 'up', rightUp = pose === 'right' || pose === 'up';
  if (pose === 'sad') { rect(6, 18, 6, 24, cloth); px(6, 25, skin); rect(17, 18, 17, 24, cloth); px(17, 25, skin); }
  else {
    if (!leftUp) armDown(5, false);
    if (!rightUp) armDown(17, false);
  }

  // ---- 머리(얼굴)
  rect(7, 4, 16, 4, skin); rect(6, 5, 17, 5, skin); rect(5, 6, 18, 14, skin); rect(6, 15, 17, 15, skin); rect(7, 16, 16, 16, skin);
  // 눈
  const E = '#1b1430';
  const eyes = st.eyes || a.eyes;
  if (eyes === 'closed') { rect(8, 11, 10, 11, E); rect(13, 11, 15, 11, E); }
  else if (eyes === 'happy') { px(8, 11, E); px(9, 10, E); px(10, 11, E); px(13, 11, E); px(14, 10, E); px(15, 11, E); }
  else if (eyes === 'sleepy') { rect(8, 11, 10, 11, E); rect(13, 11, 15, 11, E); px(8, 10, skin); }
  else if (eyes === 'sparkle') {
    rect(8, 9, 9, 11, E); rect(14, 9, 15, 11, E);
    px(8, 9, '#ffffff'); px(14, 9, '#ffffff'); px(9, 11, '#7fc8ff'); px(15, 11, '#7fc8ff');
  } else { rect(8, 10, 9, 11, E); rect(14, 10, 15, 11, E); px(8, 10, '#ffffff'); px(14, 10, '#ffffff'); }
  // 볼, 입
  px(7, 13, '#ff8fb1'); px(16, 13, '#ff8fb1');
  const M = '#a8324a';
  if (st.mouth === 'open') { rect(11, 13, 12, 14, M); px(11, 14, '#ff8fb1'); }
  else if (st.mouth === 'sad') { px(11, 14, M); px(12, 14, M); px(10, 15, M); px(13, 15, M); }
  else { px(11, 14, M); px(12, 14, M); px(10, 13, M); px(13, 13, M); }
  if (st.sweat) { px(19, 8, '#7fc8ff'); px(19, 9, '#7fc8ff'); px(18, 9, '#bfe6ff'); }

  // ---- 앞머리
  rect(7, 2, 16, 2, hair); rect(5, 3, 18, 3, hair); rect(4, 4, 19, 6, hair);
  if (a.hair === 'bob') { rect(4, 7, 19, 8, hair); rect(3, 8, 5, 15, hair); rect(18, 8, 20, 15, hair); rect(4, 15, 5, 15, hairD); rect(18, 15, 19, 15, hairD); }
  else {
    rect(4, 7, 8, 7, hair); rect(10, 7, 13, 7, hair); rect(15, 7, 19, 7, hair);
    px(5, 8, hair); px(11, 8, hair); px(12, 8, hair); px(18, 8, hair);
    rect(4, 8, 5, 11, hair); rect(18, 8, 19, 11, hair);
  }
  if (a.hair === 'spiky') { px(8, 0, hair); px(12, 0, hair); px(16, 0, hair); rect(7, 1, 9, 1, hair); rect(11, 1, 13, 1, hair); rect(15, 1, 17, 1, hair); px(3, 5, hair); px(20, 5, hair); }
  if (a.hair === 'long') { rect(3, 8, 4, 12, hair); rect(19, 8, 20, 12, hair); }
  const hairL = avLighter(hair);   // 머리 광택
  px(8, 3, hairL); px(9, 3, hairL); px(7, 4, hairL);

  // ---- 액세서리
  if (a.acc === 'phones') {
    rect(8, 1, 15, 1, '#2b2f45'); px(6, 2, '#2b2f45'); px(7, 2, '#2b2f45'); px(16, 2, '#2b2f45'); px(17, 2, '#2b2f45'); px(5, 3, '#2b2f45'); px(18, 3, '#2b2f45');
    rect(2, 8, 4, 12, '#2b2f45'); rect(19, 8, 21, 12, '#2b2f45'); rect(3, 9, 3, 11, cloth); rect(20, 9, 20, 11, cloth);
  } else if (a.acc === 'cap') {
    rect(6, 1, 17, 4, cloth); rect(3, 5, 14, 5, clothD); px(11, 2, '#ffffff'); px(12, 2, '#ffffff');
  } else if (a.acc === 'ribbon') {
    const R = '#ff3b55';
    rect(15, 1, 16, 3, R); px(17, 2, avDarker(R)); rect(18, 1, 19, 3, R); px(15, 1, '#ff8fa0');
  } else if (a.acc === 'cat') {
    for (const [x0, dir] of [[5, 1], [18, -1]]) {
      px(x0, 0, hair); px(x0, 1, hair); px(x0 + dir, 1, hair); px(x0, 2, hair); px(x0 + dir, 2, '#ff8fb1'); px(x0 + 2 * dir, 2, hair);
    }
  } else if (a.acc === 'glasses') {
    for (const x0 of [7, 13]) {
      rect(x0, 9, x0 + 3, 9, E); rect(x0, 12, x0 + 3, 12, E); px(x0, 10, E); px(x0, 11, E); px(x0 + 3, 10, E); px(x0 + 3, 11, E);
    }
    px(11, 10, E); px(12, 10, E);
  }

  // ---- 든 팔 (V자로 바깥쪽 위로, 액세서리보다 앞에)
  const armUpV = (m) => {   // m: 왼팔 0, 오른팔 1 (좌우 대칭)
    const X = (x) => (m ? AV_W - 1 - x : x);
    for (let y = 17; y <= 18; y++) { px(X(5), y, cloth); px(X(6), y, cloth); }
    for (let y = 13; y <= 16; y++) { px(X(3), y, cloth); px(X(4), y, cloth); }
    for (let y = 7; y <= 12; y++) { px(X(1), y, cloth); px(X(2), y, clothD); }
    for (let y = 4; y <= 6; y++) { px(X(1), y, skin); px(X(2), y, skin); }   // 머리 위로 올린 손
  };
  if (leftUp) armUpV(0);
  if (rightUp) armUpV(1);

  // ---- 자동 외곽선
  const out = g.map((r) => r.slice());
  for (let y = 0; y < AV_H; y++) for (let x = 0; x < AV_W; x++) {
    if (g[y][x]) continue;
    if ((g[y - 1] && g[y - 1][x]) || (g[y + 1] && g[y + 1][x]) || g[y][x - 1] || g[y][x + 1]) out[y][x] = AV_OUT;
  }
  return out;
}

const avCache = new Map();
function avatarSprite(a, st = {}) {
  const key = JSON.stringify([a, st.pose, st.eyes, st.mouth, !!st.sweat]);
  let c = avCache.get(key);
  if (c) return c;
  const grid = buildAvatar(a, st);
  c = document.createElement('canvas');
  c.width = AV_W; c.height = AV_H;
  const ctx = c.getContext('2d');
  for (let y = 0; y < AV_H; y++) for (let x = 0; x < AV_W; x++) {
    if (grid[y][x]) { ctx.fillStyle = grid[y][x]; ctx.fillRect(x, y, 1, 1); }
  }
  if (avCache.size > 400) avCache.clear();
  avCache.set(key, c);
  return c;
}
/* (cx, footY) 기준으로 scale배 크기로 그리기 */
function drawAvatar(ctx, a, st, cx, footY, scale) {
  const img = avatarSprite(a, st);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, Math.round(cx - AV_W * scale / 2), Math.round(footY - AV_H * scale), AV_W * scale, AV_H * scale);
}
/* 작은 캔버스(목록용)에 그리기 */
function paintMini(cv, a) {
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, cv.width, cv.height);
  const s = Math.max(1, Math.floor(Math.min(cv.width / AV_W, cv.height / 20)));
  ctx.imageSmoothingEnabled = false;
  // 얼굴 위주로 잘라서 (위쪽 20줄)
  ctx.drawImage(avatarSprite(avatarValid(a), {}), 0, 0, AV_W, 20, Math.round((cv.width - AV_W * s) / 2), Math.round((cv.height - 20 * s) / 2), AV_W * s, 20 * s);
}
function miniHtml(a, size = 28) {
  return `<canvas class="mini-av" width="${size}" height="${size}" data-av="${esc(JSON.stringify(avatarValid(a)))}"></canvas>`;
}
function paintMinis(root = document) {
  $$('canvas.mini-av', root).forEach((cv) => { try { paintMini(cv, JSON.parse(cv.dataset.av)); } catch { /* 무시 */ } });
}

/* ---------------- 플레이 중 리액션하는 캐릭터 (오른쪽 정보 칸의 무대) */
class AvatarStage {
  constructor(cv) { this.cv = cv; this.hitAt = -9999; this.missAt = -9999; this.jumpAt = -9999; this.side = 0; }
  onHit(combo) {
    this.hitAt = performance.now();
    this.side ^= 1;
    if (combo > 0 && combo % 50 === 0) this.jumpAt = performance.now();
  }
  onMiss() { this.missAt = performance.now(); }
  draw({ beat = 0, fever = false, a = settings.avatar, label = '', force = null, bounce = false } = {}) {
    const cv = this.cv;
    if (!cv || !cv.offsetParent) return;
    const dpr = window.devicePixelRatio || 1;
    const r = cv.getBoundingClientRect();
    const w = Math.max(50, Math.floor(r.width)), h = Math.max(50, Math.floor(r.height));
    if (cv.width !== w * dpr || cv.height !== h * dpr) { cv.width = w * dpr; cv.height = h * dpr; }
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const now = performance.now();
    const scale = Math.max(2, Math.min(7, Math.floor((h - 34) / AV_H)));
    const cx = w / 2, floor = h - 18;
    // 바닥 무대
    const fg = ctx.createRadialGradient(cx, floor, 4, cx, floor, AV_W * scale * 0.9);
    fg.addColorStop(0, fever ? 'rgba(255,190,60,0.55)' : 'rgba(77,225,255,0.35)'); fg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = fg;
    ctx.fillRect(cx - AV_W * scale, floor - 20, AV_W * scale * 2, 40);
    let st = { pose: 'idle', mouth: 'smile' };
    let dy = (beat % 2) * scale;               // 박자에 맞춰 까딱
    let dx = 0;
    const miss = now - this.missAt, hit = now - this.hitAt, jump = now - this.jumpAt;
    if (force) { st = force; dy = bounce ? -Math.abs(Math.sin(now / 230)) * scale * 3 : 0; }
    else if (miss < 450) { st = { pose: 'sad', eyes: 'closed', mouth: 'sad', sweat: true }; dx = Math.sin(miss / 25) * scale * 0.6; dy = scale; }
    else if (jump < 500) { st = { pose: 'up', eyes: 'happy', mouth: 'open' }; dy = -Math.sin((jump / 500) * Math.PI) * scale * 8; }
    else if (fever) { st = { pose: beat % 2 ? 'left' : 'right', eyes: 'happy', mouth: 'open' }; }
    else if (hit < 130) { st = { pose: this.side ? 'left' : 'right', mouth: 'open' }; }
    if (fever) {
      for (let i = 0; i < 6; i++) {   // 반짝이
        const t = now / 700 + i;
        const x = cx + Math.cos(t * 1.7 + i) * AV_W * scale * 0.7;
        const y = floor - AV_H * scale * 0.5 + Math.sin(t * 2.3 + i * 2) * AV_H * scale * 0.45;
        ctx.fillStyle = i % 2 ? '#ffc83d' : '#ffffff';
        ctx.fillRect(Math.round(x), Math.round(y), scale, scale);
      }
    }
    drawAvatar(ctx, a, st, cx + dx, floor + dy, scale);
    if (label) {
      ctx.font = '700 12px "Noto Sans KR", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillStyle = 'rgba(220,230,255,0.85)';
      ctx.fillText(label, cx, h - 1);
    }
  }
}

/* ---------------- 캐릭터 만들기 창 */
let avPreview = null, avPrevRaf = 0;
function renderAvatarEditor() {
  const a = settings.avatar;
  const sw = (key, colors) => colors.map((c, i) => `<button class="av-sw${a[key] === i ? ' on' : ''}" data-k="${key}" data-i="${i}" style="--c:${c}"></button>`).join('');
  const opts = (key) => AV_OPTS[key].map(([v, n]) => `<button class="${a[key] === v ? 'on' : ''}" data-k="${key}" data-v="${v}">${esc(n)}</button>`).join('');
  $('#avSkin').innerHTML = sw('skin', AV_OPTS.skin);
  $('#avHair').innerHTML = opts('hair');
  $('#avHairColor').innerHTML = sw('hairColor', AV_OPTS.hairColor);
  $('#avEyes').innerHTML = opts('eyes');
  $('#avOutfit').innerHTML = opts('outfit');
  $('#avOutfitColor').innerHTML = sw('outfitColor', AV_OPTS.outfitColor);
  $('#avAcc').innerHTML = opts('acc');
  $('#avName').textContent = settings.nick || '닉네임을 정해 주세요';
  renderTopAvatar();
}
function renderTopAvatar() {
  const cv = $('#topAvatar');
  if (cv) paintMini(cv, settings.avatar);
}
function avatarChanged() {
  settings.avatar = avatarValid(settings.avatar);
  saveSettings();
  renderAvatarEditor();
  net.send({ type: 'hello', name: settings.nick || '', avatar: settings.avatar, title: typeof achTitle === 'function' ? achTitle() : '', diff: settings.diff, keys: settings.mode });
}
function openAvatar() {
  renderAvatarEditor();
  $('#avatarDlg').showModal();
  if (!avPreview) avPreview = new AvatarStage($('#avCanvas'));
  const t0 = performance.now();
  let lastBeat = -1;
  cancelAnimationFrame(avPrevRaf);
  const step = () => {
    if (!$('#avatarDlg').open) return;
    const t = (performance.now() - t0) / 1000;
    const beat = Math.floor(t / 0.42);
    if (beat !== lastBeat) {      // 데모: 박자마다 치는 동작, 가끔 점프·피버·미스
      lastBeat = beat;
      const ph = beat % 24;
      if (ph === 11) avPreview.onMiss();
      else if (ph === 5) avPreview.jumpAt = performance.now();
      else if (ph < 16 || ph > 20) avPreview.onHit(1);
    }
    avPreview.draw({ beat, fever: beat % 24 >= 16 && beat % 24 <= 20 });
    avPrevRaf = requestAnimationFrame(step);
  };
  avPrevRaf = requestAnimationFrame(step);
}
$('#btnAvatar').addEventListener('click', openAvatar);
$('#avClose').addEventListener('click', () => $('#avatarDlg').close());
$('#avatarDlg').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-k]');
  if (!b) return;
  const k = b.dataset.k;
  settings.avatar[k] = b.dataset.i !== undefined ? +b.dataset.i : b.dataset.v;
  avatarChanged();
});
$('#avRandom').addEventListener('click', () => {
  const r = (n) => Math.floor(Math.random() * n);
  const pickV = (k) => AV_OPTS[k][r(AV_OPTS[k].length)][0];
  settings.avatar = {
    skin: r(AV_OPTS.skin.length), hair: pickV('hair'), hairColor: r(AV_OPTS.hairColor.length), eyes: pickV('eyes'),
    outfit: pickV('outfit'), outfitColor: r(AV_OPTS.outfitColor.length), acc: pickV('acc'),
  };
  avatarChanged();
});
renderTopAvatar();
