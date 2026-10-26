/* 링크비트 시즌 패스 (무료) · 칭호 만들기 (앞말 + 뒷말)
   진짜 값(시즌 경험치·단계·서버가 준 단어)은 서버의 내 계정에 있어요. 업적·레벨·출석으로 여는 단어는 화면에서 바로 확인해요. */
'use strict';

/* ------------------------------------------------------------ 칭호 단어 */
const TITLE_WORDS = [
  // 앞말
  { id: 'f_rhythm', t: '리듬', how: '처음부터' },
  { id: 'f_plain', t: '평범한', how: '처음부터' },
  { id: 'f_grow', t: '성장하는', how: '레벨 5', lv: 5 },
  { id: 'f_vet', t: '노련한', how: '레벨 20', lv: 20 },
  { id: 'f_legend', t: '전설의', how: '레벨 50', lv: 50, legend: true },
  { id: 'f_steady', t: '꾸준한', how: '최고 7일 연속 출석', streak: 7 },
  { id: 'f_iron', t: '불굴의', how: '최고 30일 연속 출석', streak: 30 },
  { id: 'f_dawn', t: '새벽의', how: '업적 「올빼미」', ach: 'owl' },
  { id: 'f_morning', t: '아침형', how: '업적 「아침형 인간」', ach: 'early' },
  { id: 'f_unbroken', t: '끊김 없는', how: '업적 「풀콤보」', ach: 'fc1' },
  { id: 'f_perfect', t: '완벽한', how: '업적 「퍼펙트」', ach: 'ap1' },
  { id: 'f_extreme', t: '극한의', how: '업적 「극한 풀콤보」', ach: 'fcext' },
  { id: 'f_addicted', t: '리듬에 빠진', how: '업적 「리듬 중독」', ach: 'plays100' },
  { id: 'f_party', t: '파티를 여는', how: '업적 「파티 타임」', ach: 'party' },
  { id: 'f_mirror', t: '거울 속', how: '업적 「거울 나라」', ach: 'mirror' },
  { id: 'f_fate', t: '운명의', how: '업적 「운명에 맡겨」', ach: 'random' },
  { id: 'f_burning', t: '불타는', how: '업적 「불타는 손가락」', ach: 'fever5' },
  { id: 'f_thunder', t: '천둥 같은', how: '전설 업적 「천둥의 손」', ach: 'L_thunder', legend: true },
  { id: 'f_true', t: '진정한', how: '전설 업적 「링크비트 마스터」', ach: 'L_master', legend: true },
  { id: 'f_spooky', t: '으스스한', how: '할로윈 이벤트 때 한 판', srv: true, ev: 'hw26' },
  { id: 'f_autumn', t: '가을의', how: '시즌 1 패스 3단계', srv: true },
  { id: 'f_leafy', t: '낙엽 밟는', how: '시즌 1 패스 13단계', srv: true },
  { id: 'f_winter', t: '겨울의', how: '시즌 2 패스 3단계', srv: true },
  { id: 'f_frozen', t: '얼어붙은', how: '시즌 2 패스 13단계', srv: true },
  // 뒷말
  { id: 'b_player', t: '플레이어', how: '처음부터' },
  { id: 'b_fan', t: '음악 애호가', how: '처음부터' },
  { id: 'b_sprout', t: '새싹', how: '업적 「첫 발걸음」', ach: 'first' },
  { id: 'b_pro', t: '고수', how: '레벨 10', lv: 10 },
  { id: 'b_master', t: '마스터', how: '레벨 30', lv: 30 },
  { id: 'b_attend', t: '개근상', how: '최고 14일 연속 출석', streak: 14 },
  { id: 'b_combo', t: '연타왕', how: '업적 「천 콤보」', ach: 'combo1000' },
  { id: 'b_sniper', t: '저격수', how: '업적 「정밀 기계」', ach: 'acc995' },
  { id: 'b_collector', t: '수집가', how: '업적 「트로피 진열장」', ach: 'ss30' },
  { id: 'b_buddy', t: '단짝', how: '업적 「단짝」', ach: 'multi10' },
  { id: 'b_winner', t: '승부사', how: '업적 「연전연승」', ach: 'multiwin5' },
  { id: 'b_duelist', t: '결투가', how: '업적 「결투의 달인」', ach: 'duel10' },
  { id: 'b_king', t: '리그 왕', how: '업적 「주간 챔피언」', ach: 'champ1' },
  { id: 'b_hunter', t: '유령 사냥꾼', how: '업적 「고스트 버스터」', ach: 'ghostwin' },
  { id: 'b_godhand', t: '신의 손', how: '전설 업적 「신의 손」', ach: 'L_godhand', legend: true },
  { id: 'b_champion', t: '챔피언', how: '전설 업적 「무패의 챔피언」', ach: 'L_champ', legend: true },
  { id: 'b_pumpkin', t: '호박 대왕', how: '할로윈 이벤트 미션 모두', srv: true, ev: 'hw26' },
  { id: 'b_maple', t: '단풍잎', how: '시즌 1 패스 8단계', srv: true },
  { id: 'b_fairy', t: '가을 요정', how: '시즌 1 패스 18단계', srv: true },
  { id: 'b_snowman', t: '눈사람', how: '시즌 2 패스 8단계', srv: true },
  { id: 'b_santa', t: '산타', how: '시즌 2 패스 18단계', srv: true },
];
const WORD_BY = Object.fromEntries(TITLE_WORDS.map((w) => [w.id, w]));
const LEGEND_WORDS = TITLE_WORDS.filter((w) => w.legend).map((w) => w.t);
function wordOpen(w) {
  if (w.lv) return (typeof myLevel === 'function' ? myLevel() : 1) >= w.lv;
  if (w.streak) return ((myGrow && myGrow.streak) || {}).best >= w.streak;
  if (w.ach) return typeof achGot === 'function' && !!achGot()[w.ach];
  if (w.srv) return !!(myGrow && Array.isArray(myGrow.words) && myGrow.words.includes(w.id));
  return true;
}
/* 지금 단 칭호 (앞말 + 뒷말) — 둘 다 열려 있을 때만 */
function titleComboText(c = store.get('titleCombo', null)) {
  if (!c || !WORD_BY[c.f] || !WORD_BY[c.b]) return '';
  if (myGrow && (!wordOpen(WORD_BY[c.f]) || !wordOpen(WORD_BY[c.b]))) return '';
  return `${WORD_BY[c.f].t} ${WORD_BY[c.b].t}`;
}
function titleHasLegendWord(t) {
  return LEGEND_WORDS.some((w) => t.startsWith(w + ' ') || t.endsWith(' ' + w));
}

