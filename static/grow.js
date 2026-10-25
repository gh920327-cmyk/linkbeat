/* 링크비트 성장 — 내 진행(경험치·♪·출석·미션·리그·알림), 결과 보상, 도전장·실시간 대결, 상점
   진짜 값은 서버의 내 계정에 있어요 (/api/me). 화면은 받아서 보여 주기만 해요. */
'use strict';

let myGrow = null;        // 서버가 준 내 진행
let SHOP = null;          // items.json (아이템 목록)
const DECO_CATS = ['nc', 'icon', 'card', 'frame'];
const NT_ICON = { welcome: '🎁', return: '👋', item: '🎁', league: '🏅', beaten: '⚔️', chal: '📜', chalres: '⚔️' };
const fmtN = (n) => (+n || 0).toLocaleString();
const loggedIn = () => typeof profile !== 'undefined' && !!profile.tok;

function fmtDur(sec) {
  sec = Math.max(0, Math.round(+sec || 0));
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
  return d ? `${d}일 ${h}시간` : h ? `${h}시간 ${m}분` : `${m}분`;
}
function ago(t) {
  const s = Math.max(0, Date.now() / 1000 - (+t || 0));
  return s < 60 ? '방금' : s < 3600 ? `${Math.floor(s / 60)}분 전` : s < 86400 ? `${Math.floor(s / 3600)}시간 전` : `${Math.floor(s / 86400)}일 전`;
}

/* ------------------------------------------------------------ 아이템 */
function itemOwned(id) {
  if (!id) return true;
  const own = myGrow ? myGrow.owned : store.get('ownedCache', []);
  return Array.isArray(own) && own.includes(id);
}
const itemOf = (id) => (SHOP && SHOP.by[id]) || null;
async function loadShopItems() {
  if (SHOP) return SHOP;
  try {
    const r = await fetch('/static/items.json', { cache: 'no-cache' });
    const j = await r.json();
    j.by = Object.fromEntries(j.items.map((i) => [i.id, i]));
    SHOP = j;
  } catch { /* 무시 */ }
  return SHOP;
}
/* 아이템 → 꾸미기 값 ({note: 'star'} 같은) */
function skinOverOf(id) {
  for (const [key, map] of Object.entries(SKIN_ITEMS)) for (const [v, iid] of Object.entries(map)) if (iid === id) return [key, v];
  return null;
}
function itemEquipped(id) {
  const it = itemOf(id);
  if (!it) return false;
  if (DECO_CATS.includes(it.cat)) return (settings.deco || {})[it.cat] === id;
  const o = skinOverOf(id);
  return !!o && settings.skin[o[0]] === o[1];
}
/* 안 가진 꾸미기를 쓰고 있으면 기본으로 (서버 값을 받은 뒤에만) */
function fixEquipped() {
  if (!myGrow) return;
  let ch = false;
  for (const [key, map] of Object.entries(SKIN_ITEMS)) {
    const id = map[settings.skin[key]];
    if (id && !itemOwned(id)) { settings.skin[key] = DEFAULT_SKIN[key]; ch = true; }
  }
  const d = settings.deco || {};
  for (const k of Object.keys(d)) if (!itemOwned(d[k])) { delete d[k]; ch = true; }
  if (ch) { settings.deco = d; saveSettings(); net.send(helloMsg()); }
}

/* ------------------------------------------------------------ 내 진행 불러오기 */
let growTimer = 0;
async function growStart() {
  await loadShopItems();
  await loadMe();
  clearInterval(growTimer);
  growTimer = setInterval(() => { if (currentScreen === 'lobby' && !document.hidden) loadMe(); }, 5 * 60 * 1000);
}
let meReq = 0;
async function loadMe() {
  if (!loggedIn()) { myGrow = null; renderGrowAll(); return null; }
  const my = ++meReq;
  try {
    const j = await api('/me', { method: 'POST', body: { nick: settings.nick || '', xp: +store.get('xp', 0) || 0 } });
    if (my === meReq) setMe(j);
    return j;
  } catch { return null; }
}
function setMe(j) {
  const lv0 = typeof myLevel === 'function' ? myLevel() : 0;
  myGrow = j;
  store.set('ownedCache', j.owned || []);
  store.set('xp', j.xp);
  store.set('duelW', (j.chal || {}).w || 0);
  if (typeof renderMyLevel === 'function') renderMyLevel();
  if (typeof myLevel === 'function' && myLevel() !== lv0) net.send(helloMsg());
  const ids = [];
  if ((j.chal || {}).w >= 1) ids.push('duel1');
  if ((j.chal || {}).w >= 10) ids.push('duel10');
  if (j.champ >= 1) ids.push('champ1');
  if (ids.length && typeof achUnlock === 'function') achUnlock(ids);
  fixEquipped();
  renderGrowAll();
}
function renderGrowAll() {
  renderGrowTop();
  renderGrowBar();
  if ($('#shopDlg').open) renderShop();
  if (ntOpen()) renderNotices();
  if (typeof markLocks === 'function' && $('#skinDlg').open) markLocks();
}

