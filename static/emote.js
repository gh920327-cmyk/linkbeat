/* 링크비트 이모티콘 — 각자 자기 캐릭터(표정 6개)에 손글씨 대사와 작은 효과를 얹어서 보냄
   멀티 방 채팅 · 멀티 결과 · 구경 중에 보낼 수 있고, 친구 화면엔 그 사람 이름 옆에 통통 튀며 떠요 */
'use strict';

const EMOTES = [
  { id: 'lol', expr: 'smile', text: 'ㅋㅋㅋ', fx: 'haha', anim: 'shake', col: '#ff8a3d' },
  { id: 'go', expr: 'cheer', text: '가자!!', fx: 'burst', anim: 'bounce', col: '#ff4f6d' },
  { id: 'wow', expr: 'oops', text: '헐?!', fx: 'shock', anim: 'wobble', col: '#4d8dff' },
  { id: 'help', expr: 'sad', text: '살려줘…', fx: 'sweat', anim: 'shiver', col: '#5aa8ff' },
  { id: 'nice', expr: 'smile', text: '나이스~', fx: 'sparkle', anim: 'bounce', col: '#2fc07a' },
  { id: 'more', expr: 'cheer', text: '한 판 더!', fx: 'burst', anim: 'bounce', col: '#ff7a1a' },
  { id: 'what', expr: 'oops', text: '뭐야??', fx: 'question', anim: 'tilt', col: '#9a6bff' },
  { id: 'lost', expr: 'sad', text: '졌다…', fx: 'gloom', anim: 'droop', col: '#6b7aa8' },
  { id: 'wink', expr: 'blink', text: '찡긋☆', fx: 'heart', anim: 'tilt', col: '#ff5fa2' },
  { id: 'thx', expr: 'idle', text: '감사해요', fx: 'flower', anim: 'bow', col: '#ff6f9f' },
  { id: 'sorry', expr: 'sad', text: '미안해요..', fx: 'sweat', anim: 'bow', col: '#7a8cc8' },
  { id: 'gg', expr: 'cheer', text: 'GG!', fx: 'sparkle', anim: 'bounce', col: '#ffb800' },
];
const EMO_BY = Object.fromEntries(EMOTES.map((e) => [e.id, e]));
const EMO_FONT = '"Gaegu", "Jua", "Noto Sans KR", sans-serif';
const EMO_PIX = { idle: {}, smile: { eyes: 'happy' }, cheer: { eyes: 'happy', mouth: 'open', pose: 'up' }, oops: { mouth: 'open', sweat: true },
  sad: { mouth: 'sad', pose: 'sad' }, blink: { eyes: 'closed' } };

/* 캐릭터 한 장 (스티커면 표정 칸, 아니면 도트) — 발끝(footY) 기준, 높이 maxH */
function emoteAvatar(ctx, a, expr, cx, footY, maxH) {
  const stk = typeof aiSticker === 'function' ? aiSticker(a) : null;
  if (stk) {
    const n = STK_EXPR.length, fw = stk.width / n, fh = stk.height;
    const h = maxH, w = fw * h / fh, f = Math.max(0, STK_EXPR.indexOf(expr));
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(stk, f * fw, 0, fw, fh, cx - w / 2, footY - h, w, h);
    return;
  }
  const sheet = typeof aiSheet === 'function' ? aiSheet(a) : null;
  ctx.imageSmoothingEnabled = false;
  if (sheet) {
    const fw = Math.round(sheet.width / 5), fh = sheet.height, fi = { cheer: 3, sad: 4, oops: 4 }[expr] || 0, s = maxH / fh;
    ctx.drawImage(sheet, fi * fw, 0, fw, fh, cx - fw * s / 2, footY - fh * s, fw * s, fh * s);
    return;
  }
  const ai = typeof aiPixel === 'function' ? aiPixel(a) : null;
  if (ai) { const s = maxH / ai.height; ctx.drawImage(ai, cx - ai.width * s / 2, footY - ai.height * s, ai.width * s, ai.height * s); return; }
  if (typeof avatarSprite !== 'function') return;
  const img = avatarSprite(a || DEFAULT_AVATAR, EMO_PIX[expr] || {}), s = maxH / AV_H * 0.9;
  ctx.drawImage(img, Math.round(cx - AV_W * s / 2), Math.round(footY - AV_H * s), AV_W * s, AV_H * s);
}