/* 업적 창 안의 '칭호 만들기' */
let tcSel = null;
function renderTitleMaker() {
  if (!$('#tcFront')) return;
  if (!tcSel) tcSel = Object.assign({ f: '', b: '' }, store.get('titleCombo', null) || {});
  const chip = (w) => {
    const open = wordOpen(w);
    const gone = !open && w.ev && !(myGrow && myGrow.event && myGrow.event.id === w.ev);
    if (gone) return '';
    const on = tcSel[w.id[0]] === w.id;
    return `<button type="button" class="tc-chip${on ? ' on' : ''}${open ? '' : ' lock'}${w.legend ? ' legend' : ''}" data-w="${w.id}" ${open ? '' : 'disabled'} title="${esc(open ? w.t : `🔒 ${w.how}`)}">${open ? '' : '🔒'}${esc(w.t)}</button>`;
  };
  $('#tcFront').innerHTML = TITLE_WORDS.filter((w) => w.id[0] === 'f').map(chip).join('');
  $('#tcBack').innerHTML = TITLE_WORDS.filter((w) => w.id[0] === 'b').map(chip).join('');
  const f = WORD_BY[tcSel.f], b = WORD_BY[tcSel.b];
  const t = f && b ? `${f.t} ${b.t}` : f ? `${f.t} …` : b ? `… ${b.t}` : '앞말과 뒷말을 골라 보세요';
  const pv = $('#tcPreview');
  pv.textContent = t;
  pv.classList.toggle('legend', !!(f && b) && titleHasLegendWord(t));
  pv.classList.toggle('empty', !(f && b));
  const cur = titleComboText();
  $('#tcApply').disabled = !(f && b) || cur === t;
  $('#tcApply').textContent = cur === t ? '지금 단 칭호예요' : '이 칭호 달기';
}
$('#achDlg').addEventListener('click', (e) => {
  const c = e.target.closest('.tc-chip:not(.lock)');
  if (c) {
    const k = c.dataset.w[0];
    tcSel[k] = tcSel[k] === c.dataset.w ? '' : c.dataset.w;
    renderTitleMaker();
    return;
  }
  if (e.target.closest('#tcApply') && tcSel && tcSel.f && tcSel.b) {
    store.set('titleCombo', { f: tcSel.f, b: tcSel.b });
    store.set('title', '');
    if (typeof profileSync === 'function') profileSync();
    if (typeof renderMyTitle === 'function') renderMyTitle();
    net.send(helloMsg());
    toast(`칭호 '${titleComboText()}'을(를) 달았어요.`);
    if (typeof renderAchDlg === 'function') renderAchDlg();
  }
});
$('#achDlg').addEventListener('close', () => { tcSel = null; });
$('#myTitle').addEventListener('click', () => $('#btnAch').click());