/* ------------------------------------------------------------ 위쪽: 🔥 출석 · ♪ · 🔔 */
function renderGrowTop() {
  const on = !!myGrow;
  for (const id of ['#myStreak', '#btnCoins', '#btnNotice']) $(id).classList.toggle('hidden', !on);
  $('#btnShop').classList.toggle('hidden', !on);
  if (!on) return;
  const st = myGrow.streak || {};
  $('#myStreak').innerHTML = `🔥<b>${st.n || 0}</b>${st.shields ? `<small>${'🛡'.repeat(st.shields)}</small>` : ''}`;
  $('#myStreak').classList.toggle('cold', !st.today);
  $('#myStreak').title = (st.today ? `오늘 출석 완료! ${st.n}일 연속` : `오늘 한 판 끝까지 하면 ${(st.n || 0) + 1}일 연속이에요`)
    + ` · 최고 ${st.best || 0}일${st.shields ? ` · 보호막 ${st.shields}개 (하루 빠져도 이어져요)` : ' · 7일마다 보호막을 얻어요'}`;
  $('#btnCoins').innerHTML = `<i>♪</i><b>${fmtN(myGrow.coins)}</b>`;
  const u = myGrow.unread || 0;
  $('#ntCount').textContent = u ? (u > 9 ? '9+' : String(u)) : '';
  $('#btnNotice').classList.toggle('has', u > 0);
}

/* ------------------------------------------------------------ 로비: 오늘의 미션 · 리그 */
function renderGrowBar() {
  const bar = $('#growBar');
  if (!myGrow || !myGrow.missions) { bar.classList.add('hidden'); return; }
  bar.classList.remove('hidden');
  const m = myGrow.missions, rw = m.reward;
  const done = m.list.filter((x) => x.done).length;
  $('#gbMisHead').innerHTML = `📋 오늘의 미션 <b>${done}/${m.list.length}</b>`;
  $('#gbMisHead').title = m.all ? '오늘 미션을 모두 끝냈어요! 내일 새 미션이 나와요.'
    : `하나에 +${rw.xp} XP · +${rw.coins}♪ · 셋 다 하면 +${rw.allXp} XP · +${rw.allCoins}♪ 더 · ↻로 하루 한 번 바꿀 수 있어요`;
  $('#gbMis').innerHTML = m.list.map((x, i) => `<div class="gb-m${x.done ? ' done' : ''}" title="${esc(x.text)}${x.done ? ' — 완료!' : ` — +${rw.xp} XP · +${rw.coins}♪`}">`
    + `<span class="gb-t">${x.done ? '✅ ' : ''}${esc(x.text)}</span>`
    + `<span class="gb-n">${x.done ? '' : `${fmtN(x.prog)}/${fmtN(x.goal)}`}</span>`
    + `<span class="gb-p"><i style="width:${Math.round((x.prog / x.goal) * 100)}%"></i></span>`
    + (!x.done && !m.rr ? `<button type="button" class="gb-rr" data-slot="${i}" title="이 미션 바꾸기 (하루 한 번)">↻</button>` : '') + '</div>').join('')
    + (m.all ? '<span class="gb-all">🎉 완료!</span>' : '');
  const L = myGrow.league || {};
  $('#gbLeague').innerHTML = `<span class="gl-h">🏅 이번 주 리그</span><b>${L.me ? `${L.me.rank}위` : '–'}</b><small>${L.me ? `${fmtN(L.me.pts)} XP` : '한 판 하면 참가'} · ${fmtDur(L.endsIn)} 남음</small>`;
  const ret = $('#gbRet');
  ret.classList.toggle('hidden', !(myGrow.ret > 0));
  ret.textContent = myGrow.ret > 0 ? `👋 복귀 보너스 ×2 · ${myGrow.ret}판 남음` : '';
}
$('#gbMis').addEventListener('click', async (e) => {
  const b = e.target.closest('.gb-rr');
  if (!b) return;
  b.disabled = true;
  try {
    const j = await api('/me/reroll', { method: 'POST', body: { slot: +b.dataset.slot } });
    myGrow.missions = j.missions;
    renderGrowBar();
    toast('미션을 바꿨어요. (하루 한 번)');
  } catch (err) { toast(err.message); b.disabled = false; }
});

/* ------------------------------------------------------------ 작은 창 공통 (누른 곳 아래에, 바깥을 누르면 닫힘) */
function popAt(menu, anchor) {
  menu.classList.remove('hidden');
  const r = anchor.getBoundingClientRect(), w = menu.offsetWidth, h = menu.offsetHeight;
  let top = r.bottom + 6;
  if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 6);
  menu.style.top = `${Math.round(top)}px`;
  menu.style.left = `${Math.round(Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2)))}px`;
}
document.addEventListener('click', (e) => {
  if (!e.target.closest('#ntMenu, #btnNotice')) $('#ntMenu').classList.add('hidden');
  if (!e.target.closest('#lgMenu, #gbLeague')) $('#lgMenu').classList.add('hidden');
  if (!e.target.closest('#chalMenu, .pl-chal, #btnChal')) $('#chalMenu').classList.add('hidden');
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  for (const id of ['#ntMenu', '#lgMenu', '#chalMenu']) if (!$(id).classList.contains('hidden')) { $(id).classList.add('hidden'); e.stopPropagation(); }
}, true);

