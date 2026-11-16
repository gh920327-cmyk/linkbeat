/* 🎯 실력 분석: 판마다 줄별·타이밍·노트 종류별 정확도와 자주 놓친 구간을 모아서 보여 줌
   - 한 판 끝: skillAna(game)이 요약을 만들어 결과와 함께 서버(내 계정)로 → 결과 화면에 한 줄 요약
   - 🎯 실력 창: 최근 판들·주간 성장 그래프·약한 구간 바로 연습 */
'use strict';

const SK_W = { perfect: 1, great: 0.7, good: 0.4, miss: 0 };
const SK_TYPES = [['tap', '일반 노트'], ['stream', '두다다닥 연타'], ['jack', '같은 줄 연타'], ['chord', '동시치기'], ['hold', '긴 노트']];
const SK_WIN = 8;           // 약한 구간을 찾는 창 길이(초)

/* ------------------------------------------------------------ 한 판 요약 */
function skillAna(g) {
  if (g.customNotes || (g.practice && !g.hl)) return null;
  const N = g.notes, nl = g.nl, n = N.length;
  if (n < 10) return null;
  const kind = new Array(n).fill('tap');
  const single = new Array(n).fill(true);
  for (let i = 0; i < n; i++) {
    if ((i > 0 && N[i].t - N[i - 1].t < 0.012) || (i < n - 1 && N[i + 1].t - N[i].t < 0.012)) { single[i] = false; kind[i] = 'chord'; }
  }
  // 두다다닥: 동시치기 없이 짧은 간격(0.18초 이하)으로 4개 넘게 이어지는 단타
  for (let i = 0; i < n;) {
    if (!single[i]) { i++; continue; }
    let j = i;
    while (j + 1 < n && single[j + 1] && N[j + 1].t - N[j].t <= 0.18 && N[j + 1].t - N[j].t >= 0.03) j++;
    if (j - i + 1 >= 4) for (let k = i; k <= j; k++) kind[k] = 'stream';
    i = j + 1;
  }
  // 같은 줄 연타: 같은 줄 바로 앞 노트와 0.25초 안
  const lastAt = new Array(nl).fill(-9);
  for (let i = 0; i < n; i++) {
    const l = N[i].l;
    if (single[i] && N[i].t - lastAt[l] <= 0.25) kind[i] = 'jack';
    lastAt[l] = N[i].t;
  }
  const lanes = Array.from({ length: nl }, () => [0, 0]);
  const ty = {};
  for (const [k] of SK_TYPES) ty[k] = [0, 0];
  const dts = [];
  const t0 = N[0].t, wins = new Map();
  for (let i = 0; i < n; i++) {
    const x = N[i];
    const k = x.d > 0 ? 'hold' : kind[i];
    const h = SK_W[x.head || 'miss'];
    const sc = x.d > 0 ? (h + SK_W[x.tail || 'miss']) / 2 : h;
    lanes[x.l][0]++; lanes[x.l][1] += sc;
    ty[k][0]++; ty[k][1] += sc;
    if (typeof x.dt === 'number') dts.push(x.dt * 1000);
    const w = Math.floor((x.t - t0) / SK_WIN);
    const c = wins.get(w) || [0, 0];
    c[0]++;
    if (x.head === 'miss' || x.tail === 'miss') c[1]++;
    else if (x.head === 'good') c[1] += 0.5;
    wins.set(w, c);
  }
  const mean = dts.length ? dts.reduce((a, b) => a + b, 0) / dts.length : 0;
  const sd = dts.length ? Math.sqrt(dts.reduce((a, b) => a + (b - mean) ** 2, 0) / dts.length) : 0;
  const weak = [...wins.entries()].filter(([, c]) => c[0] >= 6 && c[1] >= 2)
    .sort((a, b) => b[1][1] / b[1][0] - a[1][1] / a[1][0]).slice(0, 3)
    .map(([w, c]) => [+(t0 + w * SK_WIN).toFixed(1), +(t0 + (w + 1) * SK_WIN).toFixed(1), c[0], Math.round(c[1])]);
  const r2 = (v) => Math.round(v * 100) / 100;
  for (const k in ty) ty[k][1] = r2(ty[k][1]);
  return { lanes: lanes.map(([a, b]) => [a, r2(b)]), dt: [Math.round(mean * 10) / 10, Math.round(sd * 10) / 10, dts.length], ty, weak };
}

