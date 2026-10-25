/* 링크비트 업적 · 칭호
   - 판이 끝날 때 결과를 보고 업적을 확인 (기록이 남는 판만: 연습·테스트·채보 수정 플레이는 제외)
   - 달성하면 결과 화면 위에 '업적 달성!' 카드 + 효과음
   - 달성한 업적 하나를 칭호로 달면 방 인원·멀티 결과에서 이름 옆에 보여요
   - 저장: 브라우저(lb_ach, lb_achStats, lb_title) → 프로필로 서버에도 백업 */
'use strict';

/* cat: 업적 창의 묶음 · goal: 횟수 업적이면 목표 (창에 '7/10' 진행도) */
const ACH_CATS = ['전설', '시작', '등급', '콤보', '난이도', '꾸준함', '곡 탐험', '멀티', '도전', '재미'];
const ACH = [
  // 시작
  { id: 'first', cat: '시작', name: '첫 발걸음', desc: '곡을 처음으로 끝까지 플레이' },
  { id: 'clearB', cat: '시작', name: '리듬 입문', desc: 'B 랭크 이상으로 클리어' },
  { id: 'fc1', cat: '시작', name: '풀콤보', desc: '처음으로 풀콤보' },
  { id: 'ap1', cat: '시작', name: '퍼펙트', desc: '처음으로 ALL PERFECT' },
  { id: 'myav', cat: '시작', name: '나만의 캐릭터', desc: 'AI 캐릭터를 만들고 한 판' },
  // 등급
  { id: 'ss', cat: '등급', name: 'SS 랭커', desc: 'SS 랭크 이상 (정확도 98%)' },
  { id: 'sss', cat: '등급', name: 'SSS 랭커', desc: 'SSS 랭크 이상 (정확도 99%)' },
  { id: 'acc995', cat: '등급', name: '정밀 기계', desc: '정확도 99.5% 이상' },
  { id: 'maxhard', cat: '등급', name: '완벽한 어려움', desc: '어려움 이상에서 MAX (전부 PERFECT)' },
  { id: 's10', cat: '등급', name: 'S 수집가', desc: 'S 랭크 이상 기록 10곡·난이도', goal: 10, stat: 'sRec' },
  { id: 'ss30', cat: '등급', name: '트로피 진열장', desc: 'SS 랭크 이상 기록 30곡·난이도', goal: 30, stat: 'ssRec' },
  // 콤보
  { id: 'combo300', cat: '콤보', name: '300 콤보', desc: '한 판에 300 콤보' },
  { id: 'combo500', cat: '콤보', name: '500 콤보', desc: '한 판에 500 콤보' },
  { id: 'combo1000', cat: '콤보', name: '천 콤보', desc: '한 판에 1000 콤보' },
  { id: 'combo2000', cat: '콤보', name: '끝없는 연타', desc: '한 판에 2000 콤보' },
  { id: 'fchard', cat: '콤보', name: '어려움 풀콤보', desc: '어려움 이상에서 풀콤보' },
  { id: 'fcext', cat: '콤보', name: '극한 풀콤보', desc: '극한 난이도 풀콤보' },
  { id: 'fc6', cat: '콤보', name: '여섯 손가락 풀콤보', desc: '6키로 풀콤보' },
  { id: 'fc10', cat: '콤보', name: '콤보 장인', desc: '풀콤보 10번', goal: 10, stat: 'fc' },
  { id: 'ap10', cat: '콤보', name: '완벽주의자', desc: 'ALL PERFECT 10번', goal: 10, stat: 'ap' },
  { id: 'perf10k', cat: '콤보', name: '만 번의 두드림', desc: 'PERFECT 누적 10,000개', goal: 10000, stat: 'perf' },
  { id: 'perf50k', cat: '콤보', name: '오만 번의 두드림', desc: 'PERFECT 누적 50,000개', goal: 50000, stat: 'perf' },
  // 난이도
  { id: 'star5', cat: '난이도', name: '중수', desc: '★5 이상 곡을 B 랭크 이상으로 클리어' },
  { id: 'star7', cat: '난이도', name: '고수', desc: '★7 이상 곡을 B 랭크 이상으로 클리어' },
  { id: 'star85', cat: '난이도', name: '초고수', desc: '★8.5 이상 곡을 B 랭크 이상으로 클리어' },
  { id: 'star95', cat: '난이도', name: '전설', desc: '★9.5 이상 곡을 B 랭크 이상으로 클리어' },
  { id: 'extreme', cat: '난이도', name: '극한 도전자', desc: '극한 난이도를 B 랭크 이상으로 클리어' },
  { id: 'six', cat: '난이도', name: '여섯 손가락', desc: '6키로 B 랭크 이상 클리어' },
  { id: 'allfour', cat: '난이도', name: '사계절', desc: '한 곡의 쉬움·보통·어려움·극한을 모두 B 이상 클리어' },
  // 꾸준함
  { id: 'plays10', cat: '꾸준함', name: '단골손님', desc: '10판 플레이', goal: 10, stat: 'plays' },
  { id: 'plays100', cat: '꾸준함', name: '리듬 중독', desc: '100판 플레이', goal: 100, stat: 'plays' },
  { id: 'plays500', cat: '꾸준함', name: '리듬 그 자체', desc: '500판 플레이', goal: 500, stat: 'plays' },
  { id: 'day10', cat: '꾸준함', name: '오늘도 열심히', desc: '하루에 10판', goal: 10, stat: 'dayN' },
  { id: 'streak3', cat: '꾸준함', name: '꾸준함', desc: '3일 연속 플레이', goal: 3, stat: 'streak' },
  { id: 'streak7', cat: '꾸준함', name: '일주일 개근', desc: '7일 연속 플레이', goal: 7, stat: 'streak' },
  // 곡 탐험
  { id: 'songs10', cat: '곡 탐험', name: '탐험가', desc: '서로 다른 곡 10곡 플레이', goal: 10, stat: 'songN' },
  { id: 'songs30', cat: '곡 탐험', name: '음악 박사', desc: '서로 다른 곡 30곡 플레이', goal: 30, stat: 'songN' },
  { id: 'same10', cat: '곡 탐험', name: '최애곡', desc: '같은 곡을 10번 플레이', goal: 10, stat: 'sameMax' },
  { id: 'hl10', cat: '곡 탐험', name: '하이라이트 사냥꾼', desc: '하이라이트 모드로 10판', goal: 10, stat: 'hl' },
  { id: 'ai10', cat: '곡 탐험', name: 'AI와 함께', desc: 'AI 채보로 10판', goal: 10, stat: 'ai' },
  { id: 'marathon', cat: '곡 탐험', name: '마라톤', desc: '5분이 넘는 곡을 끝까지' },
  { id: 'daily1', cat: '곡 탐험', name: '오늘의 도전', desc: '오늘의 곡을 끝까지' },
  { id: 'daily7', cat: '곡 탐험', name: '매일매일 도전', desc: '오늘의 곡을 서로 다른 7일 동안', goal: 7, stat: 'dailyN' },
  { id: 'dailytop', cat: '곡 탐험', name: '오늘의 1등', desc: '오늘의 곡 순위 1위 (2명 이상)' },
  // 멀티
  { id: 'multi1', cat: '멀티', name: '같이 하자', desc: '멀티 첫 판' },
  { id: 'multi10', cat: '멀티', name: '단짝', desc: '멀티 10판', goal: 10, stat: 'multi' },
  { id: 'multiwin', cat: '멀티', name: '1등!', desc: '멀티에서 1위 (2명 이상)' },
  { id: 'multiwin5', cat: '멀티', name: '연전연승', desc: '멀티에서 1위 5번', goal: 5, stat: 'mwin' },
  { id: 'party', cat: '멀티', name: '파티 타임', desc: '4명 이상 같이 한 판' },
  { id: 'close', cat: '멀티', name: '박빙', desc: '2등과 1,000점 차이 안으로 1위' },
  // 도전
  { id: 'fever5', cat: '도전', name: '불타는 손가락', desc: '피버 x5 도달' },
  { id: 'ghostwin', cat: '도전', name: '고스트 버스터', desc: '고스트 대결에서 승리' },
  { id: 'ghost10', cat: '도전', name: '나를 넘어서', desc: '고스트 대결 10번 승리', goal: 10, stat: 'ghost' },
  { id: 'mirror', cat: '도전', name: '거울 나라', desc: '미러를 켜고 풀콤보' },
  { id: 'random', cat: '도전', name: '운명에 맡겨', desc: '랜덤을 켜고 B 랭크 이상 클리어' },
  { id: 'fasteye', cat: '도전', name: '매의 눈', desc: '노트 속도 8 이상으로 S 랭크 이상' },
  { id: 'onbeat', cat: '도전', name: '정확한 박자', desc: '판정 오차 평균 ±5ms 안으로 B 이상 클리어 (노트 100개 이상)' },
  // 재미
  { id: 'owl', cat: '재미', name: '올빼미', desc: '새벽 2~5시에 한 판 끝까지' },
  { id: 'early', cat: '재미', name: '아침형 인간', desc: '아침 6~8시에 한 판 끝까지' },
  { id: 'lunch', cat: '재미', name: '점심시간', desc: '낮 12~1시에 한 판 끝까지' },
  { id: 'onemiss', cat: '재미', name: '아깝다!', desc: 'MISS 딱 하나로 끝냄' },
  { id: 'clutch', cat: '재미', name: '아슬아슬', desc: '정확도 80.00~80.49%로 B 랭크 클리어' },
  { id: 'comeback', cat: '재미', name: '포기하지 않아', desc: 'MISS 30개 넘게 나고도 B 랭크 이상' },
  // 전설: 정말 어려운 업적 — 칭호가 무지개빛으로 반짝임
  { id: 'L_godhand', cat: '전설', tier: 'legend', name: '신의 손', desc: '★9.5 이상 곡에서 MAX (전부 PERFECT)' },
  { id: 'L_iron', cat: '전설', tier: 'legend', name: '강철 손가락', desc: '5분이 넘는 곡의 극한 난이도를 MAX' },
  { id: 'L_wings', cat: '전설', tier: 'legend', name: '여섯 날개', desc: '6키 극한 난이도를 MAX' },
  { id: 'L_chaos', cat: '전설', tier: 'legend', name: '혼돈의 지배자', desc: '랜덤을 켜고 극한 난이도 풀콤보' },
  { id: 'L_metro', cat: '전설', tier: 'legend', name: '인간 메트로놈', desc: '노트 500개 이상 곡에서 정확도 99% 이상 + 판정 오차 평균 ±2ms 안' },
  { id: 'L_light', cat: '전설', tier: 'legend', name: '광속', desc: '노트 속도 10으로 ★8 이상 곡 SSS 이상' },
  { id: 'L_endless', cat: '전설', tier: 'legend', name: '끝나지 않는 노래', desc: '한 판에 3000 콤보' },
  { id: 'L_max50', cat: '전설', tier: 'legend', name: '완벽 그 자체', desc: 'MAX 기록 50곡·난이도', goal: 50, stat: 'maxRec' },
  { id: 'L_ext20', cat: '전설', tier: 'legend', name: '극한의 지배자', desc: '극한 난이도 SSS 이상 기록 20곡', goal: 20, stat: 'extSSS' },
  { id: 'L_conquer', cat: '전설', tier: 'legend', name: '정복자', desc: '모든 곡(10곡 이상)의 극한 난이도를 S 이상 (4키)', goal: () => Math.max(10, typeof songs !== 'undefined' ? songs.length : 10), stat: 'conquerN' },
  { id: 'L_monk', cat: '전설', tier: 'legend', name: '리듬 수도승', desc: '30일 연속 플레이', goal: 30, stat: 'streak' },
  { id: 'L_living', cat: '전설', tier: 'legend', name: '살아있는 전설', desc: '1000판 플레이', goal: 1000, stat: 'plays' },
  { id: 'L_thunder', cat: '전설', tier: 'legend', name: '천둥의 손', desc: 'PERFECT 누적 200,000개', goal: 200000, stat: 'perf' },
  { id: 'L_champ', cat: '전설', tier: 'legend', name: '무패의 챔피언', desc: '멀티에서 1위 50번', goal: 50, stat: 'mwin' },
  { id: 'L_master', cat: '전설', tier: 'legend', name: '링크비트 마스터', desc: '다른 업적을 모두 달성' },
];
const goalOf = (a) => (typeof a.goal === 'function' ? a.goal() : a.goal);
const LEGEND_TITLES = new Set(ACH.filter((a) => a.tier === 'legend').map((a) => a.name));
function achIsLegend(t) { return !!t && LEGEND_TITLES.has(t); }
const ACH_BY = Object.fromEntries(ACH.map((a) => [a.id, a]));