/* ------------------------------------------------------------ 🔔 알림 */
const ntOpen = () => !$('#ntMenu').classList.contains('hidden');
const DONE_TXT = { won: '<span class="nt-done win">이겼어요!</span>', lost: '<span class="nt-done">졌어요</span>', draw: '<span class="nt-done">비겼어요</span>',
  declined: '<span class="nt-done">거절함</span>', expired: '<span class="nt-done">기한 지남</span>' };
function noticeHtml(n) {
  const what = n.sid ? `<span class="nt-song">${esc(n.title || '')} <small>${n.keys || 4}K ${DIFF_EN[n.diff] || ''}${n.ai ? ' · AI' : ''}${n.hl ? ' · 하이라이트' : ''}</small></span>` : '';
  const here = n.sid && songById(n.sid);
  let body = esc(n.text || ''), acts = '';
  if (n.type === 'beaten') {
    body = `<b>${esc(n.by)}</b> 님이 내 기록을 넘었어요 ${what}<small class="nt-sc">내 ${fmtN(n.mine)} → ${esc(n.by)} ${fmtN(n.theirs)}</small>`;
    acts = n.done ? (n.done === 'won' ? '<span class="nt-done win">복수 성공!</span>' : '')
      : here && !n.hl ? `<button type="button" class="small-btn primary nt-rev" data-id="${esc(n.id)}" title="접속 중이면 실시간 대결, 아니면 고스트와 대결">⚔️ 복수하기</button>` : '';
  } else if (n.type === 'chal') {
    body = `<b>${esc(n.by)}</b> 님의 도전장 ${what}<small class="nt-sc">${fmtN(n.score)}점을 넘어 보세요</small>`;
    acts = n.done ? (DONE_TXT[n.done] || '') : here
      ? `<button type="button" class="small-btn primary nt-acc" data-id="${esc(n.chal)}" title="접속 중이면 실시간 대결, 아니면 고스트와 대결">수락</button><button type="button" class="small-btn nt-dec" data-id="${esc(n.chal)}">거절</button>` : '';
  } else if (n.type === 'chalres') {
    body = `${esc(n.text)} ${what}`;
  }
  return `<li class="nt-item${n.read ? '' : ' unread'}"><span class="nt-ico">${NT_ICON[n.type] || '🔔'}</span>`
    + `<span class="nt-body">${body}<small class="nt-at">${ago(n.at)}</small></span><span class="nt-acts">${acts}</span></li>`;
}
function renderNotices() {
  const list = ((myGrow && myGrow.notices) || []).slice().reverse();
  $('#ntList').innerHTML = list.length ? list.map(noticeHtml).join('') : '<li class="muted nt-empty">아직 알림이 없어요.</li>';
}
$('#btnNotice').addEventListener('click', async () => {
  if (ntOpen()) { $('#ntMenu').classList.add('hidden'); return; }
  renderNotices();
  popAt($('#ntMenu'), $('#btnNotice'));
  if (myGrow && myGrow.unread) {
    myGrow.unread = 0;
    renderGrowTop();
    try { await api('/notices/read', { method: 'POST', body: {} }); } catch { /* 무시 */ }
    setTimeout(() => (myGrow.notices || []).forEach((n) => { n.read = true; }), 1500);
  }
});
$('#ntClose').addEventListener('click', () => $('#ntMenu').classList.add('hidden'));
$('#ntList').addEventListener('click', async (e) => {
  const rev = e.target.closest('.nt-rev'), acc = e.target.closest('.nt-acc'), dec = e.target.closest('.nt-dec');
  if (rev) duelRequest('revenge', rev.dataset.id);
  else if (acc) duelRequest('chal', acc.dataset.id);
  else if (dec) {
    dec.disabled = true;
    try { await api('/challenge/decline', { method: 'POST', body: { id: dec.dataset.id } }); } catch { /* 무시 */ }
    await loadMe();
  }
});
net.on('notice', (m) => {
  if (!myGrow || !m.n) return;
  (myGrow.notices ||= []).push(m.n);
  myGrow.unread = (myGrow.unread || 0) + 1;
  renderGrowTop();
  if (ntOpen()) renderNotices();
  if (currentScreen !== 'game') { toast(`🔔 ${m.n.text}`, 3800); sfx.tick(0.2, 1500); }
});

