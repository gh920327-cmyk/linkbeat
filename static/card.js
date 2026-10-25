/* 링크비트 결과 카드: 결과 화면의 등급·점수·판정·내 일러스트(캐릭터)를 1080×1350 그림 한 장으로 — 저장 · 공유 · 복사 */
'use strict';

const CARD_W = 1080, CARD_H = 1350;
const RANK_COL = { SSS: '#ffe36b', SS: '#ffc83d', S: '#ffc83d', A: '#4dffa6', B: '#4de1ff', C: '#b98cff', D: '#ff5a72' };
const JUDGE_COL = { perfect: '#ffe45e', great: '#5effa1', good: '#5ec8ff', miss: '#ff5a6e' };

function cardImg(src, cors) {
  return new Promise((resolve) => {
    const im = new Image();
    if (cors) im.crossOrigin = 'anonymous';
    im.onload = () => resolve(im);
    im.onerror = () => resolve(null);
    im.src = src;
    setTimeout(() => resolve(null), 6000);
  });
}
function cardRound(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
/* 줄이 넘치면 줄바꿈 (최대 lines줄, 넘치면 …) */
function cardWrap(ctx, text, x, y, maxW, lh, lines) {
  const words = String(text).split('');
  let line = '', n = 0;
  for (let i = 0; i < words.length; i++) {
    const test = line + words[i];
    if (ctx.measureText(test).width > maxW && line) {
      if (n === lines - 1) {
        while (line && ctx.measureText(line + '…').width > maxW) line = line.slice(0, -1);
        ctx.fillText(line + '…', x, y + n * lh);
        return n + 1;
      }
      ctx.fillText(line, x, y + n * lh);
      line = words[i]; n++;
    } else line = test;
  }
  ctx.fillText(line, x, y + n * lh);
  return n + 1;
}

async function drawResultCard(g, r, withThumb = true) {
  const cv = document.createElement('canvas');
  cv.width = CARD_W; cv.height = CARD_H;
  const ctx = cv.getContext('2d');
  try { await Promise.all(['900 italic 100px Saira', '800 60px Saira', '800 40px "Noto Sans KR"', '900 40px Orbitron'].map((f) => document.fonts.load(f))); } catch { /* 무시 */ }
  const a = avatarValid(settings.avatar);
  const rk = r.rank;
  const c = r.counts || {};
  const ap = !r.incomplete && c.miss === 0 && c.good === 0 && c.great === 0;

  // 바탕: 곡 썸네일을 흐리게 + 어두운 그라데이션
  const bg = ctx.createLinearGradient(0, 0, 0, CARD_H);
  bg.addColorStop(0, '#0d1430'); bg.addColorStop(1, '#04060d');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, CARD_W, CARD_H);
  if (withThumb) {
    const th = await cardImg(`https://i.ytimg.com/vi/${g.song.id}/hqdefault.jpg`, true);
    if (th) {
      ctx.save();
      ctx.filter = 'blur(26px) brightness(0.5) saturate(1.2)';
      const s = Math.max(CARD_W / th.width, CARD_H / th.height) * 1.15;
      ctx.drawImage(th, (CARD_W - th.width * s) / 2, (CARD_H - th.height * s) / 2, th.width * s, th.height * s);
      ctx.restore();
      ctx.fillStyle = 'rgba(4, 6, 13, .35)'; ctx.fillRect(0, 0, CARD_W, CARD_H);
    }
  }
  const glow = ctx.createRadialGradient(CARD_W * 0.75, CARD_H * 0.45, 40, CARD_W * 0.75, CARD_H * 0.45, 620);
  glow.addColorStop(0, rk === 'MAX' ? 'rgba(255,140,255,.28)' : 'rgba(77,225,255,.18)'); glow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glow; ctx.fillRect(0, 0, CARD_W, CARD_H);

  // 위: 로고 · 날짜
  ctx.textBaseline = 'alphabetic';
  const lg = ctx.createLinearGradient(60, 0, 420, 0);
  lg.addColorStop(0, '#3f8cff'); lg.addColorStop(1, '#4de1ff');
  ctx.fillStyle = lg; ctx.font = '900 46px Orbitron, Saira, sans-serif';
  ctx.fillText('LINKBEAT', 60, 100);
  const d = new Date();
  ctx.fillStyle = 'rgba(233,238,252,.6)'; ctx.font = '700 28px Saira, sans-serif'; ctx.textAlign = 'right';
  ctx.fillText(`${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`, CARD_W - 60, 100);
  ctx.textAlign = 'left';

  // 곡 제목 · 가수 · 칩
  ctx.fillStyle = '#ffffff'; ctx.font = '800 56px "Noto Sans KR", sans-serif';
  const tl = cardWrap(ctx, g.song.title, 60, 200, CARD_W - 120, 68, 2);
  let y = 200 + tl * 68 - 14;
  ctx.fillStyle = 'rgba(233,238,252,.65)'; ctx.font = '500 32px "Noto Sans KR", sans-serif';
  ctx.fillText(typeof artistOf === 'function' ? artistOf(songById(g.song.id) || g.song) : (g.song.artist || ''), 60, y + 10);
  y += 50;
  const chips = [`${g.nl}KEY`, DIFF_EN[g.diff] || g.diff, `★${(g.stars || 0).toFixed(1)}`];
  if (g.ai) chips.push('AI 채보');
  if (g.hl) chips.push('HIGHLIGHT');
  let cx = 60;
  ctx.font = '800 26px Saira, "Noto Sans KR", sans-serif';
  for (const t of chips) {
    const w = ctx.measureText(t).width + 30;
    ctx.fillStyle = t === `${g.nl}KEY` ? '#3f8cff' : 'rgba(255,255,255,.12)';
    cardRound(ctx, cx, y, w, 44, 6); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.fillText(t, cx + 15, y + 32);
    cx += w + 10;
  }

  // 오른쪽: 내 일러스트 (없으면 캐릭터)
  const artX = 560, artY = 420, artW = 470, artH = 600;
  const ilUrl = aiIllustUrl(a);
  let drew = false;
  if (ilUrl) {
    const il = await cardImg(ilUrl, false);
    if (il) {
      ctx.save();
      cardRound(ctx, artX, artY, artW, artH, 22); ctx.clip();
      const s = Math.max(artW / il.width, artH / il.height);
      ctx.drawImage(il, artX + (artW - il.width * s) / 2, artY, il.width * s, il.height * s);
      const fade = ctx.createLinearGradient(0, artY + artH * 0.6, 0, artY + artH);
      fade.addColorStop(0, 'rgba(4,6,13,0)'); fade.addColorStop(1, 'rgba(4,6,13,.75)');
      ctx.fillStyle = fade; ctx.fillRect(artX, artY, artW, artH);
      ctx.restore();
      ctx.strokeStyle = rk === 'MAX' ? '#ff9de0' : 'rgba(77,225,255,.6)'; ctx.lineWidth = 4;
      cardRound(ctx, artX, artY, artW, artH, 22); ctx.stroke();
      drew = true;
    }
  }
  if (!drew && a.ai && a.aiUse !== 'off') {       // 스티커 (등급에 따라 표정)
    const sk = await cardImg(`/avatars/${a.ai}_x.webp`, false);
    if (sk) {
      const n = STK_EXPR.length, good = ['MAX', 'SSS', 'SS', 'S'].includes(rk), bad = r.incomplete || rk === 'C' || rk === 'D';
      const f = Math.max(0, STK_EXPR.indexOf(good ? 'cheer' : bad ? 'sad' : 'smile'));
      const fw = sk.width / n, s = Math.min(artW / fw, artH / sk.height);
      ctx.drawImage(sk, f * fw, 0, fw, sk.height, artX + (artW - fw * s) / 2, artY + artH - sk.height * s, fw * s, sk.height * s);
      drew = true;
    } else {
      const px = await cardImg(`/avatars/${a.ai}_p.png`, false);
      if (px) {
        ctx.imageSmoothingEnabled = false;
        const s = Math.min(artW / px.width, artH / px.height);
        ctx.drawImage(px, artX + (artW - px.width * s) / 2, artY + artH - px.height * s, px.width * s, px.height * s);
        ctx.imageSmoothingEnabled = true;
        drew = true;
      }
    }
  }
  if (!drew) {          // 직접 꾸민 도트
    try {
      const parts = Object.assign({}, a); delete parts.ai;
      const good = ['MAX', 'SSS', 'SS', 'S'].includes(rk);
      const sp = avatarSprite(parts, good ? { pose: 'up', eyes: 'happy', mouth: 'open' } : { pose: 'idle' });
      ctx.imageSmoothingEnabled = false;
      const s = Math.floor(Math.min(artW / AV_W, artH / AV_H));
      ctx.drawImage(sp, artX + (artW - AV_W * s) / 2, artY + artH - AV_H * s, AV_W * s, AV_H * s);
      ctx.imageSmoothingEnabled = true;
    } catch { /* 무시 */ }
  }

  // 왼쪽: 등급 · 점수 · 정확도 · 콤보
  ctx.save();
  ctx.font = 'italic 900 250px Saira, sans-serif';
  if (rk === 'MAX') {
    const rg = ctx.createLinearGradient(60, 0, 520, 0);
    ['#ff6bd5', '#ffd45e', '#5effc8', '#6bb8ff'].forEach((col, i) => rg.addColorStop(i / 3, col));
    ctx.fillStyle = rg;
  } else ctx.fillStyle = RANK_COL[rk] || '#fff';
  ctx.shadowColor = rk === 'MAX' ? 'rgba(255,180,255,.7)' : (RANK_COL[rk] || '#fff'); ctx.shadowBlur = 40;
  ctx.fillText(r.incomplete ? '-' : rk, 50, 640);
  ctx.restore();
  ctx.fillStyle = '#fff'; ctx.font = '800 96px Saira, sans-serif';
  ctx.fillText((r.score || 0).toLocaleString(), 60, 760);
  ctx.font = '700 34px "Noto Sans KR", sans-serif'; ctx.fillStyle = 'rgba(233,238,252,.7)';
  ctx.fillText('정확도', 64, 830); ctx.fillText('최대 콤보', 300, 830);
  ctx.font = '800 54px Saira, sans-serif'; ctx.fillStyle = '#fff';
  ctx.fillText(`${(r.acc || 0).toFixed(2)}%`, 60, 892); ctx.fillText(String(r.maxCombo || 0), 296, 892);
  if (!r.incomplete && (ap || r.fc)) {
    ctx.font = 'italic 900 46px Saira, sans-serif';
    const bt = ap ? 'ALL PERFECT' : 'FULL COMBO';
    const bw = ctx.measureText(bt).width + 44;
    const bgc = ctx.createLinearGradient(60, 0, 60 + bw, 0);
    bgc.addColorStop(0, ap ? '#ffd45e' : '#4de1ff'); bgc.addColorStop(1, ap ? '#ff9de0' : '#3f8cff');
    ctx.fillStyle = bgc; cardRound(ctx, 60, 930, bw, 70, 10); ctx.fill();
    ctx.fillStyle = '#0b0618'; ctx.fillText(bt, 82, 983);
  }

  // 판정 개수
  const ks = ['perfect', 'great', 'good', 'miss'];
  const bx = 60, by = 1070, bw2 = (CARD_W - 120 - 30) / 4;
  ks.forEach((k, i) => {
    const x = bx + i * (bw2 + 10);
    ctx.fillStyle = 'rgba(255,255,255,.07)'; cardRound(ctx, x, by, bw2, 110, 12); ctx.fill();
    ctx.fillStyle = JUDGE_COL[k]; ctx.font = '800 24px Saira, sans-serif';
    ctx.fillText(k.toUpperCase(), x + 20, by + 40);
    ctx.fillStyle = '#fff'; ctx.font = '800 48px Saira, sans-serif';
    ctx.fillText(String(c[k] || 0), x + 20, by + 92);
  });

  // 아래: 이름 · 레벨 · 칭호
  const lv = typeof myLevel === 'function' ? myLevel() : 0;
  const title = typeof achTitle === 'function' ? achTitle() : '';
  let nx = 60;
  const ny = 1265;
  if (lv) {
    ctx.font = '800 30px Saira, sans-serif';
    const t = `Lv${lv}`, w = ctx.measureText(t).width + 22;
    ctx.strokeStyle = '#4de1ff'; ctx.lineWidth = 2; cardRound(ctx, nx, ny - 32, w, 42, 6); ctx.stroke();
    ctx.fillStyle = '#4de1ff'; ctx.fillText(t, nx + 11, ny);
    nx += w + 14;
  }
  if (title) {
    ctx.font = '800 28px "Noto Sans KR", sans-serif';
    const legend = typeof achIsLegend === 'function' && achIsLegend(title);
    const t = (legend ? '✦ ' : '') + title, w = ctx.measureText(t).width + 26;
    if (legend) { const tg = ctx.createLinearGradient(nx, 0, nx + w, 0); ['#ff4fd8', '#ffcf4d', '#4dffc3', '#4da6ff'].forEach((col, i) => tg.addColorStop(i / 3, col)); ctx.fillStyle = tg; }
    else ctx.fillStyle = '#ffc83d';
    cardRound(ctx, nx, ny - 32, w, 42, 6); ctx.fill();
    ctx.fillStyle = legend ? '#fff' : '#0b0618'; ctx.fillText(t, nx + 13, ny - 1);
    nx += w + 14;
  }
  ctx.fillStyle = '#fff'; ctx.font = '800 40px "Noto Sans KR", sans-serif';
  ctx.fillText(settings.nick || '이름없음', nx, ny + 2);
  ctx.fillStyle = 'rgba(233,238,252,.45)'; ctx.font = '600 24px "Noto Sans KR", sans-serif'; ctx.textAlign = 'right';
  ctx.fillText('LINKBEAT · 유튜브 링크 리듬게임', CARD_W - 60, ny + 2);
  ctx.textAlign = 'left';
  return cv;
}

