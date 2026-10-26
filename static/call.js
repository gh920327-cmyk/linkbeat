/* 📣 같이 하자 벨 — 접속 중인 친구(모두 또는 고른 사람)를 내 멀티 방으로 부름
   받은 친구 화면엔 30초 동안 초대 카드 ('같이 하기' → 바로 그 방으로). 게임 중이면 그 판이 끝난 뒤에 보여 줌 */
'use strict';

const callMenuOpen = () => !$('#callMenu').classList.contains('hidden');
async function openCallMenu() {
  const m = $('#callMenu');
  if (callMenuOpen()) { m.classList.add('hidden'); return; }
  $('#cmList').innerHTML = '<li class="muted">불러오는 중...</li>';
  if (typeof popAt === 'function') popAt(m, $('#btnCall')); else m.classList.remove('hidden');
  let people = [];
  try { people = ((await (await fetch('/api/online')).json()).people || []).filter((p) => p.id !== net.id); } catch { /* 무시 */ }
  const st = (p) => {
    const s = p.status || {};
    if (net.room && s.room === net.room.code) return '내 방에 있어요';
    return { multi: '멀티 게임 중', watch: '구경 중', room: '다른 방에 있어요', solo: '혼자 하는 중', edit: '채보 고치는 중', calib: '싱크 맞추는 중' }[s.kind] || '로비';
  };
  $('#cmList').innerHTML = people.length ? people.map((p) => {
    const here = net.room && (p.status || {}).room === net.room.code;
    return `<li><span class="cm-n">${typeof miniHtml === 'function' ? miniHtml(p.avatar, 22) : ''} ${typeof nameDeco === 'function' ? nameDeco(p) : esc(p.name)}<small>${esc(st(p))}</small></span>`
      + (here ? '' : `<button type="button" class="small-btn cm-one" data-id="${p.id}">부르기</button>`) + '</li>';
  }).join('') : '<li class="muted">지금 접속한 친구가 없어요.</li>';
  if (typeof paintMinis === 'function') paintMinis($('#cmList'));
  $('#cmAll').disabled = !people.some((p) => !(net.room && (p.status || {}).room === net.room.code));
  popAt(m, $('#btnCall'));
}
function sendCall(to) {
  if (!net.open) { toast('서버에 연결되지 않았어요.'); return; }
  net.send({ type: 'call', to });
  $('#callMenu').classList.add('hidden');
}
$('#btnCall').addEventListener('click', (e) => { e.stopPropagation(); openCallMenu(); });
$('#cmAll').addEventListener('click', () => sendCall('all'));
$('#cmList').addEventListener('click', (e) => {
  const b = e.target.closest('.cm-one');
  if (b) sendCall([+b.dataset.id]);
});
document.addEventListener('click', (e) => { if (!e.target.closest('#callMenu, #btnCall')) $('#callMenu').classList.add('hidden'); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && callMenuOpen()) { $('#callMenu').classList.add('hidden'); e.stopPropagation(); } }, true);

net.on('callRes', (m) => {
  if (m.error) { toast(m.error, 2500); return; }
  if (!m.n) { toast('지금 부를 수 있는 친구가 없어요.', 2500); return; }
  toast(`📣 친구 ${m.n}명을 불렀어요! 방 ${m.code}에서 기다려요.`, 3500);
  sfx.ding && sfx.ding();
  const tab = $('#listTabs [data-side="multi"]');
  if (tab && currentScreen === 'lobby') tab.click();      // 내 방이 보이게
});

/* ---------------- 받았을 때 */
let callUi = null, callQueue = null;
const inPlay = () => typeof game !== 'undefined' && game && currentScreen === 'game' && !['ended', 'aborted'].includes(game.phase);
function showCall(m) {
  hideCall();
  const box = $('#callBox');
  box.innerHTML = `<div class="cb-t">${typeof miniHtml === 'function' ? miniHtml(m.avatar, 34) : ''}<span>📣 <b>${esc(m.from)}</b> 님이 같이 하재요!</span><b class="cb-cnt"></b></div>`
    + (m.song ? `<div class="cb-s muted small">${m.playing ? '지금 게임 중 · 끝나면 같이 해요' : '고른 곡'}: ${esc(m.song)}</div>` : '')
    + '<div class="cb-b"><button type="button" class="primary small-btn" id="cbYes">같이 하기</button><button type="button" class="small-btn" id="cbNo">나중에</button></div>';
  box.classList.remove('hidden');
  if (typeof paintMinis === 'function') paintMinis(box);
  const end = Date.now() + (m.secs || 30) * 1000;
  const tick = () => { const s = Math.max(0, Math.ceil((end - Date.now()) / 1000)); const c = $('.cb-cnt', box); if (c) c.textContent = `${s}`; if (!s) hideCall(); };
  callUi = { timer: setInterval(tick, 250) };
  tick();
  $('#cbYes').onclick = () => {
    hideCall();
    if (inPlay()) { toast('지금 하는 판을 끝내고 들어가 주세요.'); return; }
    $$('dialog[open]').forEach((d) => d.close());
    const tab = $('#listTabs [data-side="multi"]');
    if (tab && currentScreen === 'lobby') tab.click();
    net.send({ type: 'join', code: m.code });
    toast(`${m.from} 님 방으로 들어가요!`, 2000);
  };
  $('#cbNo').onclick = hideCall;
  sfx.ding && sfx.ding();
}
function hideCall() {
  if (callUi) clearInterval(callUi.timer);
  callUi = null;
  $('#callBox').classList.add('hidden');
}
net.on('call', (m) => {
  if (inPlay()) { callQueue = { m, at: Date.now() }; toast(`📣 ${m.from} 님이 같이 하재요! 이 판이 끝나면 알려 드릴게요.`, 2500); return; }
  showCall(m);
});
/* 게임이 끝나 화면이 바뀌면, 기다리던 부르기를 보여 줌 (1분 30초 안이면) */
setInterval(() => {
  if (!callQueue || inPlay()) return;
  const q = callQueue;
  callQueue = null;
  if (Date.now() - q.at < 90000) showCall(Object.assign({}, q.m, { secs: 25 }));
}, 1000);