/* ------------------------------------------------------------ 🏅 주간 리그 */
async function openLeague() {
  const m = $('#lgMenu');
  if (!m.classList.contains('hidden')) { m.classList.add('hidden'); return; }
  $('#lgList').innerHTML = '<li class="muted">불러오는 중...</li>';
  popAt(m, $('#gbLeague'));
  try {
    const L = await api('/league');
    $('#lgSum').textContent = `${L.n}명 참가 · ${fmtDur(L.endsIn)} 남음`;
    $('#lgList').innerHTML = L.top.map((r, i) => `<li class="${r.me ? 'me' : ''}"><span class="lg-r">${i < 3 ? MEDALS[i + 1] : i + 1}</span>`
      + `<span class="lg-n">${nameDeco(r, r.nick)}</span><span class="lg-p">${fmtN(r.pts)} XP</span></li>`).join('')
      || '<li class="muted">이번 주는 아직 아무도 안 했어요. 첫 판을 해 보세요!</li>';
    if (L.me && !L.top.some((r) => r.me)) $('#lgList').insertAdjacentHTML('beforeend', `<li class="me"><span class="lg-r">${L.me.rank}</span><span class="lg-n">나</span><span class="lg-p">${fmtN(L.me.pts)} XP</span></li>`);
    $('#lgPrev').innerHTML = L.prev.length ? `지난주: ${L.prev.map((t, i) => `${MEDALS[i + 1]} ${esc(t.nick)}`).join(' · ')}` : '';
    $('#lgPrize').textContent = `이번 주에 번 경험치 순위 · 월요일 0시에 1위 ${L.prize[0]}♪(+황금 기어) · 2위 ${L.prize[1]}♪ · 3위 ${L.prize[2]}♪ · 참가 50♪ · 1~3위는 한 주 동안 이름 옆에 메달`;
    popAt(m, $('#gbLeague'));
  } catch (e) {
    $('#lgList').innerHTML = `<li class="muted">불러오지 못했어요 (${esc(e.message)})</li>`;
  }
}
$('#gbLeague').addEventListener('click', openLeague);
$('#lgClose').addEventListener('click', () => $('#lgMenu').classList.add('hidden'));

/* ------------------------------------------------------------ 결과 화면 보상 */
function growOnResult(g, r, res) {
  const box = $('#rReward');
  const rw = res && res.reward;
  $('#btnChal').classList.toggle('hidden', !(loggedIn() && res && !r.incomplete && !g.hl && !(g.practice && !g.hl)));
  if (!rw) {
    box.classList.add('hidden');
    if (loggedIn() && typeof profile !== 'undefined') $('#rXp').classList.add('hidden');
    return;
  }
  if (typeof showXpGain === 'function') showXpGain(rw.xp.before, rw.xp.after);
  const L = [];
  L.push(`<div class="rw-coins"><b>+${fmtN(rw.coins.gain)}♪</b><small>${rw.coinParts.map(([k, v]) => `${esc(k)} ${fmtN(v)}`).join(' · ')}</small><span class="rw-total">보유 ♪${fmtN(rw.coins.total)}</span></div>`);
  const st = rw.streak;
  if (st && st.first) {
    L.push(`<div class="rw-line rw-st">🔥 <b>${st.n}일</b> 연속 출석${st.shieldUsed ? ` · 🛡 보호막 ${st.shieldUsed}개로 이어졌어요` : ''}${st.shieldGot ? ' · 🛡 보호막을 하나 얻었어요' : ''}${st.milestone ? ` · 🎉 ${st.milestone}일 달성!` : ''}</div>`);
  }
  if (rw.retStart) L.push('<div class="rw-line rw-ret">👋 돌아온 걸 환영해요! 3판 동안 경험치·♪가 2배예요</div>');
  else if (rw.ret) L.push(`<div class="rw-line rw-ret">👋 복귀 보너스 ×2 · ${rw.ret.left}판 남음</div>`);
  if (rw.missions.length) {
    L.push(`<div class="rw-line rw-mis">${rw.missions.map((m) => `<span>✅ ${esc(m.text)}</span>`).join('')}${rw.allDone ? '<span class="all">🎉 오늘 미션 모두 완료!</span>' : ''}</div>`);
  }
  if (rw.duel) {
    const d = rw.duel;
    L.push(`<div class="rw-line rw-duel ${d.win ? 'win' : 'lose'}">⚔️ ${esc(d.vs)} 님과 ${d.label.includes('복수') ? '복수전' : '도전장'}: ${d.win ? '<b>승리!</b>' : d.tie ? '<b>무승부</b>' : '아쉽게 패배'} <small>${fmtN(d.mine)} vs ${fmtN(d.theirs)}</small></div>`);
  }
  if (rw.levelUp) L.push(`<div class="rw-line rw-lv">⬆ 레벨 업! Lv ${rw.levelUp.from} → ${rw.levelUp.to} · +${100 * (rw.levelUp.to - rw.levelUp.from)}♪</div>`);
  if (rw.items.length) L.push(`<div class="rw-line rw-items">🎁 새 꾸미기: ${rw.items.map((id) => `<b>${esc((itemOf(id) || {}).name || id)}</b>`).join(', ')} <button type="button" class="small-btn" id="rwShop">상점에서 보기</button></div>`);
  if (rw.league && rw.league.rank) L.push(`<div class="rw-line rw-lg">🏅 이번 주 리그 <b>${rw.league.rank}위</b> · ${fmtN(rw.league.pts)} XP</div>`);
  box.innerHTML = L.join('');
  box.classList.remove('hidden');
  const sb = $('#rwShop');
  if (sb) sb.onclick = () => openShop(rw.items[0]);
  if (rw.missions.length) setTimeout(() => { sfx.ding(); toast(`✅ 미션 완료! ${rw.missions.map((m) => m.text).join(', ')}`, 3000); }, 900);
  loadMe();
}
/* 실시간 1:1 대결 결과 (멀티 결과 위에) */
function growDuelResult(m) {
  const box = $('#rDuel');
  if (!box) return;
  const d = m && m.duel;
  box.classList.toggle('hidden', !d);
  if (!d) return;
  const mine = d.coins ? d.coins[String(net.id)] : 0;
  const win = d.winner === net.id;
  box.className = `r-duel ${d.tie ? '' : win ? 'win' : 'lose'}`;
  box.innerHTML = d.tie ? `⚔️ 실시간 대결 — <b>무승부!</b>${mine ? ` +${mine}♪` : ''}`
    : `⚔️ 실시간 대결 — <b>${esc(d.names[String(d.winner)] || '')}</b> 승리!${win ? ' 🎉' : ''}${mine ? ` <small>+${mine}♪</small>` : ''}`;
  if (win) sfx.ding();
  setTimeout(loadMe, 800);
}