function achGot() { const v = store.get('ach', {}); return v && typeof v === 'object' ? v : {}; }
function achTitle() { const id = store.get('title', ''); return (ACH_BY[id] && achGot()[id]) ? ACH_BY[id].name : ''; }
function achStats() {
  const st = Object.assign({ plays: 0, fc: 0, ap: 0, hl: 0, multi: 0, ai: 0, perf: 0, ghost: 0, mwin: 0, songs: {}, day: '', dayN: 0, streak: 0 }, store.get('achStats', {}) || {});
  if (!st.songs || typeof st.songs !== 'object') st.songs = {};
  return st;
}
const dayKey = (t = new Date()) => `${t.getFullYear()}-${t.getMonth() + 1}-${t.getDate()}`;

function achUnlock(ids) {
  const got = achGot();
  const fresh = [...new Set(ids)].filter((id) => ACH_BY[id] && !got[id]);
  if (!fresh.length) return [];
  const now = Date.now();
  fresh.forEach((id) => { got[id] = now; });
  if (!got.L_master && ACH.every((a) => a.id === 'L_master' || got[a.id])) { got.L_master = now; fresh.push('L_master'); }
  store.set('ach', got);
  if (typeof profileSync === 'function') profileSync();
  achPopup(fresh);
  renderMyTitle();
  return fresh;
}