/* ------------------------------------------------------------ 글로 풀어 주기 */
const skGa = (w) => { const c = w.charCodeAt(w.length - 1); return c >= 0xac00 && c <= 0xd7a3 && (c - 0xac00) % 28 ? '이' : '가'; };
const skPct = (n, s) => (n ? (s / n) * 100 : 0);
function skLaneNames(nl) { return keysFor(nl).map((k) => keyLabel(k)); }
function skTimingText(ms) {
  const a = Math.abs(ms);
  if (a < 10) return '타이밍이 잘 맞아요';
  return `평균 ${Math.round(a)}ms ${ms > 0 ? '늦게' : '빠르게'} 쳐요`;
}
/* 결과 화면: 이번 판 한 줄 요약 */
function skillResultLine(g, r) {
  const box = $('#rSkill');
  if (!box) return;
  const a = r && r.ana;
  if (!a) { box.classList.add('hidden'); return; }
  const names = skLaneNames(g.nl);
  const accs = a.lanes.map(([n, s]) => (n ? skPct(n, s) : 101));
  const wl = accs.indexOf(Math.min(...accs));
  const types = SK_TYPES.filter(([k]) => a.ty[k] && a.ty[k][0] >= 8).map(([k, nm]) => [nm, skPct(...a.ty[k])]);
  types.sort((x, y) => x[1] - y[1]);
  const parts = [];
  if (accs[wl] < 99.5 && accs[wl] <= 100) parts.push(`약한 줄 <b>${esc(names[wl])}</b> ${accs[wl].toFixed(1)}%`);
  if (a.dt[2] >= 20 && Math.abs(a.dt[0]) >= 10) parts.push(skTimingText(a.dt[0]));
  if (types.length && types[0][1] < 97) parts.push(`${esc(types[0][0])} ${types[0][1].toFixed(1)}%`);
  const w = a.weak[0];
  box.innerHTML = `<span class="rs-h">🎯 이번 판</span> ${parts.join(' · ') || '고르게 잘 쳤어요!'}`
    + (w && !g.multi ? ` · 놓친 구간 <b>${fmtTime(w[0])}~${fmtTime(w[1])}</b> <button type="button" class="small-btn" id="rsPrac">이 구간 연습</button>` : '')
    + ' <button type="button" class="small-btn ghost" id="rsOpen">실력 분석 보기</button>';
  box.classList.remove('hidden');
  const pb = $('#rsPrac');
  if (pb) pb.onclick = () => skillPractice({ sid: g.song.id, diff: g.diff, keys: g.nl, ai: !!g.ai }, w[0], w[1]);
  $('#rsOpen').onclick = () => openSkill(g.nl);
}
function skillPractice(e, a, b) {
  $$('dialog[open]').forEach((d) => d.close());
  startSolo(e.sid, e.diff, e.keys, null, { start: Math.max(0, Math.floor(a - 2)), end: Math.ceil(b + 1), rate: 1, loop: true }, { ai: !!e.ai });
}