/* ------------------------------------------------------------ ⚔️ 실시간 대결 · 고스트 대결 */
let duelUi = null;    // { did, mode, end, timer }
function showDuel(mode, m) {
  hideDuel();
  const box = $('#duelBox');
  const what = `<span class="du-song">${esc(m.title || '')} <small>${m.keys || 4}K ${DIFF_EN[m.diff] || ''}${m.ai ? ' · AI' : ''}</small></span>`;
  if (mode === 'wait') {
    box.innerHTML = `<div class="du-t">⚔️ <b>${esc(m.opp)}</b> 님에게 실시간 대결을 물어보는 중… <b class="du-cnt"></b></div>${what}
      <div class="du-b"><button type="button" class="small-btn" id="duGhost">기다리지 않고 고스트와 대결</button></div>`;
  } else {
    const head = m.kind === 'chal' ? `<b>${esc(m.from)}</b> 님이 내 도전장을 받았어요! 지금 같이 대결할까요?` : `<b>${esc(m.from)}</b> 님이 복수전을 신청했어요! 지금 같이 할까요?`;
    box.innerHTML = `<div class="du-t">⚔️ ${head} <b class="du-cnt"></b></div>${what}
      <div class="du-b"><button type="button" class="primary small-btn" id="duYes">같이 하기</button><button type="button" class="small-btn" id="duNo">고스트로 하게 두기</button></div>`;
  }
  box.classList.remove('hidden');
  const end = Date.now() + (m.secs || 20) * 1000;
  const tick = () => { const s = Math.max(0, Math.ceil((end - Date.now()) / 1000)); const c = $('.du-cnt', box); if (c) c.textContent = `${s}`; if (!s) hideDuel(); };
  duelUi = { did: m.did, mode, timer: setInterval(tick, 250) };
  tick();
  if (mode === 'wait') $('#duGhost').onclick = () => { net.send({ type: 'duelCancel', did: m.did }); hideDuel(); };
  else {
    $('#duYes').onclick = () => { net.send({ type: 'duelAns', did: m.did, yes: true }); hideDuel(); toast('대결 준비 중…'); };
    $('#duNo').onclick = () => { net.send({ type: 'duelAns', did: m.did, yes: false }); hideDuel(); };
  }
}
function hideDuel() {
  if (duelUi) clearInterval(duelUi.timer);
  duelUi = null;
  $('#duelBox').classList.add('hidden');
}
function duelRequest(kind, id) {
  if (!net.open) { toast('서버에 연결되지 않았어요.'); return; }
  $('#ntMenu').classList.add('hidden');
  net.send({ type: 'duelReq', kind, id });
  toast('상대가 접속해 있는지 확인하는 중…', 1500);
}
net.on('duelWait', (m) => showDuel('wait', m));
net.on('duelInvite', (m) => { sfx.ding(); showDuel('invite', m); });
net.on('duelGone', (m) => { if (duelUi && duelUi.did === m.did) hideDuel(); if (m.late) toast('대결 신청 시간이 지났어요.'); });
net.on('duelStart', (m) => { hideDuel(); $$('dialog[open]').forEach((d) => d.close()); toast(`⚔️ ${m.vs} 님과 실시간 대결! 곧 시작해요`, 3500); });
const GHOST_WHY = {
  offline: (n) => `${n} 님이 지금 접속해 있지 않아서 고스트와 대결해요.`,
  busy: (n) => `${n} 님이 지금 게임 중이라 고스트와 대결해요.`,
  declined: (n) => `${n} 님이 지금은 어렵대요. 고스트와 대결해요.`,
  timeout: (n) => `${n} 님이 답이 없어서 고스트와 대결해요.`,
  cancel: () => '고스트와 대결해요.',
};
net.on('duelGhost', (m) => {
  hideDuel();
  toast(`👻 ${(GHOST_WHY[m.reason] || GHOST_WHY.cancel)(m.oppNick || '상대')}`, 3500);
  startDuelGhost(m);
});
function startDuelGhost(m) {
  if (!songById(m.sid)) { toast('이 곡이 목록에 없어요.'); return; }
  const gh = m.ghost || {};
  const linear = (score) => Array.from({ length: 21 }, (_, i) => Math.round((score * i) / 20));
  const ghost = { label: `${gh.name || m.oppNick} · ${m.kind === 'chal' ? '도전장' : '복수전'}`, score: gh.score || 0,
    g: Array.isArray(gh.g) && gh.g.length >= 2 ? gh.g : linear(gh.score || 0) };
  if (net.room) net.send({ type: 'leave' });
  $$('dialog[open]').forEach((d) => d.close());
  if (typeof closePlCard === 'function') closePlCard();
  startSolo(m.sid, m.diff, m.keys || 4, null, null, { ai: !!m.ai, ghost, duel: { kind: m.kind, id: m.id } });
}

