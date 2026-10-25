/* 📊 올해 결산 — 한 장씩 넘겨 보는 슬라이드 + 마지막에 요약 이미지 저장
   서버가 모아 둔 그해 기록(오늘부터 쌓임) + 예전 기록(곡별 판수·최고 기록·출석·♪)으로 보여 줘요 */
'use strict';

let wrapData = null, wrapIdx = 0, wrapRaf = 0, wrapShownAt = 0;
const W_EXPR = ['cheer', 'smile', 'cheer', 'cheer', 'blink', 'smile', 'cheer', 'smile'];
const W_DIFF = { easy: '쉬움', normal: '보통', hard: '어려움', extreme: '극한' };
const isDecember = () => { const d = new Date(); return d.getMonth() === 11 || (d.getMonth() === 0 && d.getDate() <= 7); };

function fmtHM(sec) {
  const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
  return h ? `${h}시간 ${m}분` : `${m}분`;
}
function hourType(hours) {
  const sum = (a, b) => hours.slice(a, b).reduce((s, x) => s + x, 0);
  const g = [['새벽형', sum(0, 6), '🦉'], ['아침형', sum(6, 12), '🌅'], ['낮', sum(12, 18), '☀️'], ['저녁형', sum(18, 24), '🌙']];
  const tot = g.reduce((s, x) => s + x[1], 0);
  if (!tot) return null;
  g.sort((a, b) => b[1] - a[1]);
  const peak = hours.indexOf(Math.max(...hours));
  return { name: g[0][0] === '낮' ? '한낮의' : g[0][0], ico: g[0][2], peak, tot };
}
/* 숫자가 0부터 올라가는 연출 */
function countUp(root) {
  $$('[data-n]', root).forEach((el) => {
    const n = +el.dataset.n, t0 = performance.now(), dur = 900;
    const step = (now) => { const k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3); el.textContent = Math.round(n * e).toLocaleString(); if (k < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  });
}
function wrapSlides(d) {
  const nick = esc(d.me.nick);
  const since = d.tracked < d.plays ? '<p class="w-foot">시간·노트·시간대는 10월 26일부터 모은 기록이에요</p>' : '';
  const ht = hourType(d.hours || []);
  const top = d.top || [];
  const ranks = d.ranks || {};
  const big = (n, unit = '') => `<b class="w-big" data-n="${n}">0</b>${unit ? `<span class="w-unit">${unit}</span>` : ''}`;
  const thumb = (id, cls = '') => `<img class="w-thumb ${cls}" src="https://i.ytimg.com/vi/${esc(id)}/mqdefault.jpg" alt="">`;
  const S = [];
  S.push(`<div class="w-kicker">${d.year} LINKBEAT</div><h2 class="w-title">${nick} 님의<br>${isDecember() ? '한 해 결산' : '올해 결산 (지금까지)'}</h2>
    <p class="w-sub">올해 어떤 노래를 얼마나 쳤는지 같이 돌아봐요 🎶</p><p class="w-hint">→ 키나 '다음'으로 넘겨요</p>`);
  S.push(`<div class="w-kicker">올해 친 판수</div><div class="w-num">${big(d.plays, '판')}</div>
    <p class="w-sub">${d.secs ? `<b>${fmtHM(d.secs)}</b> 동안 · 노트 <b>${d.notes.toLocaleString()}</b>개를 쳤어요` : '곡을 끝까지 친 판을 세었어요'}</p>
    <p class="w-sub">쳐 본 곡 <b>${d.songCount}</b>곡${d.days ? ` · 플레이한 날 <b>${d.days}</b>일` : ''}</p>${d.plays ? '' : '<p class="w-sub">아직 끝까지 친 곡이 없어요. 한 곡 쳐 볼까요? 🎮</p>'}${since}`);
  S.push(top.length ? `<div class="w-kicker">가장 많이 친 곡</div>${thumb(top[0].id, 'w-thumb-big')}<h3 class="w-song">${esc(top[0].title)}</h3>
    <p class="w-sub"><b>${top[0].n}</b>번이나 쳤어요 💗</p>
    <ol class="w-list">${top.slice(1).map((s, i) => `<li><span class="w-r">${i + 2}</span>${thumb(s.id)}<span class="w-t">${esc(s.title)}</span><span class="w-c">${s.n}번</span></li>`).join('')}</ol>`
    : '<div class="w-kicker">가장 많이 친 곡</div><h3 class="w-song">아직 기록이 없어요</h3><p class="w-sub">한 곡 끝까지 쳐 보세요!</p>');
  const rk = ['MAX', 'SSS', 'SS', 'S'].map((k) => ranks[k] ? `<span class="w-rk rank-${k}">${k} <b>${ranks[k]}</b></span>` : '').join('');
  S.push(`<div class="w-kicker">최고의 순간</div><div class="w-grid">
    <div><small>최고 콤보</small>${big(d.maxCombo)}</div><div><small>풀콤보</small>${big(d.fc, '번')}</div>
    <div><small>ALL PERFECT</small>${big(d.ap, '번')}</div><div><small>PERFECT</small>${big(d.perfect)}</div></div>
    ${rk ? `<p class="w-sub">내 기록 등급</p><div class="w-ranks">${rk}</div>` : ''}`);
  if (ht) {
    const mx = Math.max(...d.hours, 1);
    S.push(`<div class="w-kicker">주로 치는 시간</div><h3 class="w-song">${ht.ico} ${ht.name} 리듬러</h3>
      <p class="w-sub">가장 많이 친 시간은 <b>${ht.peak}시</b>대예요</p>
      <div class="w-hours">${d.hours.map((v, h) => `<i style="height:${Math.round((v / mx) * 100)}%" title="${h}시 · ${v}판"${h === ht.peak ? ' class="pk"' : ''}></i>`).join('')}</div>
      <div class="w-hlab"><span>0시</span><span>6시</span><span>12시</span><span>18시</span><span>24시</span></div>${since}`);
  } else S.push('<div class="w-kicker">주로 치는 시간</div><h3 class="w-song">🕐 아직 모으는 중</h3><p class="w-sub">오늘부터 친 시간을 모으고 있어요. 다음에 다시 보면 나와요!</p>');
  const pt = d.partners || [];
  const ch = d.me.chal || { w: 0, l: 0 };
  S.push(`<div class="w-kicker">같이 한 친구</div>${pt.length ? `<h3 class="w-song">💞 단짝은 ${esc(pt[0].name)} 님</h3><p class="w-sub">멀티로 <b>${pt[0].n}</b>판 같이 했어요</p>
    ${pt.length > 1 ? `<p class="w-sub">${pt.slice(1).map((p) => `${esc(p.name)} ${p.n}판`).join(' · ')}</p>` : ''}`
    : `<h3 class="w-song">🎧 혼자서도 잘했어요</h3><p class="w-sub">${d.multi ? `멀티 ${d.multi}판` : '다음엔 📣 같이 하자 벨로 친구를 불러 보세요'}</p>`}
    <p class="w-sub">도전장 ${ch.w}승 ${ch.l}패${d.me.champ ? ` · 주간 리그 우승 ${d.me.champ}번 🏆` : ''}</p>`);
  const r = d.rank || {};
  S.push(`<div class="w-kicker">친구들 사이에서</div><div class="w-grid">
    <div><small>판수 순위</small><b class="w-big">${r.plays || '-'}</b><span class="w-unit">위 / ${r.of || 1}명</span></div>
    <div><small>경험치 순위</small><b class="w-big">${r.xp || '-'}</b><span class="w-unit">위 / ${r.xpOf || 1}명</span></div>
    <div><small>레벨</small><b class="w-big">Lv${d.me.lv}</b></div><div><small>모은 ♪</small>${big(d.me.earned)}</div></div>
    <p class="w-sub">최고 연속 출석 <b>${d.me.streakBest}</b>일 · 모은 꾸미기 <b>${d.me.owned}</b>개</p>`);
  S.push(`<div class="w-kicker">${d.year} 요약</div><h3 class="w-song">${nick} 님, 올해도 리듬 최고! 🎉</h3>
    <div class="w-sum"><span>🎮 <b>${d.plays.toLocaleString()}</b>판</span><span>🎵 <b>${d.songCount}</b>곡</span><span>🔥 최고 <b>${d.maxCombo.toLocaleString()}</b> 콤보</span>
    <span>⭐ 풀콤보 <b>${d.fc}</b></span><span>💗 ${top[0] ? esc(top[0].title) : '-'}</span><span>${ht ? `${ht.ico} ${ht.name}` : '🕐 -'}</span></div>
    <button type="button" class="primary" id="wrapSave">🖼 이미지로 저장</button>`);
  return S;
}
function renderWrap() {
  if (!wrapData) return;
  const S = wrapData.slides;
  wrapIdx = clamp(wrapIdx, 0, S.length - 1);
  const sl = $('#wrapSlide');
  sl.innerHTML = S[wrapIdx];
  sl.classList.remove('in'); void sl.offsetWidth; sl.classList.add('in');
  $('#wrapDots').innerHTML = S.map((_, i) => `<i class="${i === wrapIdx ? 'on' : i < wrapIdx ? 'done' : ''}"></i>`).join('');
  $('#wrapPrev').disabled = wrapIdx === 0;
  $('#wrapNext').textContent = wrapIdx === S.length - 1 ? '닫기' : '다음 ▶';
  $('#wrapStage').dataset.k = String(wrapIdx % 4);
  countUp(sl);
  wrapShownAt = performance.now();
  const sv = $('#wrapSave');
  if (sv) sv.onclick = saveWrapImage;
}
function wrapCharLoop() {
  cancelAnimationFrame(wrapRaf);
  const cv = $('#wrapChar');
  const step = (now) => {
    if (!$('#wrapDlg').open) return;
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, cv.width, cv.height);
    const t = now - wrapShownAt, bob = Math.abs(Math.sin(now / 260)) * 6, pop = t < 260 ? 0.7 + (t / 260) * 0.3 : 1;
    ctx.save(); ctx.translate(cv.width / 2, cv.height - 4 - bob); ctx.scale(pop, pop);
    if (typeof emoteAvatar === 'function') emoteAvatar(ctx, settings.avatar || DEFAULT_AVATAR, W_EXPR[wrapIdx % W_EXPR.length], 0, 0, cv.height * 0.86);
    ctx.restore();
    wrapRaf = requestAnimationFrame(step);
  };
  wrapRaf = requestAnimationFrame(step);
}
async function openWrap() {
  if (!loggedIn()) { toast('로그인해야 볼 수 있어요.'); return; }
  try { wrapData = await api('/wrap'); } catch (e) { toast(`결산을 불러오지 못했어요 (${e.message})`, 3000); return; }
  wrapData.slides = wrapSlides(wrapData);
  wrapIdx = 0;
  if (!$('#wrapDlg').open) $('#wrapDlg').showModal();
  renderWrap();
  wrapCharLoop();
}
$('#btnWrap').addEventListener('click', openWrap);
$('#wrapClose').addEventListener('click', () => $('#wrapDlg').close());
$('#wrapPrev').addEventListener('click', () => { wrapIdx--; renderWrap(); });
$('#wrapNext').addEventListener('click', () => { if (wrapIdx >= wrapData.slides.length - 1) $('#wrapDlg').close(); else { wrapIdx++; renderWrap(); } });
$('#wrapDlg').addEventListener('keydown', (e) => {
  if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); $('#wrapNext').click(); }
  if (e.key === 'ArrowLeft') { e.preventDefault(); if (wrapIdx > 0) { wrapIdx--; renderWrap(); } }
});
$('#wrapSlide').addEventListener('click', (e) => { if (!e.target.closest('button, a')) $('#wrapNext').click(); });
$('#wrapDlg').addEventListener('close', () => cancelAnimationFrame(wrapRaf));