/* 작은 효과들 (캐릭터 주변) */
function emoteFx(ctx, em, w, h, t) {
  const k = (t % 1600) / 1600;
  ctx.save();
  if (em.fx === 'burst') {                      // 뒤에서 퍼지는 노란 빛줄기
    ctx.translate(w / 2, h * 0.62); ctx.rotate(t / 1600);
    ctx.fillStyle = 'rgba(255,214,90,0.45)';
    for (let i = 0; i < 10; i++) { ctx.rotate(Math.PI / 5); ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-w * 0.06, -w * 0.56); ctx.lineTo(w * 0.06, -w * 0.56); ctx.closePath(); ctx.fill(); }
  } else if (em.fx === 'sparkle') {
    for (let i = 0; i < 5; i++) {
      const a = i * 1.26 + t / 900, r = w * (0.36 + 0.06 * Math.sin(t / 200 + i));
      ctx.globalAlpha = 0.5 + 0.5 * Math.sin(t / 110 + i * 2);
      ctx.fillStyle = ['#ffd84d', '#fff3b0', '#9ff6ff'][i % 3];
      ctx.beginPath(); starPath(ctx, w / 2 + Math.cos(a) * r, h * 0.6 + Math.sin(a) * r * 0.7, w * 0.05, w * 0.017, 4); ctx.fill();
    }
  } else if (em.fx === 'sweat') {               // 머리 옆 땀방울
    for (const [dx, dy, d] of [[0.3, 0.42, 0], [0.36, 0.5, 400]]) {
      const kk = ((t + d) % 1200) / 1200;
      const x = w * (0.5 + dx), y = h * (dy + kk * 0.08);
      ctx.globalAlpha = 1 - kk * 0.6;
      ctx.fillStyle = '#7fc8ff'; ctx.strokeStyle = '#2a6fb8'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(x, y - w * 0.06); ctx.quadraticCurveTo(x + w * 0.045, y, x, y + w * 0.035); ctx.quadraticCurveTo(x - w * 0.045, y, x, y - w * 0.06);
      ctx.fill(); ctx.stroke();
    }
  } else if (em.fx === 'question') {
    ctx.font = `900 ${Math.round(w * 0.2)}px ${EMO_FONT}`;
    ctx.fillStyle = '#9a6bff'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 4; ctx.textAlign = 'center';
    for (const [dx, dy, r, d] of [[0.3, 0.46, 0.2, 0], [0.38, 0.34, -0.25, 300]]) {
      const b = Math.sin((t + d) / 220) * w * 0.02;
      ctx.save(); ctx.translate(w * (0.5 + dx), h * dy + b); ctx.rotate(r);
      ctx.strokeText('?', 0, 0); ctx.fillText('?', 0, 0); ctx.restore();
    }
  } else if (em.fx === 'gloom') {               // 머리 위 우울 줄
    ctx.strokeStyle = 'rgba(70,90,150,0.6)'; ctx.lineWidth = Math.max(1.5, w * 0.018);
    for (let i = 0; i < 5; i++) {
      const x = w * (0.32 + i * 0.09), y0 = h * 0.3 + ((t / 30 + i * 9) % 12);
      ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y0 + h * 0.13); ctx.stroke();
    }
  } else if (em.fx === 'heart' || em.fx === 'flower') {
    for (let i = 0; i < 3; i++) {
      const kk = ((t + i * 520) % 1560) / 1560;
      const x = w * (0.22 + i * 0.28) + Math.sin(kk * 6 + i) * w * 0.03, y = h * (0.78 - kk * 0.4);
      ctx.globalAlpha = Math.min(1, (1 - kk) * 1.6);
      if (em.fx === 'heart') { ctx.fillStyle = '#ff5fa2'; ctx.beginPath(); heartPath(ctx, x, y, w * 0.05); ctx.fill(); }
      else {
        ctx.fillStyle = '#ffb3d1';
        for (let p = 0; p < 5; p++) { const a = p * 1.257; ctx.beginPath(); ctx.arc(x + Math.cos(a) * w * 0.028, y + Math.sin(a) * w * 0.028, w * 0.022, 0, Math.PI * 2); ctx.fill(); }
        ctx.fillStyle = '#ffd84d'; ctx.beginPath(); ctx.arc(x, y, w * 0.018, 0, Math.PI * 2); ctx.fill();
      }
    }
  } else if (em.fx === 'shock') {               // 놀람 줄 (양옆)
    ctx.strokeStyle = '#4d8dff'; ctx.lineWidth = Math.max(2, w * 0.022); ctx.lineCap = 'round';
    const p = 1 + 0.15 * Math.sin(t / 70);
    for (const sx of [-1, 1]) for (const a of [-0.5, 0, 0.5]) {
      const cx = w / 2 + sx * w * 0.3, cy = h * 0.5;
      ctx.beginPath(); ctx.moveTo(cx + sx * Math.cos(a) * w * 0.05 * p, cy + Math.sin(a) * w * 0.08);
      ctx.lineTo(cx + sx * Math.cos(a) * w * 0.13 * p, cy + Math.sin(a) * w * 0.17); ctx.stroke();
    }
  } else if (em.fx === 'haha') {                // 웃음 줄 (양옆에 작은 ㅋ)
    ctx.font = `900 ${Math.round(w * 0.13)}px ${EMO_FONT}`; ctx.textAlign = 'center';
    ctx.fillStyle = '#ff8a3d'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 3;
    for (const [dx, dy, d] of [[-0.36, 0.56, 0], [0.36, 0.48, 200], [0.32, 0.7, 400]]) {
      const b = Math.abs(Math.sin((t + d) / 130)) * w * 0.03;
      ctx.strokeText('ㅋ', w * (0.5 + dx), h * dy - b); ctx.fillText('ㅋ', w * (0.5 + dx), h * dy - b);
    }
  }
  ctx.restore();
  return k;
}