/* ------------------------------------------------------------ 📜 도전장 보내기 */
async function sendChallenge(to, songId, diff, keys, ai) {
  try {
    await api('/challenge', { method: 'POST', body: { to, songId, diff, keys, ai } });
    toast(`📜 ${to} 님에게 도전장을 보냈어요!`);
    $('#chalMenu').classList.add('hidden');
  } catch (e) { toast(e.message, 3000); }
}
/* 결과 화면: 이 곡·난이도로 누구에게? (접속 중인 사람 + 이 곡 순위표에 있는 사람) */
async function openChalFriends(anchor) {
  const g = lastResult && lastResult.g;
  if (!g) return;
  const m = $('#chalMenu');
  $('#chHead').textContent = `📜 ${g.song.title} (${g.nl}K ${DIFF_EN[g.diff]}) 도전장 보내기`;
  $('#chList').innerHTML = '<li class="muted">불러오는 중...</li>';
  popAt(m, anchor);
  const nick = (settings.nick || '').trim();
  const names = new Map();
  try {
    const j = await (await fetch('/api/online')).json();
    for (const p of j.people || []) if (p.name !== nick) names.set(p.name, '접속 중');
  } catch { /* 무시 */ }
  const s = songById(g.song.id);
  if (s) for (const e of boardOf(s, g.nl, g.diff, false, !!g.ai)) if (e.name !== nick && !names.has(e.name)) names.set(e.name, `기록 ${fmtN(e.score)}`);
  $('#chList').innerHTML = [...names].map(([n, t]) => `<li><button type="button" class="ch-pick" data-to="${esc(n)}"><b>${esc(n)}</b><small>${esc(t)}</small></button></li>`).join('')
    || '<li class="muted">보낼 사람이 없어요. 친구가 접속하거나 이 곡을 하면 보낼 수 있어요.</li>';
  $('#chList').dataset.mode = 'friend';
  popAt(m, anchor);
}
/* 프로필 카드: 이 사람에게 내 기록 중 하나로 */
async function openChalRecords(to, anchor) {
  const m = $('#chalMenu');
  $('#chHead').textContent = `📜 ${to} 님에게 보낼 내 기록 고르기`;
  $('#chList').innerHTML = '<li class="muted">불러오는 중...</li>';
  popAt(m, anchor);
  try {
    const j = await (await fetch(`/api/player/${encodeURIComponent(settings.nick || '')}`)).json();
    const recs = (j.bests || []).filter((r) => songById(r.id));
    $('#chList').innerHTML = recs.map((r) => `<li><button type="button" class="ch-rec" data-to="${esc(to)}" data-sid="${esc(r.id)}" data-diff="${esc(r.diff)}" data-keys="${r.keys}" data-ai="${r.ai ? 1 : 0}">`
      + `<b>${esc(r.title)}</b><small>${r.keys}K ${DIFF_EN[r.diff] || ''}${r.ai ? ' · AI' : ''} · <span class="rank-${esc(r.rank)}">${esc(r.rank)}</span> ${fmtN(r.score)}</small></button></li>`).join('')
      || '<li class="muted">아직 내 기록이 없어요. 한 곡 끝까지 해 보세요!</li>';
  } catch (e) {
    $('#chList').innerHTML = `<li class="muted">불러오지 못했어요 (${esc(e.message)})</li>`;
  }
  popAt(m, anchor);
}
$('#chList').addEventListener('click', (e) => {
  const f = e.target.closest('.ch-pick'), r = e.target.closest('.ch-rec');
  if (f && lastResult) { const g = lastResult.g; sendChallenge(f.dataset.to, g.song.id, g.diff, g.nl, !!g.ai); }
  if (r) sendChallenge(r.dataset.to, r.dataset.sid, r.dataset.diff, +r.dataset.keys, r.dataset.ai === '1');
});
$('#chClose').addEventListener('click', () => $('#chalMenu').classList.add('hidden'));
$('#btnChal').addEventListener('click', (e) => openChalFriends(e.currentTarget));
document.addEventListener('click', (e) => {
  const b = e.target.closest('.pl-chal');
  if (b) { e.stopPropagation(); openChalRecords(b.dataset.name, b); }
}, true);