/* 내 기록(곡 목록의 최고 기록)에서 셀 수 있는 것: S·SS 이상 기록 수, 해 본 곡 수, 사계절 — 예전에 한 판도 셈 */
function achFromRecords() {
  const out = { sRec: 0, ssRec: 0, maxRec: 0, extSSS: 0, conquerN: 0, played: new Set(), allfour: false, sss: false, fchard: false, fcext: false, fc6: false };
  if (typeof songs === 'undefined' || typeof myRecord !== 'function') return out;
  const iS = RANKS.indexOf('S'), iSS = RANKS.indexOf('SS'), iSSS = RANKS.indexOf('SSS'), iMAX = RANKS.indexOf('MAX');
  for (const s of songs) {
    let cleared = 0;
    for (const nl of [4, 6]) {
      for (const d of DIFFS) {
        const r = myRecord(s, nl, d, false, false) || myRecord(s, nl, d, false, true);
        if (!r) continue;
        out.played.add(s.id);
        const k = RANKS.indexOf(rankFor(r));
        if (k >= iS) out.sRec++;
        if (k >= iSS) out.ssRec++;
        if (k >= iSSS) out.sss = true;
        if (k >= iMAX) out.maxRec++;
        if (k >= iSSS && d === 'extreme') out.extSSS++;
        if (k >= iS && d === 'extreme' && nl === 4) out.conquerN++;
        if (r.fc && (d === 'hard' || d === 'extreme')) out.fchard = true;
        if (r.fc && d === 'extreme') out.fcext = true;
        if (r.fc && nl === 6) out.fc6 = true;
        if (nl === 4 && +r.acc >= 80) cleared |= 1 << DIFFS.indexOf(d);
      }
    }
    if (cleared === (1 << DIFFS.length) - 1) out.allfour = true;
  }
  return out;
}
/* 진행도에 쓰는 값 (창에 7/10 처럼) */
function achProgress(st = achStats(), rec = achFromRecords()) {
  const songN = new Set([...Object.keys(st.songs), ...rec.played]).size;
  const sameMax = Math.max(0, ...Object.values(st.songs).map((v) => +v || 0));
  const today = st.day === dayKey() ? st.dayN : 0;
  return { ...st, songN, sameMax, dayN: today, dailyN: Object.keys(st.dailyDays || {}).length, sRec: rec.sRec, ssRec: rec.ssRec, maxRec: rec.maxRec, extSSS: rec.extSSS, conquerN: rec.conquerN };
}
function achGoalIds(pr) { return ACH.filter((a) => a.goal && (pr[a.stat] || 0) >= goalOf(a)).map((a) => a.id); }
/* 기록만 보고 줄 수 있는 업적 (업적 창을 열 때·판이 끝날 때) */
function achRetro() {
  const rec = achFromRecords();
  const ids = achGoalIds(achProgress(achStats(), rec));
  if (rec.allfour) ids.push('allfour');
  if (rec.sss) ids.push('sss', 'ss');
  if (rec.fchard) ids.push('fchard');
  if (rec.fcext) ids.push('fcext');
  if (rec.fc6) ids.push('fc6');
  achUnlock(ids);
}

