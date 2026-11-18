/* 📢 업데이트 공지 (🔔 알림과는 따로 — 아이디·클래스는 news/nw- 로 시작): 새 공지가 올라오면 로비에서 한 번 자동으로 보여 주고, 닫으면 다시 안 띄움 (이 브라우저 기억)
   공지 내용은 /static/notices.json — 업데이트를 올릴 때마다 맨 위에 하나씩 추가
   열어 둔 채로 업데이트가 올라오면 '새로고침하면 적용돼요' 안내도 같이 */
'use strict';

let NOTICES = [], noticeLoadedId = null, noticeWait = 0, noticeFetchedAt = 0;
const noticeSeen = () => store.get('noticeSeen', '');
const NOTICE_GO = {
  event: () => { if (typeof myGrow !== 'undefined' && myGrow && myGrow.event) openEvent(); else toast('이벤트 기간이 되면 로비 위쪽 이벤트 띠에서 열 수 있어요.'); },
  skill: () => openSkill(),
  season: () => { if (typeof myGrow !== 'undefined' && myGrow && myGrow.season) openSeason(); else toast('로그인하면 시즌 패스를 볼 수 있어요.'); },
  beat: () => noticeSkinTo('#beatFxOpt'),
  note: () => noticeSkinTo('#noteShape'),
  req: () => { const b = $('#btnReq'); if (b) b.click(); },
  ach: () => { const b = $('#btnAch'); if (b) b.click(); },
  shop: () => openShop('note_saturn'),
};
const NOTICE_NEED = { event: 'openEvent', skill: 'openSkill', season: 'openSeason', beat: 'openSkin', note: 'openSkin', shop: 'openShop', ach: 'renderAchDlg' };
function noticeSkinTo(sel) {
  openSkin();
  setTimeout(() => {
    const el = $(sel);
    if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const row = el.closest('.set-row') || el;
    row.classList.add('nw-flash');
    setTimeout(() => row.classList.remove('nw-flash'), 2000);
  }, 150);
}

async function loadNotices() {
  try {
    const j = await (await fetch('/static/notices.json', { cache: 'no-cache' })).json();
    NOTICES = Array.isArray(j.notices) ? j.notices.filter((n) => n && n.id) : [];
  } catch { return false; }
  noticeFetchedAt = Date.now();
  if (noticeLoadedId === null) noticeLoadedId = NOTICES.length ? NOTICES[0].id : '';
  renderNoticeDot();
  return true;
}
const noticeStale = () => !!(NOTICES.length && noticeLoadedId !== null && NOTICES[0].id !== noticeLoadedId);
function renderNoticeDot() {
  const b = $('#btnNews');
  if (b) b.classList.toggle('new', !!(NOTICES.length && NOTICES[0].id !== noticeSeen()));
}

function noticeItemHtml(it, live) {
  const fn = it.go && NOTICE_GO[it.go], need = it.go && NOTICE_NEED[it.go];
  const can = live && fn && (!need || typeof window[need] === 'function');
  return `<div class="nw-item"><span class="nw-ico">${esc(it.icon || '✨')}</span><div class="nw-txt"><b>${esc(it.title || '')}</b><p>${esc(it.text || '')}</p></div>`
    + (can ? `<button type="button" class="small-btn nw-go" data-go="${esc(it.go)}">${esc(it.goLabel || '바로 가기')}</button>` : '') + '</div>';
}
function fmtNoticeDate(d) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d || '');
  return m ? `${+m[2]}월 ${+m[3]}일` : esc(d || '');
}
function openNotice() {
  if (!NOTICES.length) { toast('아직 공지가 없어요.'); return; }
  const seen = noticeSeen(), stale = noticeStale();
  const [top, ...old] = NOTICES;
  $('#nwStale').classList.toggle('hidden', !stale);
  $('#nwBody').innerHTML = `
    <section class="nw-card">
      <div class="nw-h"><h4>${esc(top.title || '업데이트')}</h4>${top.id !== seen ? '<em class="nw-new">NEW</em>' : ''}<small>${fmtNoticeDate(top.date)}</small></div>
      ${top.lead ? `<p class="nw-lead">${esc(top.lead)}</p>` : ''}
      <div class="nw-items">${(top.items || []).map((it) => noticeItemHtml(it, !stale)).join('')}</div>
    </section>
    ${old.length ? `<h5 class="nw-oldh">지난 소식</h5>${old.map((n) => `<details class="nw-old"><summary><b>${esc(n.title || '')}</b><small>${fmtNoticeDate(n.date)}</small></summary>`
      + `${n.lead ? `<p class="nw-lead">${esc(n.lead)}</p>` : ''}<div class="nw-items">${(n.items || []).map((it) => noticeItemHtml(it, !stale)).join('')}</div></details>`).join('')}` : ''}`;
  if (!$('#newsDlg').open) $('#newsDlg').showModal();
  $('#nwBody').scrollTop = 0;
}
function closeNotice() { const d = $('#newsDlg'); if (d.open) d.close(); }
$('#newsDlg').addEventListener('close', () => {
  if (NOTICES.length) store.set('noticeSeen', NOTICES[0].id);    // 한 번 보면 끝 (닫기·확인·바로 가기 모두)
  renderNoticeDot();
});
$('#nwOk').addEventListener('click', closeNotice);
$('#nwClose').addEventListener('click', closeNotice);
$('#nwReload').addEventListener('click', () => location.reload());
$('#nwBody').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-go]');
  if (!b) return;
  closeNotice();
  try { NOTICE_GO[b.dataset.go](); } catch (err) { console.warn('공지 바로 가기 오류', err); }
});
$('#btnNews').addEventListener('click', openNotice);

/* 로비에서 다른 창(알림 창 포함)이 없을 때만 자동으로 */
const noticeCanShow = () => !window.gateOpen && typeof currentScreen !== 'undefined' && currentScreen === 'lobby'
  && !document.hidden && !document.querySelector('dialog[open]') && !document.body.classList.contains('busy')
  && !document.querySelector('.on-menu:not(.hidden), #duelBox:not(.hidden)');   // 🔔 알림·리그·도전장 창이 떠 있으면 기다림
function noticeAuto() {
  clearInterval(noticeWait);
  if (!NOTICES.length || NOTICES[0].id === noticeSeen()) return;
  noticeWait = setInterval(() => {
    if (!NOTICES.length || NOTICES[0].id === noticeSeen()) { clearInterval(noticeWait); return; }
    if (noticeCanShow()) { clearInterval(noticeWait); openNotice(); }
  }, 1200);
}
loadNotices().then(noticeAuto);
// 창을 오래 켜 둔 사이에 업데이트가 올라왔는지 (로비에 있을 때 10분마다)
setInterval(() => {
  if (typeof currentScreen === 'undefined' || currentScreen !== 'lobby' || document.hidden || Date.now() - noticeFetchedAt < 9.5 * 60 * 1000) return;
  loadNotices().then((ok) => { if (ok) noticeAuto(); });
}, 60 * 1000);