/* 이모티콘 한 장 그리기: 캔버스(CSS 크기 w×h) · t = 보낸 뒤 지난 ms (0이면 멈춘 그림) */
function drawEmote(cv, a, emId, t = 0, still = false) {
  const em = EMO_BY[emId] || EMOTES[0];
  const dpr = window.devicePixelRatio || 1;
  const w = cv.clientWidth || cv.width / dpr, h = cv.clientHeight || cv.height / dpr;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const tt = still ? 700 : t;
  if (!still) emoteFx(ctx, em, w, h, tt);
  else if (['burst', 'gloom', 'shock'].includes(em.fx)) emoteFx(ctx, em, w, h, 0);
  // 들어올 때 통! (조금 크게 → 제자리)
  const pop = still ? 1 : tt < 180 ? 0.55 + (tt / 180) * 0.6 : tt < 320 ? 1.15 - ((tt - 180) / 140) * 0.15 : 1;
  let dx = 0, dy = 0, rot = 0, sy = 1;
  if (!still) {
    if (em.anim === 'shake') dx = Math.sin(tt / 38) * w * 0.025;
    else if (em.anim === 'bounce') dy = -Math.abs(Math.sin(tt / 170)) * h * 0.06;
    else if (em.anim === 'wobble') rot = Math.sin(tt / 60) * 0.07 * Math.max(0, 1 - tt / 1500);
    else if (em.anim === 'shiver') dx = Math.sin(tt / 25) * w * 0.012;
    else if (em.anim === 'tilt') rot = Math.sin(tt / 260) * 0.09;
    else if (em.anim === 'droop') sy = 0.96 + 0.02 * Math.sin(tt / 400);
    else if (em.anim === 'bow') rot = Math.max(0, Math.sin(tt / 380)) * 0.12;
  }
  ctx.save();
  ctx.translate(w / 2 + dx, h * 0.98 + dy);
  ctx.rotate(rot);
  ctx.scale(pop, pop * sy);
  emoteAvatar(ctx, a, em.expr, 0, 0, h * 0.74);
  ctx.restore();
  // 손글씨 대사 (흰 테두리 + 색)
  ctx.save();
  const jamo = /^[ㄱ-ㅎㅏ-ㅣ]+$/.test(em.text);           // 'ㅋㅋㅋ'처럼 자음만이면 글꼴에서 작게 나와서 크게
  const fs = Math.round(h * (jamo ? 0.36 : em.text.length > 5 ? 0.2 : 0.25));
  ctx.font = `700 ${fs}px ${EMO_FONT}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const tp = still ? 1 : Math.min(1, tt / 220);
  ctx.translate(w / 2, h * 0.15);
  ctx.rotate(-0.06 + (em.anim === 'shake' && !still ? Math.sin(tt / 50) * 0.03 : 0));
  ctx.scale(0.7 + 0.3 * tp, 0.7 + 0.3 * tp);
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(4, fs * 0.32); ctx.strokeStyle = '#ffffff'; ctx.strokeText(em.text, 0, 0);
  ctx.lineWidth = Math.max(1.5, fs * 0.08); ctx.strokeStyle = '#2b2233'; ctx.strokeText(em.text, 0, 0);
  ctx.fillStyle = em.col; ctx.fillText(em.text, 0, 0);
  ctx.restore();
}

/* ------------------------------------------------------------ 고르기 창 */
let emoCtx = null;     // 지금 열린 창이 어디서 열렸는지 (room | result | watch)
function emoMyAvatar() { return settings.avatar || DEFAULT_AVATAR; }
function openEmotePal(anchor, where) {
  const pal = $('#emoPal');
  if (!pal.classList.contains('hidden') && emoCtx === where) { pal.classList.add('hidden'); return; }
  emoCtx = where;
  const host = anchor.closest('dialog') || document.body;     // 창(dialog) 안에서 열면 그 창 안에 (창 뒤에 가려지지 않게)
  if (pal.parentElement !== host) host.appendChild(pal);
  pal.innerHTML = EMOTES.map((e) => `<button type="button" class="emo-pick" data-e="${e.id}" title="${esc(e.text)}"><canvas></canvas></button>`).join('');
  if (typeof popAt === 'function') popAt(pal, anchor); else pal.classList.remove('hidden');
  const paint = () => $$('.emo-pick', pal).forEach((b) => drawEmote($('canvas', b), emoMyAvatar(), b.dataset.e, 0, true));
  paint();
  setTimeout(paint, 400);       // 스티커 그림을 늦게 받으면 한 번 더
}
let emoLast = 0;
function sendEmote(id) {
  if (!net.room) { toast('방에 있을 때 보낼 수 있어요.'); return; }
  if (performance.now() - emoLast < 1200) return;      // 너무 자주 못 보냄
  emoLast = performance.now();
  net.send({ type: 'emote', e: id });
  $('#emoPal').classList.add('hidden');
}
$('#emoPal').addEventListener('click', (e) => {
  const b = e.target.closest('.emo-pick');
  if (b) sendEmote(b.dataset.e);
});
document.addEventListener('click', (e) => { if (!e.target.closest('#emoPal, .emo-open')) $('#emoPal').classList.add('hidden'); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#emoPal').classList.contains('hidden')) { $('#emoPal').classList.add('hidden'); e.stopPropagation(); } }, true);
for (const [sel, where] of [['#emoBtn', 'room'], ['#rEmoBtn', 'result'], ['#wEmoBtn', 'watch']]) {
  const b = $(sel);
  if (b) b.addEventListener('click', (e) => { e.stopPropagation(); openEmotePal(e.currentTarget, where); });
}

/* ------------------------------------------------------------ 받았을 때 */
const emoAnims = new Set();     // 움직이는 이모티콘 캔버스들 (잠깐 움직이다 멈춤)
let emoRaf = 0;
function emoAnimate(cv, a, id, life = 2600) {
  emoAnims.add({ cv, a, id, at: performance.now(), life });
  if (!emoRaf) {
    const step = () => {
      const now = performance.now();
      for (const it of emoAnims) {
        const t = now - it.at;
        if (!it.cv.isConnected || t > it.life) { if (it.cv.isConnected) drawEmote(it.cv, it.a, it.id, 0, true); emoAnims.delete(it); continue; }
        drawEmote(it.cv, it.a, it.id, t);
      }
      emoRaf = emoAnims.size ? requestAnimationFrame(step) : 0;
    };
    emoRaf = requestAnimationFrame(step);
  }
}
function emoAvatarOf(id) {
  const all = net.room ? [...(net.room.players || []), ...(net.room.watchers || [])] : [];
  const p = all.find((x) => String(x.id) === String(id));
  if (p && p.avatar) return p.avatar;
  return String(id) === String(net.id) ? emoMyAvatar() : DEFAULT_AVATAR;
}
/* 채팅에 이모티콘 */
function addEmoteChat(m, a) {
  const log = $('#chatLog');
  if (!log) return;
  const div = document.createElement('div');
  div.className = 'emo-chat';
  div.innerHTML = `<b>${esc(m.name)}</b><canvas class="emo-cv"></canvas>`;
  log.appendChild(div);
  while (log.children.length > 100) log.firstChild.remove();
  log.scrollTop = log.scrollHeight;
  emoAnimate($('canvas', div), a, m.e, 2400);
}
/* 이름 옆(보이는 목록)이나 왼쪽 아래에 크게 잠깐 */
function floatEmote(m, a) {
  const playing = typeof game !== 'undefined' && game && ['playing', 'countdown', 'preroll', 'waitVideo'].includes(game.phase) && currentScreen === 'game';
  const rows = $$(`[data-pl="${CSS.escape(String(m.id))}"]`).filter((el) => el.offsetParent && el.closest('#liveBoard, #rMultiList, #wBoard, #roomPlayers'));
  const lb = $('#liveBoard');
  const anchor = rows[0] || (playing && lb && lb.offsetParent ? lb : null);    // 구경꾼 응원은 순위표 옆에
  if (!anchor && playing) return;                     // 플레이 중엔 옆 순위표에만 (판정 화면을 가리지 않게)
  if (!anchor && currentScreen === 'lobby') return;   // 방 화면은 채팅에 나오니까 됨
  const box = document.createElement('div');
  box.className = 'emo-float' + (anchor ? ' at' : '') + (playing ? ' small' : '');
  box.innerHTML = `<canvas class="emo-cv"></canvas><span class="emo-who">${esc(m.name)}</span>`;
  ((anchor && anchor.closest('dialog')) || document.body).appendChild(box);
  if (anchor) {
    const r = anchor.getBoundingClientRect(), bw = playing ? 76 : 112;
    let x = r.right + 6;
    if (x + bw > window.innerWidth - 6) x = Math.max(6, r.left - bw - 6);
    box.style.left = `${Math.round(x)}px`;
    box.style.top = `${Math.round(Math.max(6, Math.min(window.innerHeight - bw - 30, r.top + r.height / 2 - bw / 2)))}px`;
  } else {
    const n = $$('.emo-float:not(.at)').length - 1;
    box.style.left = '16px';
    box.style.bottom = `${16 + n * 132}px`;
  }
  emoAnimate($('canvas', box), a, m.e, 2600);
  setTimeout(() => box.classList.add('out'), 2600);
  setTimeout(() => box.remove(), 3000);
}
net.on('emote', (m) => {
  if (!EMO_BY[m.e]) return;
  const a = emoAvatarOf(m.id);
  addEmoteChat(m, a);
  floatEmote(m, a);
  if (String(m.id) !== String(net.id) && !(typeof game !== 'undefined' && game && game.phase === 'playing')) sfx.tick(0.15, 1800);
});