/* ------------------------------------------------------------ 🎫 시즌 패스 */
const SS_THEME = { autumn: { ico: '🍁', c: '#ff8a1e' }, winter: { ico: '❄️', c: '#7fd0ff' } };
function ssRewardHtml(r) {
  if (r.kind === 'coin') return `<span class="ss-ico">♪</span><b>${fmtN(r.val)}♪</b>`;
  if (r.kind === 'word') { const w = WORD_BY[r.val]; return `<span class="ss-ico">🏷</span><b>${esc(w ? w.t : r.val)}</b><small>칭호 단어</small>`; }
  const it = itemOf(r.val);
  const catN = it && SHOP ? (SHOP.cats.find((c) => c[0] === it.cat) || [0, ''])[1] : '';
  return `<span class="si-sw sw-${esc(r.val)}">${it ? swInner(it) : '🎁'}</span><b>${esc(it ? it.name : r.val)}</b><small>${esc(catN)}</small>`;
}
function renderSeasonBar() {
  const b = $('#gbSeason');
  const S = myGrow && myGrow.season;
  b.classList.toggle('hidden', !S);
  if (!S) return;
  const th = SS_THEME[S.theme] || { ico: '🎫' };
  const into = S.xp - S.tier * S.step;
  b.innerHTML = `<span class="gs-h">${th.ico} ${esc(S.name)}</span><b>${S.tier}단계</b><span class="gs-p"><i style="width:${Math.round(Math.min(1, into / S.step) * 100)}%"></i></span>`;
  b.style.setProperty('--ss', th.c || '#ffc83d');
}
function renderSeasonDlg() {
  const S = myGrow && myGrow.season;
  if (!S) return;
  const th = SS_THEME[S.theme] || { ico: '🎫', c: '#ffc83d' };
  $('#seasonDlg').style.setProperty('--ss', th.c);
  $('#ssName').textContent = `${th.ico} ${S.name}`;
  $('#ssLeft').textContent = `${fmtDur(S.endsIn)} 남음`;
  const into = S.xp - S.tier * S.step;
  $('#ssTier').textContent = `${S.tier}단계`;
  $('#ssFill').style.width = `${Math.round(Math.min(1, into / S.step) * 100)}%`;
  $('#ssXp').textContent = S.tier >= S.max ? `20단계 완료! 이제부터 ${fmtN(S.step)} XP마다 +${S.overCoin}♪ · 다음까지 ${fmtN(S.step - into)} XP`
    : `다음 단계까지 ${fmtN(S.step - into)} XP · 시즌 경험치 ${fmtN(S.xp)}`;
  $('#ssTrack').innerHTML = S.tiers.map((r) => {
    const got = r.tier <= S.tier, big = r.kind === 'item';
    return `<div class="ss-cell${got ? ' got' : ''}${big ? ' big' : ''}${r.tier === S.tier + 1 ? ' next' : ''}"><span class="ss-n">${r.tier}</span>${ssRewardHtml(r)}${got ? '<span class="ss-ok">✓</span>' : ''}</div>`;
  }).join('');
  const nx = $('#ssTrack .ss-cell.next') || $('#ssTrack .ss-cell:last-child');
  if (nx) nx.scrollIntoView({ inline: 'center', block: 'nearest' });
}
async function openSeason() {
  if (!myGrow || !myGrow.season) return;
  await loadShopItems();
  renderSeasonDlg();
  if (!$('#seasonDlg').open) $('#seasonDlg').showModal();
  renderSeasonDlg();
  loadMe();
}
$('#gbSeason').addEventListener('click', openSeason);
$('#ssClose').addEventListener('click', () => $('#seasonDlg').close());
$('#ssTrack').addEventListener('click', (e) => {
  const c = e.target.closest('.ss-cell.big');
  if (!c) return;
  const sw = $('.si-sw', c);
  const id = sw && [...sw.classList].find((k) => k.startsWith('sw-'));
  if (id && itemOf(id.slice(3))) { $('#seasonDlg').close(); openShop(id.slice(3)); }
});

/* 결과 화면 한 줄 */
function seasonResultLine(rw) {
  const S = rw && rw.season;
  if (!S) return '';
  const got = (S.got || []).map((g) => g.coin ? `+${g.coin}♪` : g.word ? `🏷 '${esc((WORD_BY[g.word] || {}).t || g.word)}'` : `🎁 ${esc((itemOf(g.item) || {}).name || g.item)}`);
  return `<div class="rw-line rw-ss">🎫 ${esc(S.name)} <b>${S.tier}단계</b> <small>+${fmtN(S.gain)} 시즌 XP</small>${got.length ? ` <span class="rw-ssg">⬆ 단계 상승! ${got.join(' · ')}</span>` : ''}</div>`;
}