/* ------------------------------------------------------------ 🎯 실력 창 */
let skData = null, skKeys = 4, skRange = 20;
async function openSkill(keys) {
  if (!profile.tok) { toast('로그인하면 실력 분석을 볼 수 있어요.'); return; }
  if (keys) skKeys = keys;
  $('#skillDlg').showModal();
  $('#skBody').innerHTML = '<p class="muted">불러오는 중...</p>';
  try { skData = await (await fetch('/api/skill', { headers: profile.headers() })).json(); } catch { skData = null; }
  renderSkill();
}
function skAgg(plays) {
  const nl = skKeys, lanes = Array.from({ length: nl }, () => [0, 0]), ty = {};
  for (const [k] of SK_TYPES) ty[k] = [0, 0];
  let dtS = 0, dtN = 0, sdS = 0, acc = 0, fc = 0;
  for (const p of plays) {
    p.lanes.forEach(([n, s], i) => { if (lanes[i]) { lanes[i][0] += n; lanes[i][1] += s; } });
    for (const k in p.ty || {}) if (ty[k]) { ty[k][0] += p.ty[k][0]; ty[k][1] += p.ty[k][1]; }
    if (p.dt && p.dt[2] >= 10) { dtS += p.dt[0]; sdS += p.dt[1]; dtN++; }
    acc += p.acc; fc += p.fc ? 1 : 0;
  }
  return { lanes, ty, dt: dtN ? dtS / dtN : 0, sd: dtN ? sdS / dtN : 0, dtN, acc: plays.length ? acc / plays.length : 0, fc, n: plays.length };
}
function skBar(label, pct, sub, weak) {
  const w = Math.max(0, Math.min(100, (pct - 60) / 40 * 100));     // 60%~100%를 막대 전체로 (차이가 잘 보이게)
  return `<div class="sk-bar${weak ? ' weak' : ''}"><span class="sk-l">${label}</span><span class="sk-track"><i style="width:${w.toFixed(1)}%"></i></span>`
    + `<b>${pct.toFixed(1)}%</b><small>${sub || ''}</small></div>`;
}
function skWeekLabel(k) {        // '2026-W47' → 그 주 월요일 '11/16주'
  const m = /^(\d{4})-W(\d{2})$/.exec(k);
  if (!m) return k;
  const j4 = new Date(Date.UTC(+m[1], 0, 4)), mon = new Date(j4.getTime() - ((j4.getUTCDay() + 6) % 7) * 864e5 + (+m[2] - 1) * 7 * 864e5);
  return `${mon.getUTCMonth() + 1}/${mon.getUTCDate()}주`;
}
function skGraph(weeks) {
  const keys = Object.keys(weeks || {}).sort().slice(-8);
  if (keys.length < 2) return '<p class="muted small">2주 넘게 치면 주마다 정확도가 어떻게 변했는지 그래프로 보여 줘요.</p>';
  const pts = keys.map((k) => ({ k, n: weeks[k].n, acc: weeks[k].n ? weeks[k].acc / weeks[k].n : 0 }));
  const W = 560, H = 130, pad = 28;
  const lo = Math.max(0, Math.floor(Math.min(...pts.map((p) => p.acc)) / 5) * 5 - 5), hi = 100;
  const x = (i) => pad + (i * (W - pad * 2)) / (pts.length - 1);
  const y = (v) => H - 22 - ((v - lo) / (hi - lo || 1)) * (H - 40);
  const maxN = Math.max(...pts.map((p) => p.n));
  const bars = pts.map((p, i) => `<rect x="${x(i) - 9}" y="${H - 22 - (p.n / maxN) * 34}" width="18" height="${(p.n / maxN) * 34}" class="skg-n"></rect>`).join('');
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.acc).toFixed(1)}`).join(' ');
  const dots = pts.map((p, i) => `<circle cx="${x(i)}" cy="${y(p.acc)}" r="3.5" class="skg-d"></circle><text x="${x(i)}" y="${y(p.acc) - 8}" class="skg-v">${p.acc.toFixed(1)}</text>`
    + `<text x="${x(i)}" y="${H - 6}" class="skg-x">${skWeekLabel(p.k)}</text>`).join('');
  const d = pts[pts.length - 1].acc - pts[0].acc;
  return `<svg viewBox="0 0 ${W} ${H}" class="sk-graph" role="img" aria-label="주간 평균 정확도">${bars}<path d="${line}" class="skg-l"></path>${dots}</svg>`
    + `<p class="small muted">막대: 그 주에 친 판 수 · 선: 주간 평균 정확도 · ${pts.length}주 동안 <b class="${d >= 0 ? 'up' : 'down'}">${d >= 0 ? '+' : ''}${d.toFixed(1)}%p</b></p>`;
}
function renderSkill() {
  const body = $('#skBody');
  $$('#skKeys button').forEach((b) => b.classList.toggle('on', +b.dataset.k === skKeys));
  $$('#skRange button').forEach((b) => b.classList.toggle('on', +b.dataset.n === skRange));
  if (!skData || !Array.isArray(skData.plays)) { body.innerHTML = '<p class="muted">분석을 불러오지 못했어요. 잠시 후 다시 열어 주세요.</p>'; return; }
  const all = skData.plays.filter((p) => p.keys === skKeys);
  const plays = all.slice(-skRange);
  if (!plays.length) { body.innerHTML = `<p class="muted">${skKeys}키로 끝까지 친 판이 아직 없어요. 한 판 치면 여기에 분석이 쌓여요.</p>`; return; }
  const A = skAgg(plays), names = skLaneNames(skKeys);
  const laneAcc = A.lanes.map(([n, s]) => skPct(n, s));
  const has = laneAcc.map((v, i) => A.lanes[i][0] > 0);
  const minL = Math.min(...laneAcc.filter((v, i) => has[i]));
  const half = skKeys / 2;
  const hand = (from, to) => { let n = 0, s = 0; for (let i = from; i < to; i++) { n += A.lanes[i][0]; s += A.lanes[i][1]; } return skPct(n, s); };
  const left = hand(0, half), right = hand(half, skKeys);
  const tys = SK_TYPES.filter(([k]) => A.ty[k][0] >= 10).map(([k, nm]) => ({ k, nm, n: A.ty[k][0], p: skPct(...A.ty[k]) }));
  const minT = tys.length ? Math.min(...tys.map((t) => t.p)) : 0;
  // 자주 놓친 구간 (같은 곡·난이도·구간은 합침)
  const wm = new Map();
  for (const p of all.slice(-60)) for (const w of p.weak || []) {
    const key = `${p.sid}|${p.diff}|${p.ai ? 1 : 0}|${Math.round(w[0] / SK_WIN)}`;
    const c = wm.get(key) || { sid: p.sid, title: p.title, diff: p.diff, keys: p.keys, ai: p.ai, a: w[0], b: w[1], n: 0, miss: 0, times: 0 };
    c.n += w[2]; c.miss += w[3]; c.times++;
    wm.set(key, c);
  }
  const weak = [...wm.values()].filter((c) => typeof songById !== 'function' || songById(c.sid)).sort((x, y) => y.miss - x.miss).slice(0, 5);
  // 한 줄 조언
  const tips = [];
  if (has.some(Boolean) && Math.max(...laneAcc.filter((v, i) => has[i])) - minL >= 1.5) tips.push(`<b>${esc(names[laneAcc.indexOf(minL)])}</b> 줄이 가장 약해요`);
  if (Math.abs(left - right) >= 1.5) tips.push(`${left < right ? '왼손' : '오른손'}이 ${Math.abs(left - right).toFixed(1)}%p 약해요`);
  if (A.dtN >= 3 && Math.abs(A.dt) >= 10) tips.push(`${skTimingText(A.dt)} — 싱크를 지금보다 ${A.dt > 0 ? '+' : ''}${Math.round(A.dt / 5) * 5}ms 바꿔 보세요`);
  if (tys.length > 1 && minT < 97) { const nm = tys.find((t) => t.p === minT).nm; tips.push(`<b>${esc(nm)}</b>${skGa(nm)} 가장 약해요`); }
  const accTrend = all.length >= 10 ? (skAgg(all.slice(-5)).acc - skAgg(all.slice(-10, -5)).acc) : null;
  body.innerHTML = `
    <div class="sk-tiles">
      <div><small>평균 정확도</small><b>${A.acc.toFixed(2)}%</b>${accTrend !== null ? `<em class="${accTrend >= 0 ? 'up' : 'down'}">최근 5판 ${accTrend >= 0 ? '▲' : '▼'} ${Math.abs(accTrend).toFixed(1)}%p</em>` : ''}</div>
      <div><small>분석한 판</small><b>${A.n}판</b><em>풀콤보 ${A.fc}번</em></div>
      <div><small>타이밍 습관</small><b>${A.dtN ? `${A.dt > 0 ? '+' : ''}${A.dt.toFixed(0)}ms` : '–'}</b><em>${A.dtN ? `${A.dt >= 0 ? '늦게' : '빠르게'} · 흔들림 ±${A.sd.toFixed(0)}ms` : ''}</em></div>
    </div>
    ${tips.length ? `<p class="sk-tip">💡 ${tips.join(' · ')}</p>` : '<p class="sk-tip">💡 약한 곳 없이 고르게 잘 치고 있어요!</p>'}
    <h4>줄별 정확도 <small class="muted">왼손 ${left.toFixed(1)}% · 오른손 ${right.toFixed(1)}%</small></h4>
    <div class="sk-bars">${A.lanes.map(([n, s], i) => skBar(esc(names[i]), skPct(n, s), `${fmtN(n)}개`, has[i] && skPct(n, s) === minL && laneAcc.filter((v, j) => has[j]).length > 1)).join('')}</div>
    <h4>노트 종류별 <small class="muted">두다다닥 = 0.18초 안으로 4개 넘게 이어지는 단타</small></h4>
    <div class="sk-bars">${tys.length ? tys.map((t) => skBar(esc(t.nm), t.p, `${fmtN(t.n)}개`, t.p === minT && tys.length > 1)).join('') : '<p class="muted small">아직 데이터가 적어요.</p>'}</div>
    <h4>주간 성장</h4>
    ${skGraph(skData.weeks)}
    <h4>자주 놓친 구간 <small class="muted">최근 60판 · 누르면 그 구간만 반복 연습</small></h4>
    <div class="sk-weak">${weak.length ? weak.map((c, i) => `<div class="skw"><span class="skw-t">${esc(c.title)}<small>${c.keys}KEY ${DIFF_EN[c.diff] || c.diff}${c.ai ? ' · AI' : ''} · ${fmtTime(c.a)}~${fmtTime(c.b)} · ${c.times}번 · 놓침 ${fmtN(c.miss)}</small></span>`
      + `<button type="button" class="small-btn primary" data-i="${i}">연습</button></div>`).join('') : '<p class="muted small">놓친 구간이 거의 없어요. 👍</p>'}</div>`;
  $$('.skw button', body).forEach((b) => { b.onclick = () => { const c = weak[+b.dataset.i]; skillPractice(c, c.a, c.b); }; });
}
$('#btnSkill').addEventListener('click', () => openSkill());
$('#skClose').addEventListener('click', () => $('#skillDlg').close());
$('#skKeys').addEventListener('click', (e) => { const b = e.target.closest('button[data-k]'); if (b) { skKeys = +b.dataset.k; renderSkill(); } });
$('#skRange').addEventListener('click', (e) => { const b = e.target.closest('button[data-n]'); if (b) { skRange = +b.dataset.n; renderSkill(); } });