/* ---------------- 요약 이미지 (1080×1350) */
function saveWrapImage() {
  const d = wrapData;
  if (!d) return;
  const W = 1080, H = 1350;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const c = cv.getContext('2d');
  const g = c.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, '#1b0f3a'); g.addColorStop(0.55, '#3a1a5e'); g.addColorStop(1, '#ff6a3d');
  c.fillStyle = g; c.fillRect(0, 0, W, H);
  for (let i = 0; i < 40; i++) { c.fillStyle = `rgba(255,255,255,${0.05 + (i % 5) * 0.03})`; c.beginPath(); c.arc((i * 263) % W, (i * 151) % (H * 0.6), 2 + (i % 3), 0, Math.PI * 2); c.fill(); }
  const F = (w, s) => `${w} ${s}px "Noto Sans KR", sans-serif`;
  c.fillStyle = '#ffd36b'; c.font = F(900, 34); c.fillText(`${d.year} LINKBEAT 결산`, 72, 110);
  c.fillStyle = '#ffffff'; c.font = F(900, 72); c.fillText(`${d.me.nick} 님`, 72, 200);
  const ht = hourType(d.hours || []);
  const rows = [['🎮 올해 친 판수', `${d.plays.toLocaleString()}판`], ['🎵 쳐 본 곡', `${d.songCount}곡`], ['🔥 최고 콤보', d.maxCombo.toLocaleString()],
    ['⭐ 풀콤보', `${d.fc}번`], ['💯 ALL PERFECT', `${d.ap}번`], ['🏅 레벨', `Lv${d.me.lv}`], ['🕐 스타일', ht ? `${ht.name} 리듬러` : '-'],
    ['💞 단짝', d.partners && d.partners[0] ? `${d.partners[0].name} (${d.partners[0].n}판)` : '-']];
  rows.forEach(([k, v], i) => {
    const y = 300 + i * 86;
    c.fillStyle = 'rgba(255,255,255,0.08)'; c.fillRect(72, y - 52, 600, 70);
    c.fillStyle = '#e8d8ff'; c.font = F(700, 30); c.fillText(k, 96, y - 6);
    c.fillStyle = '#ffffff'; c.font = F(900, 34); c.textAlign = 'right'; c.fillText(v, 650, y - 6); c.textAlign = 'left';
  });
  const top = d.top || [];
  c.fillStyle = '#ffd36b'; c.font = F(900, 32); c.fillText('💗 가장 많이 친 곡', 72, 1040);
  top.slice(0, 3).forEach((s, i) => {
    c.fillStyle = '#ffffff'; c.font = F(i ? 700 : 900, i ? 30 : 38);
    let t = `${i + 1}. ${s.title}`;
    while (c.measureText(t).width > 900 && t.length > 4) t = t.slice(0, -2) + '…';
    c.fillText(t, 72, 1100 + i * 58);
  });
  if (typeof emoteAvatar === 'function') { c.save(); emoteAvatar(c, settings.avatar || DEFAULT_AVATAR, 'cheer', 870, 900, 520); c.restore(); }
  c.fillStyle = 'rgba(255,255,255,0.6)'; c.font = F(700, 24); c.fillText('LINKBEAT · 유튜브 링크 리듬게임', 72, H - 50);
  const a = document.createElement('a');
  a.download = `linkbeat-${d.year}-${d.me.nick}.png`;
  a.href = cv.toDataURL('image/png');
  a.click();
  toast('🖼 결산 이미지를 저장했어요!');
}

/* 12월이면 로비에 결산 안내 (하루 한 번 반짝) */
function wrapBadge() {
  const b = $('#btnWrap');
  if (!b) return;
  b.classList.toggle('glow', isDecember());
  b.title = isDecember() ? '🎁 올해 결산이 나왔어요! 눌러서 보기' : '올해 결산 (지금까지) — 올해 친 곡·최애 곡·최고 기록';
}
wrapBadge();