/* ------------------------------------------------------------ 🛒 상점 */
let shopTab = 'note', shopSel = null, shopPrev = null, buyArm = null;
class ShopPreview extends SkinPreview {
  frame() {
    const real = settings.skin;
    settings.skin = Object.assign({}, real, { laneScale: 0.65, gearPos: 'center' }, this.over || {});   // 좁게: 양옆 기어 테두리까지 보이게
    try { super.frame(); } finally { settings.skin = real; }
  }
}
const SW_GLYPH = { note_neon: '▭', note_star: '★', note_heart: '♥', note_gem: '◆', fx_petal: '🌸', fx_bolt: '⚡', fx_star: '✨', fx_fire: '🔥', fx_snow: '❄️',
  combo_gold: '123', combo_neon: '123', combo_rainbow: '123' };
function swInner(it) {
  if (it.cat === 'icon') return it.emoji || '';
  if (it.cat === 'nc') return '가';
  return SW_GLYPH[it.id] || '';
}
function shopItemHtml(id) {
  const it = itemOf(id);
  if (!it) return '';
  const own = itemOwned(id), on = own && itemEquipped(id);
  const price = (myGrow.shop.prices || {})[id], base = it.price;
  const st = on ? '<b class="si-on">장착 중</b>' : own ? '<span class="si-own">보유</span>'
    : it.earn ? `<span class="si-lock">🔒 ${esc(it.how || '')}</span>`
      : price < base ? `<s>♪${fmtN(base)}</s> <b class="si-sale">♪${fmtN(price)}</b>` : `<b>♪${fmtN(price)}</b>`;
  return `<button type="button" class="shop-item${own ? ' own' : ''}${on ? ' on' : ''}${shopSel === id ? ' sel' : ''}${it.earn && !own ? ' earn' : ''}" data-id="${esc(id)}">`
    + `<span class="si-sw sw-${esc(id)}">${swInner(it)}</span><span class="si-name">${esc(it.name)}${it.limited ? ' <em>한정</em>' : ''}</span><span class="si-st">${st}</span></button>`;
}
function renderShop() {
  if (!myGrow || !SHOP) return;
  const sh = myGrow.shop;
  $('#shopCoins').textContent = fmtN(myGrow.coins);
  $('#shopSale').innerHTML = sh.sale.map(shopItemHtml).join('');
  $('#shopSaleLeft').textContent = `${sh.off}% 할인 · ${fmtDur(sh.saleEnds)} 남음`;
  $('#shopLim').innerHTML = sh.limited ? shopItemHtml(sh.limited) : '<span class="muted small">이번 주 한정 상품이 없어요.</span>';
  $('#shopLimLeft').textContent = sh.limited ? `${fmtDur(sh.limitedEnds)} 남음 · 지나면 다시 돌아올 때까지 못 사요` : '';
  $('#shopTabs').innerHTML = SHOP.cats.map(([c, n]) => {
    const k = SHOP.items.filter((i) => i.cat === c && itemOwned(i.id)).length, t = SHOP.items.filter((i) => i.cat === c).length;
    return `<button type="button" data-c="${c}" class="${c === shopTab ? 'on' : ''}">${esc(n)} <small>${k}/${t}</small></button>`;
  }).join('');
  $('#shopGrid').innerHTML = SHOP.items.filter((i) => i.cat === shopTab && (!i.limited || i.id === sh.limited || itemOwned(i.id))).map((i) => shopItemHtml(i.id)).join('');
  renderShopSel();
}
function renderShopSel() {
  const it = shopSel && itemOf(shopSel);
  const act = $('#shopAct'), info = $('#shopInfo');
  const deco = it && DECO_CATS.includes(it.cat);
  $('#shopCanvas').parentElement.classList.toggle('hidden', !!deco);
  $('#shopPrevDeco').classList.toggle('hidden', !deco);
  if (shopPrev) { const o = it && skinOverOf(it.id); shopPrev.over = o ? { [o[0]]: o[1] } : null; }
  if (!it) {
    info.innerHTML = '<b>물건을 눌러 보세요</b><small>왼쪽에서 바로 미리 볼 수 있어요.</small>';
    act.innerHTML = '';
    return;
  }
  if (deco) {
    const d = { ...(settings.deco || {}), [it.cat]: it.id };
    const lv = typeof myLevel === 'function' ? myLevel() : 1;
    $('#shopPrevDeco').innerHTML = it.cat === 'frame'
      ? `<div class="sp-frame ${esc(it.id)}"><b>SSS</b><span>결과 카드</span></div>`
      : `<div class="sp-card ${it.cat === 'card' ? esc(it.id) : esc(d.card || '')}"><span class="lv-tag">Lv${lv}</span>${nameDeco({ deco: d, medal: myGrow.medal }, settings.nick || '나')}<small>프로필 카드 · 방 · 접속자 목록에서 이렇게 보여요</small></div>`;
  }
  const own = itemOwned(it.id), on = own && itemEquipped(it.id);
  const price = (myGrow.shop.prices || {})[it.id];
  const catN = (SHOP.cats.find((c) => c[0] === it.cat) || [0, ''])[1];
  info.innerHTML = `<b>${esc(it.name)}</b><small>${esc(catN)}${it.limited ? ' · 이번 주 한정' : ''}${it.earn ? ` · 얻는 법: ${esc(it.how || '')}` : ''}</small>`;
  if (own) act.innerHTML = `<button type="button" class="${on ? '' : 'primary'}" id="shopEquip">${on ? '빼기 (기본으로)' : '장착하기'}</button>`;
  else if (it.earn) act.innerHTML = `<span class="si-lock">🔒 ${esc(it.how || '')} 하면 얻어요 (상점에서 못 사요)</span>`;
  else {
    const lack = price - myGrow.coins;
    act.innerHTML = lack > 0 ? `<button type="button" disabled>♪${fmtN(price)} · ${fmtN(lack)}♪ 더 필요</button>`
      : `<button type="button" class="primary" id="shopBuy">${buyArm === it.id ? `정말 살까요? ♪${fmtN(price)} — 한 번 더 누르기` : `♪${fmtN(price)}에 사기`}</button>`;
  }
  const eq = $('#shopEquip'), bb = $('#shopBuy');
  if (eq) eq.onclick = () => equipItem(it.id, !on);
  if (bb) bb.onclick = () => buyItem(it.id);
}
function equipItem(id, on) {
  const it = itemOf(id);
  if (!it || (on && !itemOwned(id))) return;
  if (DECO_CATS.includes(it.cat)) {
    settings.deco = { ...(settings.deco || {}) };
    if (on) settings.deco[it.cat] = id;
    else delete settings.deco[it.cat];
    saveSettings();
    net.send(helloMsg());
  } else {
    const o = skinOverOf(id);
    if (!o) return;
    settings.skin[o[0]] = on ? o[1] : DEFAULT_SKIN[o[0]];
    saveSettings();
    if ($('#skinDlg').open && typeof renderSkin === 'function') renderSkin();
  }
  renderShop();
}
async function buyItem(id) {
  if (buyArm !== id) { buyArm = id; renderShopSel(); setTimeout(() => { if (buyArm === id) { buyArm = null; renderShopSel(); } }, 4000); return; }
  buyArm = null;
  try {
    const j = await api('/shop/buy', { method: 'POST', body: { id } });
    myGrow.coins = j.coins;
    myGrow.owned = j.owned;
    store.set('ownedCache', j.owned);
    renderGrowTop();
    sfx.ding();
    toast(`🎉 '${itemOf(id).name}'을(를) 샀어요! 바로 장착했어요.`);
    equipItem(id, true);
  } catch (e) { toast(e.message, 3000); renderShopSel(); }
}
async function openShop(focusId) {
  if (!loggedIn()) { toast('로그인해야 상점을 쓸 수 있어요.'); return; }
  await loadShopItems();
  if (!SHOP) { toast('상점을 불러오지 못했어요.'); return; }
  if (!myGrow) await loadMe();
  if (!myGrow) { toast('서버에 연결되지 않았어요.'); return; }
  if (focusId && itemOf(focusId)) { shopTab = itemOf(focusId).cat; shopSel = focusId; }
  buyArm = null;
  renderShop();
  if (!$('#shopDlg').open) $('#shopDlg').showModal();
  if (!shopPrev) shopPrev = new ShopPreview($('#shopCanvas'));
  renderShopSel();
  shopPrev.reset();
  shopPrev.start();
  loadMe();
}
$('#btnCoins').addEventListener('click', () => openShop());
$('#btnShop').addEventListener('click', () => openShop());
$('#shopClose').addEventListener('click', () => $('#shopDlg').close());
$('#shopDlg').addEventListener('close', () => { if (shopPrev) shopPrev.stop(); buyArm = null; if ($('#skinDlg').open && typeof renderSkin === 'function') renderSkin(); });
$('#shopTabs').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-c]');
  if (b) { shopTab = b.dataset.c; renderShop(); }
});
$('#shopDlg').addEventListener('click', (e) => {
  const b = e.target.closest('.shop-item');
  if (!b) return;
  shopSel = b.dataset.id;
  buyArm = null;
  $$('#shopDlg .shop-item').forEach((x) => x.classList.toggle('sel', x.dataset.id === shopSel));
  renderShopSel();
  if (shopPrev) shopPrev.reset();
});

/* ------------------------------------------------------------ 시작 */
net.on('status', (ok) => { if (ok && myGrow) loadMe(); });
if (!window.gateOpen) growStart();