/* 기록이 남는 판이 끝났을 때 (showResult에서 부름) */
function achieveOnResult(g, r) {
  const st = achStats();
  const done = !r.incomplete;
  const c = r.counts || {};
  const ap = done && c.miss === 0 && c.good === 0 && c.great === 0;
  const fc = done && r.fc;
  const clear = done && r.acc >= 80;
  const rk = RANKS.indexOf(r.rank);
  if (done) {
    st.plays++;
    st.songs[g.song.id] = (st.songs[g.song.id] || 0) + 1;
    const today = dayKey();
    if (st.day !== today) {      // 연속 플레이: 어제도 했으면 +1, 아니면 1부터
      const y = new Date(); y.setDate(y.getDate() - 1);
      st.streak = st.day === dayKey(y) ? (st.streak || 0) + 1 : 1;
      st.day = today; st.dayN = 0;
    }
    st.dayN++;
    st.perf += c.perfect || 0;
    if (g.ai) st.ai++;
  }
  if (fc) st.fc++;
  if (ap) st.ap++;
  if (done && g.hl) st.hl++;
  if (g.multi) st.multi++;
  if (g.ghostWin) st.ghost++;
  store.set('achStats', st);
  const ids = achGoalIds(achProgress(st));
  const mods = g.modNames || [];
  if (done) ids.push('first');
  if (clear) ids.push('clearB');
  if (fc) ids.push('fc1');
  if (ap) ids.push('ap1');
  if (done && settings.avatar && settings.avatar.ai) ids.push('myav');
  if (done && rk >= RANKS.indexOf('SS')) ids.push('ss');      // SS 이상 (SSS·MAX도)
  if (done && rk >= RANKS.indexOf('SSS')) ids.push('sss');
  if (done && r.acc >= 99.5) ids.push('acc995');
  if (ap && (g.diff === 'hard' || g.diff === 'extreme')) ids.push('maxhard');
  if (r.maxCombo >= 300) ids.push('combo300');
  if (r.maxCombo >= 500) ids.push('combo500');
  if (r.maxCombo >= 1000) ids.push('combo1000');
  if (r.maxCombo >= 2000) ids.push('combo2000');
  if (fc && (g.diff === 'hard' || g.diff === 'extreme')) ids.push('fchard');
  if (fc && g.diff === 'extreme') ids.push('fcext');
  if (fc && g.nl === 6) ids.push('fc6');
  if (clear && g.stars >= 5) ids.push('star5');
  if (clear && g.stars >= 7) ids.push('star7');
  if (clear && g.stars >= 8.5) ids.push('star85');
  if (clear && g.stars >= 9.5) ids.push('star95');
  if (clear && g.diff === 'extreme') ids.push('extreme');
  if (clear && g.nl === 6) ids.push('six');
  if (done && !g.hl && (g.song.duration || 0) >= 300) ids.push('marathon');
  if ((g.maxFever || 1) >= 5) ids.push('fever5');
  if (g.multi) ids.push('multi1');
  if (g.ghostWin) ids.push('ghostwin');
  if (fc && mods.includes('MIRROR')) ids.push('mirror');
  if (clear && mods.includes('RANDOM')) ids.push('random');
  if (done && rk >= RANKS.indexOf('S') && (settings.speed || 0) >= 8) ids.push('fasteye');
  const off = g.offsets || [];
  if (clear && off.length >= 100 && Math.abs(off.reduce((a, b) => a + b, 0) / off.length) <= 0.005) ids.push('onbeat');
  if (done && c.miss === 1) ids.push('onemiss');
  if (clear && r.acc < 80.5) ids.push('clutch');
  if (clear && (c.miss || 0) > 30) ids.push('comeback');
  if (ap && g.stars >= 9.5) ids.push('L_godhand');
  if (ap && !g.hl && g.diff === 'extreme' && (g.song.duration || 0) >= 300) ids.push('L_iron');
  if (ap && g.nl === 6 && g.diff === 'extreme') ids.push('L_wings');
  if (fc && g.diff === 'extreme' && mods.includes('RANDOM')) ids.push('L_chaos');
  if (done && r.acc >= 99 && off.length >= 500 && Math.abs(off.reduce((a, b) => a + b, 0) / off.length) <= 0.002) ids.push('L_metro');
  if (done && (settings.speed || 0) >= 10 && g.stars >= 8 && rk >= RANKS.indexOf('SSS')) ids.push('L_light');
  if (r.maxCombo >= 3000) ids.push('L_endless');
  const h = new Date().getHours();
  if (done && h >= 2 && h < 5) ids.push('owl');
  if (done && h >= 6 && h < 8) ids.push('early');
  if (done && h === 12) ids.push('lunch');
  achUnlock(ids);
  setTimeout(achRetro, 3500);      // 기록이 저장된 뒤 (S 수집가·사계절 등)
}
/* 오늘의 곡을 끝까지 했을 때 (순위를 받은 뒤) */
function achieveOnDaily(pos, day) {
  const st = achStats();
  st.dailyDays = Object.assign({}, st.dailyDays || {}, { [day]: 1 });
  const keep = Object.keys(st.dailyDays).sort().slice(-60);           // 오래된 날은 정리
  st.dailyDays = Object.fromEntries(keep.map((k) => [k, 1]));
  store.set('achStats', st);
  const ids = ['daily1', ...achGoalIds(achProgress(st))];
  if (pos === 1 && daily && (daily.board || []).length >= 2) ids.push('dailytop');
  achUnlock(ids);
}
/* 멀티 결과가 왔을 때: 2명 이상에서 내가 1위 · 4명 이상 · 박빙 */
function achieveOnMulti(m) {
  const rs = (m && m.results) || [];
  const ids = [];
  if (rs.length >= 4 && rs.some((x) => x.id === net.id)) ids.push('party');
  if (rs.length >= 2 && rs[0].id === net.id && !rs[0].incomplete && (rs[0].score || 0) > (rs[1].score || 0)) {
    ids.push('multiwin');
    if ((rs[0].score || 0) - (rs[1].score || 0) <= 1000) ids.push('close');
    const st = achStats();
    st.mwin = (st.mwin || 0) + 1;
    store.set('achStats', st);
    if (st.mwin >= 5) ids.push('multiwin5');
  }
  achUnlock(ids);
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
  const lg = a.tier === 'legend';
  el.className = 'ach-pop' + (lg ? ' legend' : '');
  el.innerHTML = `<span class="ap-ico">${lg ? '👑' : '🏆'}</span><div><div class="ap-head">${lg ? '✦ 전설 업적 달성! ✦' : '업적 달성!'}</div><div class="ap-name">${esc(a.name)}</div><div class="ap-desc">${esc(a.desc)}</div></div>`;
  el.addEventListener('click', () => { el.classList.add('out'); });
  document.body.appendChild(el);
  achChime();
  setTimeout(() => el.classList.add('out'), 2600);
  setTimeout(() => { el.remove(); achNext(); }, 3000);
}

