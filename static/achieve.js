/* 링크비트 업적 · 칭호
   - 판이 끝날 때 결과를 보고 업적을 확인 (기록이 남는 판만: 연습·테스트·채보 수정 플레이는 제외)
   - 달성하면 결과 화면 위에 '업적 달성!' 카드 + 효과음
   - 달성한 업적 하나를 칭호로 달면 방 인원·멀티 결과에서 이름 옆에 보여요
   - 저장: 브라우저(lb_ach, lb_achStats, lb_title) → 프로필로 서버에도 백업 */
'use strict';

const ACH = [
  { id: 'first', name: '첫 발걸음', desc: '곡을 처음으로 끝까지 플레이' },
  { id: 'clearB', name: '리듬 입문', desc: 'B 랭크 이상으로 클리어' },
  { id: 'fc1', name: '풀콤보', desc: '처음으로 풀콤보' },
  { id: 'ap1', name: '퍼펙트', desc: '처음으로 ALL PERFECT' },
  { id: 'ss', name: 'SS 랭커', desc: 'SS 랭크 달성 (정확도 98% 이상)' },
  { id: 'acc995', name: '정밀 기계', desc: '정확도 99.5% 이상' },
  { id: 'combo300', name: '300 콤보', desc: '한 판에 300 콤보' },
  { id: 'combo1000', name: '천 콤보', desc: '한 판에 1000 콤보' },
  { id: 'star5', name: '중수', desc: '★5 이상 곡을 B 랭크 이상으로 클리어' },
  { id: 'star7', name: '고수', desc: '★7 이상 곡을 B 랭크 이상으로 클리어' },
  { id: 'star85', name: '초고수', desc: '★8.5 이상 곡을 B 랭크 이상으로 클리어' },
  { id: 'extreme', name: '극한 도전자', desc: '극한 난이도를 B 랭크 이상으로 클리어' },
  { id: 'six', name: '여섯 손가락', desc: '6키로 B 랭크 이상 클리어' },
  { id: 'fever5', name: '불타는 손가락', desc: '피버 x5 도달' },
  { id: 'fc10', name: '콤보 장인', desc: '풀콤보 10번' },
  { id: 'ap10', name: '완벽주의자', desc: 'ALL PERFECT 10번' },
  { id: 'plays10', name: '단골손님', desc: '10판 플레이' },
  { id: 'plays100', name: '리듬 중독', desc: '100판 플레이' },
  { id: 'hl10', name: '하이라이트 사냥꾼', desc: '하이라이트 모드로 10판' },
  { id: 'multi1', name: '같이 하자', desc: '멀티 첫 판' },
  { id: 'multiwin', name: '1등!', desc: '멀티에서 1위 (2명 이상)' },
  { id: 'ghostwin', name: '고스트 버스터', desc: '고스트 대결에서 승리' },
  { id: 'mirror', name: '거울 나라', desc: '미러를 켜고 풀콤보' },
  { id: 'owl', name: '올빼미', desc: '새벽 2~5시에 한 판 끝까지' },
];
const ACH_BY = Object.fromEntries(ACH.map((a) => [a.id, a]));

function achGot() { const v = store.get('ach', {}); return v && typeof v === 'object' ? v : {}; }
function achTitle() { const id = store.get('title', ''); return (ACH_BY[id] && achGot()[id]) ? ACH_BY[id].name : ''; }

function achUnlock(ids) {
  const got = achGot();
  const fresh = ids.filter((id) => ACH_BY[id] && !got[id]);
  if (!fresh.length) return [];
  const now = Date.now();
  fresh.forEach((id) => { got[id] = now; });
  store.set('ach', got);
  if (typeof profileSync === 'function') profileSync();
  achPopup(fresh);
  renderMyTitle();
  return fresh;
}

/* 기록이 남는 판이 끝났을 때 (showResult에서 부름) */
function achieveOnResult(g, r) {
  const st = Object.assign({ plays: 0, fc: 0, ap: 0, hl: 0, multi: 0 }, store.get('achStats', {}) || {});
  const done = !r.incomplete;
  const ap = done && r.counts && r.counts.miss === 0 && r.counts.good === 0 && r.counts.great === 0;
  const fc = done && r.fc;
  const clear = done && r.acc >= 80;
  if (done) st.plays++;
  if (fc) st.fc++;
  if (ap) st.ap++;
  if (done && g.hl) st.hl++;
  if (g.multi) st.multi++;
  store.set('achStats', st);
  const ids = [];
  if (done) ids.push('first');
  if (clear) ids.push('clearB');
  if (fc) ids.push('fc1');
  if (ap) ids.push('ap1');
  if (done && r.rank === 'SS') ids.push('ss');
  if (done && r.acc >= 99.5) ids.push('acc995');
  if (r.maxCombo >= 300) ids.push('combo300');
  if (r.maxCombo >= 1000) ids.push('combo1000');
  if (clear && g.stars >= 5) ids.push('star5');
  if (clear && g.stars >= 7) ids.push('star7');
  if (clear && g.stars >= 8.5) ids.push('star85');
  if (clear && g.diff === 'extreme') ids.push('extreme');
  if (clear && g.nl === 6) ids.push('six');
  if ((g.maxFever || 1) >= 5) ids.push('fever5');
  if (st.fc >= 10) ids.push('fc10');
  if (st.ap >= 10) ids.push('ap10');
  if (st.plays >= 10) ids.push('plays10');
  if (st.plays >= 100) ids.push('plays100');
  if (st.hl >= 10) ids.push('hl10');
  if (g.multi) ids.push('multi1');
  if (g.ghostWin) ids.push('ghostwin');
  if (fc && g.modNames && g.modNames.includes('MIRROR')) ids.push('mirror');
  const h = new Date().getHours();
  if (done && h >= 2 && h < 5) ids.push('owl');
  achUnlock(ids);
}
/* 멀티 결과가 왔을 때: 2명 이상에서 내가 1위 */
function achieveOnMulti(m) {
  const rs = (m && m.results) || [];
  if (rs.length >= 2 && rs[0].id === net.id && !rs[0].incomplete && (rs[0].score || 0) > (rs[1].score || 0)) achUnlock(['multiwin']);
}