let cardBlob = null;
async function openResultCard() {
  if (!lastResult) return;
  const { g, r } = lastResult;
  $('#cardMsg').textContent = '카드를 만드는 중...';
  $('#cardImg').removeAttribute('src');
  if (!$('#cardDlg').open) $('#cardDlg').showModal();
  let cv = await drawResultCard(g, r, true);
  try { cv.toDataURL(); } catch { cv = await drawResultCard(g, r, false); }      // 썸네일 때문에 저장이 막히면 썸네일 없이
  cardBlob = await new Promise((res) => cv.toBlob(res, 'image/png'));
  $('#cardImg').src = URL.createObjectURL(cardBlob);
  const file = new File([cardBlob], 'linkbeat.png', { type: 'image/png' });
  $('#cardShare').classList.toggle('hidden', !(navigator.canShare && navigator.canShare({ files: [file] })));
  $('#cardCopy').classList.toggle('hidden', !(navigator.clipboard && window.ClipboardItem));
  $('#cardMsg').textContent = '저장해서 단톡방에 올려 보세요!';
}
function cardName() {
  const { g, r } = lastResult;
  return `LINKBEAT_${String(g.song.title).replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 40)}_${r.rank}.png`;
}
$('#btnCard').addEventListener('click', openResultCard);
$('#cardClose').addEventListener('click', () => $('#cardDlg').close());
$('#cardSave').addEventListener('click', () => {
  if (!cardBlob) return;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(cardBlob);
  a.download = cardName();
  document.body.appendChild(a); a.click(); a.remove();
  $('#cardMsg').textContent = '저장했어요.';
});
$('#cardShare').addEventListener('click', async () => {
  if (!cardBlob) return;
  try { await navigator.share({ files: [new File([cardBlob], cardName(), { type: 'image/png' })], title: 'LINKBEAT 결과' }); } catch { /* 취소 */ }
});
$('#cardCopy').addEventListener('click', async () => {
  if (!cardBlob) return;
  try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': cardBlob })]); $('#cardMsg').textContent = '복사했어요. 채팅창에 붙여넣기(Ctrl+V) 하면 돼요.'; } catch { $('#cardMsg').textContent = '복사하지 못했어요. 저장을 눌러 주세요.'; }
});