/* ---------------- 업적 창 · 칭호 고르기 */
function renderAchDlg() {
  achRetro();
  const got = achGot();
  const cur = store.get('title', '');
  const n = ACH.filter((a) => got[a.id]).length;
  const pr = achProgress();
  $('#achCount').textContent = `${n} / ${ACH.length}`;
  $('#achFill').style.width = `${Math.round((n / ACH.length) * 100)}%`;
  $('#achTitleNow').innerHTML = achTitle() ? `지금 칭호: <b class="${achIsLegend(achTitle()) ? 'ptitle legend' : ''}">${esc(achTitle())}</b> <button type="button" class="ghost small-btn" id="achTitleOff">떼기</button>` : '달성한 업적을 누르면 칭호로 달 수 있어요.';
  $('#achGrid').innerHTML = ACH_CATS.map((cat) => {
    const list = ACH.filter((a) => a.cat === cat);
    const k = list.filter((a) => got[a.id]).length;
    const head = cat === '전설' ? '✦ 전설 <em>정말 어려운 업적 · 칭호가 무지개빛으로 반짝여요</em>' : esc(cat);
    return `<h4 class="ach-cat${cat === '전설' ? ' legend' : ''}">${head} <small>${k}/${list.length}</small></h4>` + list.map((a) => {
      const at = got[a.id];
      const d = at ? new Date(at) : null;
      const goal = a.goal ? goalOf(a) : 0;
      const v = goal ? Math.min(goal, pr[a.stat] || 0) : 0;
      const bar = goal && !at ? `<span class="ai-prog"><i style="width:${Math.round((v / goal) * 100)}%"></i></span><span class="ai-num">${v.toLocaleString()} / ${goal.toLocaleString()}</span>` : '';
      const lg = a.tier === 'legend';
      return `<button type="button" class="ach-item${lg ? ' legend' : ''}${at ? ' got' : ''}${cur === a.id && at ? ' cur' : ''}" data-id="${a.id}" ${at ? '' : 'disabled'}>
      <span class="ai-ico">${at ? (lg ? '👑' : '🏆') : '🔒'}</span>
      <span class="ai-name">${esc(a.name)}</span>
      <span class="ai-desc">${esc(a.desc)}</span>${bar}
      ${d ? `<span class="ai-date">${d.getMonth() + 1}/${d.getDate()}</span>` : ''}</button>`;
    }).join('');
  }).join('');
  const off = $('#achTitleOff');
  if (off) off.onclick = () => achSetTitle('');
}
function achSetTitle(id) {
  store.set('title', id);
  if (typeof profileSync === 'function') profileSync();
  renderAchDlg();
  renderMyTitle();
  net.send({ type: 'hello', name: settings.nick || '', avatar: settings.avatar, title: achTitle(), diff: settings.diff, keys: settings.mode, level: typeof myLevel === 'function' ? myLevel() : 0 });
  if (id) toast(`칭호 '${ACH_BY[id].name}'을(를) 달았어요.`);
}
function renderMyTitle() {
  const el = $('#myTitle');
  if (!el) return;
  const t = achTitle();
  el.textContent = t;
  el.classList.toggle('hidden', !t);
  el.classList.toggle('legend', achIsLegend(t));
}
$('#btnAch').addEventListener('click', () => { renderAchDlg(); $('#achDlg').showModal(); });
$('#achClose').addEventListener('click', () => $('#achDlg').close());
$('#achGrid').addEventListener('click', (e) => {
  const b = e.target.closest('.ach-item.got');
  if (!b) return;
  achSetTitle(store.get('title', '') === b.dataset.id ? '' : b.dataset.id);
});
renderMyTitle();