/* ---------------- 달성 연출: 결과 화면 위로 금빛 카드가 차례로 내려옴 */
let achQueue = [], achShowing = false;
function achPopup(ids) {
  achQueue.push(...ids);
  if (!achShowing) achNext();
}
function achChime() {
  const ctx = sfx.ensure();
  if (!ctx) return;
  const vol = clamp((settings.volume ?? 80) / 100, 0, 1) * 0.22;
  const t = ctx.currentTime + 0.02;
  [1046.5, 1318.5, 1568, 2093].forEach((f, i) => {
    const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
    const g = ctx.createGain();
    const s = t + i * 0.07;
    g.gain.setValueAtTime(0.0001, s); g.gain.linearRampToValueAtTime(vol, s + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, s + 0.5);
    o.connect(g).connect(ctx.destination); o.start(s); o.stop(s + 0.55);
  });
}
function achNext() {
  const id = achQueue.shift();
  if (!id) { achShowing = false; return; }
  achShowing = true;
  const a = ACH_BY[id];
  const el = document.createElement('div');
  el.className = 'ach-pop';
  el.innerHTML = `<span class="ap-ico">🏆</span><div><div class="ap-head">업적 달성!</div><div class="ap-name">${esc(a.name)}</div><div class="ap-desc">${esc(a.desc)}</div></div>`;
  el.addEventListener('click', () => { el.classList.add('out'); });
  document.body.appendChild(el);
  achChime();
  setTimeout(() => el.classList.add('out'), 2600);
  setTimeout(() => { el.remove(); achNext(); }, 3000);
}

/* ---------------- 업적 창 · 칭호 고르기 */
function renderAchDlg() {
  const got = achGot();
  const cur = store.get('title', '');
  const n = ACH.filter((a) => got[a.id]).length;
  $('#achCount').textContent = `${n} / ${ACH.length}`;
  $('#achFill').style.width = `${Math.round((n / ACH.length) * 100)}%`;
  $('#achTitleNow').innerHTML = achTitle() ? `지금 칭호: <b>${esc(achTitle())}</b> <button type="button" class="ghost small-btn" id="achTitleOff">떼기</button>` : '달성한 업적을 누르면 칭호로 달 수 있어요.';
  $('#achGrid').innerHTML = ACH.map((a) => {
    const at = got[a.id];
    const d = at ? new Date(at) : null;
    return `<button type="button" class="ach-item${at ? ' got' : ''}${cur === a.id && at ? ' cur' : ''}" data-id="${a.id}" ${at ? '' : 'disabled'}>
      <span class="ai-ico">${at ? '🏆' : '🔒'}</span>
      <span class="ai-name">${esc(a.name)}</span>
      <span class="ai-desc">${esc(a.desc)}</span>
      ${d ? `<span class="ai-date">${d.getMonth() + 1}/${d.getDate()}</span>` : ''}</button>`;
  }).join('');
  const off = $('#achTitleOff');
  if (off) off.onclick = () => achSetTitle('');
}
function achSetTitle(id) {
  store.set('title', id);
  if (typeof profileSync === 'function') profileSync();
  renderAchDlg();
  renderMyTitle();
  net.send({ type: 'hello', name: settings.nick || '', avatar: settings.avatar, title: achTitle(), diff: settings.diff, keys: settings.mode });
  if (id) toast(`칭호 '${ACH_BY[id].name}'을(를) 달았어요.`);
}
function renderMyTitle() {
  const el = $('#myTitle');
  if (!el) return;
  const t = achTitle();
  el.textContent = t;
  el.classList.toggle('hidden', !t);
}
$('#btnAch').addEventListener('click', () => { renderAchDlg(); $('#achDlg').showModal(); });
$('#achClose').addEventListener('click', () => $('#achDlg').close());
$('#achGrid').addEventListener('click', (e) => {
  const b = e.target.closest('.ach-item.got');
  if (!b) return;
  achSetTitle(store.get('title', '') === b.dataset.id ? '' : b.dataset.id);
});
renderMyTitle();