/* ============================================================ 레벨: 끝까지 한 판마다 경험치 (노트 수 × 정확도 × 난이도), 이름 옆 Lv
   Lv → Lv+1 에 필요한 경험치 = 100 + 40×Lv. 처음엔 지금까지 한 판 수로 시작 (판당 60) */
const XP_NEED = (lv) => 100 + 40 * lv;
function xpTotal() {
  let v = +store.get('xp', NaN);
  if (!Number.isFinite(v) || v < 0) { v = Math.max(0, (achStats().plays || 0) * 60); store.set('xp', v); }
  return v;
}
function levelOf(xp) {
  let lv = 1, left = Math.max(0, xp);
  while (lv < 999 && left >= XP_NEED(lv)) { left -= XP_NEED(lv); lv++; }
  return { lv, into: left, need: XP_NEED(lv) };
}
function myLevel() { return levelOf(xpTotal()).lv; }
function lvTag(lv) { return lv > 0 ? `<span class="lv-tag">Lv${lv}</span>` : ''; }
function xpFor(g, r) {
  if (r.incomplete) return 0;
  const c = r.counts || {};
  const units = (c.perfect || 0) + (c.great || 0) + (c.good || 0) + (c.miss || 0);
  let x = 20 + units * (r.acc / 100) * (1 + (g.stars || 0) / 5) * 0.1;
  const ap = c.miss === 0 && c.good === 0 && c.great === 0;
  if (ap) x *= 1.3; else if (r.fc) x *= 1.15;
  if (g.multi) x *= 1.1;
  return Math.round(x);
}
function sendHelloNow() {
  net.send({ type: 'hello', name: settings.nick || '', avatar: settings.avatar, title: achTitle(), diff: settings.diff, keys: settings.mode, level: myLevel() });
}
/* 결과 화면: +경험치 막대 (이전 → 지금), 레벨이 오르면 'LEVEL UP' */
function gainXp(g, r) {
  const box = $('#rXp');
  const gain = xpFor(g, r);
  if (!box) return;
  box.classList.toggle('hidden', !gain);
  if (!gain) return;
  const before = xpTotal(), after = before + gain;
  store.set('xp', after);
  if (typeof profileSync === 'function') profileSync();
  const a = levelOf(before), b = levelOf(after);
  $('.rx-gain', box).textContent = `+${gain.toLocaleString()} XP`;
  $('.rx-lv', box).textContent = `Lv ${b.lv}`;
  $('.rx-next', box).textContent = `다음 레벨까지 ${(b.need - b.into).toLocaleString()}`;
  const bar = $('.rx-bar i', box);
  bar.style.transition = 'none';
  bar.style.width = `${b.lv > a.lv ? 0 : Math.round((a.into / a.need) * 100)}%`;
  requestAnimationFrame(() => requestAnimationFrame(() => { bar.style.transition = ''; bar.style.width = `${Math.round((b.into / b.need) * 100)}%`; }));
  box.classList.toggle('up', b.lv > a.lv);
  $('.rx-up', box).textContent = b.lv > a.lv ? `LEVEL UP! Lv ${a.lv} → ${b.lv}` : '';
  if (b.lv > a.lv) {
    setTimeout(() => { achChime(); toast(`레벨 업! Lv ${b.lv}`, 2600); }, 700);
    sendHelloNow();
  }
  renderMyLevel();
}
function renderMyLevel() {
  const el = $('#myLv');
  if (!el) return;
  const L = levelOf(xpTotal());
  el.textContent = `Lv ${L.lv}`;
  el.style.setProperty('--p', `${Math.round((L.into / L.need) * 100)}%`);
  el.title = `레벨 ${L.lv} · 다음 레벨까지 ${(L.need - L.into).toLocaleString()} XP (끝까지 한 판마다 노트 수·정확도·난이도만큼)`;
}
renderMyLevel();

