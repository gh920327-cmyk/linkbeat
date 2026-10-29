/* 링크비트 앱: 곡 선택, 곡 추가, 순위표, 미리듣기, 멀티 방, 결과, 싱크 맞추기, 키 입력 연결 */
'use strict';

let songs = [];
let view = [];            // 정렬·검색이 적용된 곡 목록
let selId = store.get('selId', null);
let isHost = false;
let isCloud = false;          // 인터넷(클라우드) 서버: 곡 만들기는 호스트 PC의 채보 엔진이 맡음
let game = null;
let editor = null;
let calib = null;
let lastResult = null;
let pendingResults = null;
const preview = { id: null, timer: 0, auto: 0 };
const DIFFS = ['easy', 'normal', 'hard', 'extreme'];
const DIFF_EN = { easy: 'EASY', normal: 'NORMAL', hard: 'HARD', extreme: 'EXTREME' };
let daily = null;      // 오늘의 곡 (/api/daily) — 곡 목록에서도 쓰므로 맨 위에

/* ============================================================ 곡 데이터 */
async function refreshSongs() {
  try {
    const j = await api('/songs');
    songs = j.songs;
    renderSongs();
  } catch (e) {
    $('#songList').innerHTML = `<div class="empty">서버에 연결할 수 없어요. (${esc(e.message)})</div>`;
  }
}
const songById = (id) => songs.find((s) => s.id === id);
/* AI 채보 (기본): 4키에서 곡에 AI 채보가 있으면 그걸로 플레이. 'AI 채보' 칩을 끄면 기존 채보 (방에서는 방장이 정함)
   기록·순위표는 AI 채보 / 기존 채보 따로 */
function aiWanted() { return net.room ? net.room.ai !== false : settings.aiChart !== false; }
/* 곡마다 AI 채보와 기존 채보 중 하나만 (섞지 않음): AI가 음원과 잘 맞는 곡(rec)만 AI가 기본.
   혼자 할 때는 칩으로 곡마다 바꿀 수 있고(기억함), 방에서는 방장 설정 + 곡 추천을 따름 */
function aiRec(s) {
  const ai = s && s.ai;
  if (!ai) return false;
  if (ai.fit) return ai.fit.rec !== false;      // 전체 곡 정보
  return ai.rec !== false;                       // 곡 목록 요약
}
let sideOpen = '';   // 곡 선택 화면 오른쪽 칸: '' | multi | req | help
/* 호스트가 '이 곡은 모두 기존 채보로' 정한 곡 (목록 요약은 ai.off, 곡 전체 정보는 aiOff) */
const aiHostOff = (s) => !!(s && (s.aiOff || (s.ai && s.ai.off)));
/* 혼자 할 때 이 곡을 AI 채보로 할지: 곡마다 고른 칩 → 없으면 기본(설정 + 자동 검사) */
function soloPick(s) {
  if (!s) return false;
  const o = (settings.aiPick || {})[s.id];
  if (typeof o === 'boolean') return o;
  return settings.aiChart !== false && aiRec(s);
}
function songPick(s) {
  if (!s) return false;
  if (net.room) return net.room.ai !== false && !!s.ai && !aiHostOff(s);   // 방: 방장이 고른 대로 (방장의 곡별 칩)
  const o = (settings.aiPick || {})[s.id];
  if (typeof o === 'boolean') return o;
  return settings.aiChart !== false && aiRec(s);
}
/* 이 곡 AI 채보를 어느 AI가 만들었나: 새 AI(Mapperatorinator) / 예전 AI(MuG) — 서버가 저장한 ai.by 로 구분 */
const aiIsMug = (s) => !!(s && s.ai && !/^mapperatorinator/i.test(String(s.ai.by || '')));
const aiMaker = (s) => aiIsMug(s) ? '예전 AI(MuG)' : '새 AI(Mapperatorinator)';
const hasAi = (s, nl = settings.mode, diff = settings.diff) => nl === 4 && !!(s && s.ai && (s.ai.counts || {})[diff]);
const aiOn = (s, nl = settings.mode, diff = settings.diff) => hasAi(s, nl, diff) && songPick(s);
const starOf = (s, nl = settings.mode, diff = settings.diff) => aiOn(s, nl, diff) ? (s.ai.stars || {})[diff] || 0 : ((s.stars || {})[nl] || {})[diff] || 0;
const countOf = (s, nl = settings.mode, diff = settings.diff) => aiOn(s, nl, diff) ? s.ai.counts[diff] : ((nl === 6 ? s.counts6 : s.counts) || {})[diff] || 0;
/* 하이라이트 모드: 방에 있으면 방 설정(방장이 정함), 혼자면 내 설정 */
function hlActive() { return net.room ? !!net.room.hl : !!settings.hlMode; }
function hlPractice(h) { return h ? { start: h.start, from: h.from, end: h.end, rate: 1, loop: false, hl: true } : null; }
function boardOf(s, nl, diff, hl = hlActive(), ai = aiOn(s, nl, diff)) {
  return (s.board || []).filter((e) => e.diff === diff && (e.keys || 4) === nl && !!e.hl === hl && !!e.ai === ai).sort((a, b) => b.score - a.score);
}
function myRecord(s, nl, diff, hl = hlActive(), ai = aiOn(s, nl, diff)) {
  const nick = (settings.nick || '').trim();
  if (nick) {
    const e = boardOf(s, nl, diff, hl, ai).find((x) => x.name === nick);
    if (e) return e;
  }
  return getBest(s.id, diff, nl, hl, ai);
}

/* ============================================================ 곡 목록 */
/* 진짜 부른 가수 (모르면 업로드 채널) */
function artistOf(s) { return (s && (s.artist || s.channel)) || ''; }

function computeView() {
  const q = $('#search').value.trim().toLowerCase();
  const tab = settings.listTab || 'all';
  const fav = settings.fav || {};
  const inTab = (s) => tab === 'fav' ? !!fav[s.id]
    : tab === 'unplayed' ? !DIFFS.some((d) => myRecord(s, settings.mode, d))
      : tab === 'ai' ? !!(s.ai && settings.mode === 4)
        : true;
  const list = songs.filter((s) => inTab(s) && (!q || [s.title, artistOf(s), s.artistRaw, s.channel].some((x) => (x || '').toLowerCase().includes(q))));
  const sorters = {
    new: (a, b) => b.created - a.created,
    title: (a, b) => a.title.localeCompare(b.title, 'ko'),
    artist: (a, b) => (artistOf(a) || '\uffff').localeCompare(artistOf(b) || '\uffff', 'ko') || a.title.localeCompare(b.title, 'ko'),
    plays: (a, b) => (b.plays || 0) - (a.plays || 0),
    stars: (a, b) => starOf(a) - starOf(b),
    starsDesc: (a, b) => starOf(b) - starOf(a),
    bpm: (a, b) => b.bpm - a.bpm,
    duration: (a, b) => a.duration - b.duration,
  };
  list.sort(sorters[settings.sort] || sorters.new);
  view = list;
}

function renderSongs() {
  computeView();
  $('#songCount').textContent = songs.length ? songs.length : '';
  if (!view.find((s) => s.id === selId)) selId = view.length ? view[0].id : null;
  const nl = settings.mode;
  $$('#listTabs [data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === (settings.listTab || 'all')));
  const tabEmpty = { fav: '즐겨찾기한 곡이 없어요.<br>곡 줄 왼쪽의 ☆를 눌러 즐겨찾기에 넣어 보세요.', unplayed: '안 해본 곡이 없어요. 전부 해 봤어요!', ai: 'AI 채보가 있는 곡이 없어요.' };
  if (!view.length) {
    $('#songList').innerHTML = `<div class="empty">${songs.length ? ($('#search').value.trim() ? '검색 결과가 없어요.' : tabEmpty[settings.listTab] || '곡이 없어요.') : isHost
      ? '아직 곡이 없어요.<br>위에 유튜브 링크를 붙여넣어 첫 곡을 만들어 보세요!'
      : '아직 곡이 없어요. 호스트가 곡을 추가하면 여기에 나타나요.'}</div>`;
  } else {
    const fav = settings.fav || {};
    $('#songList').innerHTML = view.map((s) => {
      const slots = DIFFS.map((d) => {
        const v = starOf(s, nl, d);
        const r = myRecord(s, nl, d);
        const ap = r && r.counts && r.fc && !r.counts.great && !r.counts.good && !r.counts.miss;
        const rk = rankFor(r);
        const mark = r ? `<b class="rk rank-${esc(rk)}">${esc(rk)}</b>` : '<i class="nodot"></i>';
        const tip = `${DIFF_NAME[d]} ★${v.toFixed(1)}${r ? ` · ${rk} ${r.score.toLocaleString()}${ap ? ' · ALL PERFECT' : r.fc ? ' · FULL COMBO' : ''}` : ' · 아직 안 해봤어요'}`;
        return `<span class="dslot ${starClass(v)}${d === settings.diff ? ' on' : ''}${ap ? ' ap' : r && r.fc ? ' fc' : ''}" title="${esc(tip)}">${mark}<em>${v.toFixed(1)}</em></span>`;
      }).join('');
      const roomSel = net.room && net.room.songId === s.id ? ' roomsel' : '';
      return `<div class="row${s.id === selId ? ' sel' : ''}${roomSel}" data-id="${s.id}">
        <button class="fav${fav[s.id] ? ' on' : ''}" type="button" title="${fav[s.id] ? '즐겨찾기에서 빼기' : '즐겨찾기'}">${fav[s.id] ? '★' : '☆'}</button>
        <img class="row-thumb" src="https://i.ytimg.com/vi/${s.id}/mqdefault.jpg" alt="" loading="lazy">
        <div class="row-info"><div class="row-title">${daily && daily.songId === s.id ? `<span class="daily-badge" title="오늘의 곡 (${DIFF_NAME[daily.diff] || ''} · 4키)">🎯 오늘</span>` : ''}${s.ai && songPick(s) ? (aiIsMug(s) ? '<span class="ai-badge mug" title="이 곡은 예전 AI(MuG)로 만든 AI 채보로 플레이 (곡 화면의 AI 채보 칩으로 바꿀 수 있어요)">MuG</span>' : '<span class="ai-badge" title="이 곡은 새 AI로 만든 AI 채보로 플레이 (곡 화면의 AI 채보 칩으로 바꿀 수 있어요)">AI</span>') : ''}${esc(s.title)}</div><div class="row-artist">${esc(artistOf(s))}</div></div>
        <div class="row-slots">${slots}</div>
      </div>`;
    }).join('');
  }
  renderDetail();
}

function renderDetail() {
  const s = songById(selId);
  const nl = settings.mode;
  $$('#modeTabs button').forEach((b) => b.classList.toggle('on', +b.dataset.mode === nl));
  $('#dTag').textContent = `${nl}KEY`;
  const inRoom = !!net.room;
  const leader = net.isLeader();
  $('#btnEdit').classList.toggle('hidden', !isHost || inRoom || !s);
  $('#btnDel').classList.toggle('hidden', !isHost || inRoom || !s);
  $('#btnAiOne').classList.toggle('hidden', !isHost || !isCloud || inRoom || !s || !(pcJobs.worker && pcJobs.worker.ai));
  if (!s) {
    $('#dJacket').removeAttribute('src');
    $('#dTitle').textContent = songs.length ? '곡을 선택하세요' : '곡을 추가해 주세요';
    $('#dArtist').textContent = '';
    $('#btnSongInfo').classList.add('hidden');
    ['#dBpm', '#dTime', '#dPlays', '#dTop', '#dMine', '#dRate'].forEach((k) => { $(k).textContent = '-'; });
    $('#dHlRange').textContent = '';
    $('#modHl').classList.toggle('on', hlActive());
    $$('#diffBoxes .dbox').forEach((b) => { b.disabled = true; });
    $('#btnPlay').disabled = true;
    return;
  }
  const jacket = `https://i.ytimg.com/vi/${s.id}/hqdefault.jpg`;
  if ($('#dJacket').getAttribute('src') !== jacket) $('#dJacket').src = jacket;
  $('#dTitle').textContent = s.title;
  $('#dArtist').textContent = artistOf(s);
  $('#dArtist').title = s.channel && s.channel !== artistOf(s) ? `업로드: ${s.channel}` : '';
  $('#btnSongInfo').classList.toggle('hidden', !isHost);
  $('#dBpm').textContent = Math.round(s.bpm);
  $('#dTime').textContent = fmtTime(s.duration);
  $('#dPlays').textContent = s.plays || 0;
  $$('#diffBoxes .dbox').forEach((b) => {
    const d = b.dataset.diff;
    const v = starOf(s, nl, d);
    b.disabled = false;
    b.classList.toggle('on', d === settings.diff);
    b.className = b.className.replace(/\bs[1-6]\b/g, '').trim() + ' ' + starClass(v);
    $('.dstar', b).textContent = '★' + v.toFixed(1);
    const full = Math.round(clamp(v, 0, 10));
    $('.pips', b).innerHTML = Array.from({ length: 10 }, (_, i) => `<i class="${i < full ? 'f' : ''}"></i>`).join('');
    $('.dnotes', b).textContent = `${countOf(s, nl, d)} NOTES`;
  });
  const top = boardOf(s, nl, settings.diff)[0];
  $('#dTop').innerHTML = top ? `${esc(top.name)} <em>${top.score.toLocaleString()}</em>` : '<span class="none">아직 없음</span>';
  const mine = myRecord(s, nl, settings.diff);
  $('#dMine').innerHTML = mine ? `<span class="rank-${esc(rankFor(mine))}">${esc(rankFor(mine))}</span> <em>${mine.score.toLocaleString()}</em>` : '<span class="none">기록 없음</span>';
  $('#dRate').innerHTML = mine && mine.acc != null ? `<em>${(+mine.acc).toFixed(2)}%</em>${mine.fc ? ' <span class="fc">FC</span>' : ''}` : '';
  const pb = $('#btnPlay');
  const hlOn = hlActive();
  if (inRoom) {
    const isRoomSong = net.room.songId === s.id;
    pb.innerHTML = leader ? '이 곡으로<small>방에서 선택</small>' : isRoomSong ? '선택된 곡<small>방장이 고른 곡이에요</small>' : '이 곡 하자<small>방장에게 추천</small>';
    pb.disabled = !leader && isRoomSong;
  } else {
    pb.innerHTML = hlOn && s.hl ? 'PLAY<small>하이라이트 · Enter</small>' : 'PLAY<small>Enter</small>';
    pb.disabled = !countOf(s, nl, settings.diff);
  }
  // 하이라이트 칩: 켜짐 표시 + 이 곡의 구간 (방에서는 방장만 바꿀 수 있음)
  const hc = $('#modHl');
  hc.classList.toggle('on', hlOn);
  hc.disabled = inRoom && !leader;
  hc.classList.toggle('nohl', hlOn && !s.hl);
  hc.title = s.hl
    ? `곡에서 가장 잘 들리는 부분(후렴)만 플레이: ${fmtTime(s.hl.from)} ~ ${fmtTime(s.hl.end)}${s.hl.src === 'notes' ? ' (어림값 · 채보 다시 만들기로 정확해져요)' : ''} · 기록은 따로`
    : '이 곡은 하이라이트 구간을 아직 몰라요 (곡이 너무 짧거나, 채보 다시 만들기가 필요해요)';
  $('#dHlRange').textContent = hlOn ? (s.hl ? `${fmtTime(s.hl.from)}~${fmtTime(s.hl.end)}` : '구간 없음') : '';
  $('#btnPreview').classList.toggle('on', preview.id === s.id);
  $('#btnPractice').disabled = inRoom || !countOf(s, nl, settings.diff);
  // AI 채보 칩: 이 곡에 AI 채보가 있을 때만 보임 (4키). 켜짐이 기본, 방에서는 방장만 바꿈
  const ac = $('#modAi');
  const songAi = !!(s.ai && s.ai.counts && Object.keys(s.ai.counts).length);
  ac.classList.toggle('hidden', !songAi || nl !== 4);
  ac.classList.toggle('on', songAi && songPick(s));
  ac.disabled = inRoom && !leader;
  ac.textContent = songAi && aiIsMug(s) ? 'AI 채보 · MuG' : 'AI 채보';
  ac.classList.toggle('mug', songAi && aiIsMug(s));
  ac.title = songAi ? `${aiMaker(s)}가 만든 채보 · ${aiRec(s) ? '이 곡은 AI 채보가 기본' : '이 곡은 AI가 음원과 잘 안 맞아서 기존 채보가 기본'}${s.ai.match != null ? ` (음원과 맞음 ${Math.round(s.ai.match * 100)}%)` : ''}${s.ai.at ? ` · ${new Date(s.ai.at * 1000).toLocaleDateString()} 생성` : ''} · 누르면 이 곡만 바꿔요 · 기록은 따로` : '';
  ac.classList.toggle('old', songAi && !(s.ai.gen >= 2));
  applyDiffAccent();
  drawBeatLine();
}
/* 고른 난이도 칸의 색을 곡 정보 칸 전체의 강조색으로 (PLAY 버튼·비트 라인·미리듣기 버튼) */
function applyDiffAccent() {
  const col = $('#detailCol');
  const box = $('#diffBoxes .dbox.on') || $('#diffBoxes .dbox');
  if (!col || !box) return;
  const c = getComputedStyle(box).getPropertyValue('--sc').trim();
  if (!c) { col.style.removeProperty('--acc'); col.style.removeProperty('--on-acc'); return; }
  col.style.setProperty('--acc', c);
  col.style.setProperty('--on-acc', inkOn(c));
}
/* 색 위에 올릴 글자색 (밝은 색 → 진한 남색, 어두운 색 → 흰색) */
function inkOn(c) {
  const cv = inkOn.cv || (inkOn.cv = document.createElement('canvas').getContext('2d'));
  cv.fillStyle = '#000'; cv.fillStyle = c;
  const m = /^#([0-9a-f]{6})$/i.exec(cv.fillStyle);
  if (!m) return '#04060d';
  const n = parseInt(m[1], 16), lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const L = 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return L > 0.33 ? '#060914' : '#ffffff';
}

/* ---------------- 비트 라인: 곡을 48칸으로 나눠 칸마다 노트가 얼마나 몰려 있는지 (서버가 채보에서 계산, 곡마다 한 번 받음) */
const densCache = new Map();
function densOf(id) {
  let e = densCache.get(id);
  const s = songById(id);
  const stamp = s ? JSON.stringify(s.edited || {}) + (s.ai ? s.ai.at : '') : '';
  if (e && e.stamp === stamp) return e.data;
  if (e && e.loading) return null;
  e = { stamp, data: e && e.data, loading: true };
  densCache.set(id, e);
  api(`/songs/${id}/dens`).then((d) => { e.data = d; }).catch(() => {}).finally(() => { e.loading = false; if (selId === id) drawBeatLine(); });
  return e.data || null;
}
function drawBeatLine() {
  const cv = $('#beatCv');
  if (!cv) return;
  const box = cv.parentElement.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const W = Math.max(60, Math.floor(box.width)), H = Math.max(20, Math.floor(box.height));
  if (cv.width !== W * dpr || cv.height !== H * dpr) { cv.width = W * dpr; cv.height = H * dpr; }
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  const s = songById(selId);
  const d = s && densOf(s.id);
  const nl = settings.mode, diff = settings.diff;
  const str = d && (aiOn(s, nl, diff) && d.ai && d.ai[diff] ? d.ai[diff] : (d[String(nl)] || {})[diff]);
  const cs = getComputedStyle($('#detailCol'));
  const acc = cs.getPropertyValue('--acc').trim() || '#4de1ff';
  const ink = cs.getPropertyValue('--muted').trim() || '#8691b3';
  const dur = (d && d.dur) || (s && s.duration) || 1;
  const pad = 6, top = 8, base = H - 6;
  // 후렴(하이라이트) 구간: 밝은 띠 — 하이라이트 모드면 나머지를 어둡게
  const hl = s && s.hl;
  if (hl && hl.end > hl.from) {
    const x0 = pad + (W - pad * 2) * clamp(hl.from / dur, 0, 1), x1 = pad + (W - pad * 2) * clamp(hl.end / dur, 0, 1);
    ctx.fillStyle = hlActive() ? 'rgba(255, 210, 90, .16)' : 'rgba(255, 255, 255, .05)';
    ctx.fillRect(x0, 2, x1 - x0, H - 4);
    if (hlActive()) {
      ctx.fillStyle = 'rgba(255, 210, 90, .75)';
      ctx.fillRect(x0, 2, 2, H - 4); ctx.fillRect(x1 - 2, 2, 2, H - 4);
    }
  }
  ctx.fillStyle = ink; ctx.globalAlpha = 0.35;
  ctx.fillRect(pad, base + 1, W - pad * 2, 1);
  ctx.globalAlpha = 1;
  if (!str) return;
  const n = str.length, gap = 2, bw = (W - pad * 2) / n;
  const vals = [...str].map((ch) => parseInt(ch, 36) / 2);     // 1초에 노트 수
  for (let i = 0; i < n; i++) {
    const v = vals[i];
    if (!v) continue;
    const h = Math.max(2, (base - top) * Math.min(1, Math.sqrt(v / 16)));
    const x = pad + i * bw;
    const dim = hl && hlActive() && ((i + 0.5) / n * dur < hl.from || (i + 0.5) / n * dur > hl.end);
    ctx.globalAlpha = dim ? 0.28 : 0.9;
    ctx.fillStyle = acc;
    ctx.beginPath();                       // 살짝 기운 막대 (링크비트의 사선 모양)
    const sk = Math.min(3, bw * 0.35);
    ctx.moveTo(x + gap / 2 + sk, base - h); ctx.lineTo(x + bw - gap / 2 + sk, base - h);
    ctx.lineTo(x + bw - gap / 2, base); ctx.lineTo(x + gap / 2, base); ctx.closePath();
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}
window.addEventListener('resize', () => { if (currentScreen === 'lobby') drawBeatLine(); });
function renderMods() {
  $('#modMirror').classList.toggle('on', !!settings.mirror);
  $('#modRandom').classList.toggle('on', !!settings.random);
  $('#modGhost').classList.toggle('on', settings.ghost !== false);
  $('#speedShow').textContent = (+settings.speed).toFixed(1);
  $('#speedKeys').textContent = `플레이 중 ${fnLabel('speedUp')} ${fnLabel('speedDown')}`;
}
$('#modMirror').addEventListener('click', () => { settings.mirror = !settings.mirror; saveSettings(); renderMods(); });
$('#modRandom').addEventListener('click', () => { settings.random = !settings.random; saveSettings(); renderMods(); });
$('#modGhost').addEventListener('click', () => { settings.ghost = settings.ghost === false; saveSettings(); renderMods(); });
$('#modAi').addEventListener('click', () => {
  if (net.room) {
    if (net.isLeader()) {
      const on = net.room.ai === false;
      const rs = songById(net.room.songId);
      if (rs) settings.aiPick = Object.assign({}, settings.aiPick || {}, { [rs.id]: on });   // 방장의 곡별 선택으로도 기억
      saveSettings();
      net.send({ type: 'aimode', on });
    } else toast('AI 채보 사용은 방장이 곡마다 정해요.');
    return;
  }
  const s = songById(selId);
  if (!s) return;
  const next = !songPick(s);
  settings.aiPick = Object.assign({}, settings.aiPick || {}, { [s.id]: next });
  saveSettings();
  renderSongs();
  toast(next ? `이 곡은 AI 채보로 플레이해요.${aiRec(s) ? '' : ' (AI가 음원과 잘 안 맞는 곡이라 어색할 수 있어요)'} · 기록은 따로` : '이 곡은 기존 채보로 플레이해요. · 기록은 따로', 2800);
});
$('#modHl').addEventListener('click', () => {
  if (net.room) {
    if (net.isLeader()) net.send({ type: 'hlmode', on: !net.room.hl });
    else toast('하이라이트 모드는 방장이 정해요.');
    return;
  }
  settings.hlMode = !settings.hlMode;
  saveSettings();
  renderSongs();
  const s = songById(selId);
  if (settings.hlMode) toast(s && s.hl ? `하이라이트 모드: 후렴 ${fmtTime(s.hl.from)}~${fmtTime(s.hl.end)}만 플레이해요. 기록은 따로 저장돼요.` : '하이라이트 모드: 곡의 후렴 부분만 짧게 플레이해요. 기록은 따로 저장돼요.', 3200);
});

function select(id, { auto = true } = {}) {
  if (!id || id === selId) return;
  selId = id;
  store.set('selId', id);
  $$('#songList .row').forEach((r) => r.classList.toggle('sel', r.dataset.id === id));
  const row = $(`#songList .row[data-id="${id}"]`);
  if (row) row.scrollIntoView({ block: 'nearest' });
  renderDetail();
  if (preview.id && preview.id !== id) stopPreview();
  clearTimeout(preview.auto);
  if (auto && settings.autoPreview !== false && !net.room?.phase?.startsWith('p')) {
    preview.auto = setTimeout(() => { if (selId === id && currentScreen === 'lobby') startPreview(id); }, 700);
  }
}

function setDiff(d) {
  settings.diff = d;
  saveSettings();
  renderSongs();
  sendMyDiff();
}
/* 멀티: 난이도·키는 각자 골라요. 바꿀 때마다 서버에 알려줌 */
function sendMyDiff() {
  net.send({ type: 'mydiff', diff: settings.diff, keys: settings.mode });
}
function setMode(nl) {
  settings.mode = nl;
  saveSettings();
  renderKeysHelp();
  renderSongs();
  sendMyDiff();
}

// 누르는 순간 선택 (클릭 도중 목록이 다시 그려져도 선택이 사라지지 않게)
$('#songList').addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  if (e.target.closest('.fav')) return;
  const r = e.target.closest('.row');
  if (!r) return;
  select(r.dataset.id);
  if (document.activeElement && isTyping({ target: document.activeElement })) document.activeElement.blur();
});
$('#songList').addEventListener('dblclick', (e) => {
  const r = e.target.closest('.row');
  if (r) { select(r.dataset.id, { auto: false }); playSelected(); }
});
$('#diffBoxes').addEventListener('click', (e) => {
  const b = e.target.closest('.dbox');
  if (b && !b.disabled) setDiff(b.dataset.diff);
});
$('#modeTabs').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (b) setMode(+b.dataset.mode);
});
/* 즐겨찾기 ★ */
$('#songList').addEventListener('click', (e) => {
  const f = e.target.closest('.fav');
  if (!f) return;
  e.stopPropagation();
  const id = f.closest('.row').dataset.id;
  const fav = Object.assign({}, settings.fav || {});
  if (fav[id]) delete fav[id]; else fav[id] = 1;
  settings.fav = fav;
  saveSettings();
  renderSongs();
});
/* 목록 분류 탭 · 오른쪽 칸(멀티·신청함·조작법) 열고 닫기 */
$('#listTabs').addEventListener('click', (e) => {
  const t = e.target.closest('[data-tab]');
  if (t) { settings.listTab = t.dataset.tab; saveSettings(); renderSongs(); return; }
  const sd = e.target.closest('[data-side]');
  if (sd) {
    sideOpen = sideOpen === sd.dataset.side && !(net.room && sd.dataset.side === 'multi') ? '' : sd.dataset.side;
    renderSide();
    if (sideOpen && window.innerWidth <= 1280) $('#sideCol').scrollIntoView({ behavior: 'smooth', block: 'start' });   // 좁은 화면은 목록 아래에 열려서 그쪽으로
  }
});
function renderSide() {
  const want = sideOpen || (net.room ? 'multi' : '');
  const grid = $('.select-grid');
  grid.classList.toggle('side-on', !!want);
  $$('#sideCol [data-panel]').forEach((p) => p.classList.toggle('hidden', p.dataset.panel !== want));
  $$('#listTabs [data-side]').forEach((b) => b.classList.toggle('on', b.dataset.side === want));
  $('#roomDot').classList.toggle('hidden', !net.room);
}
renderSide();
$('#search').addEventListener('input', renderSongs);
$('#sortSel').addEventListener('change', (e) => { settings.sort = e.target.value; saveSettings(); renderSongs(); });

function playSelected() {
  const s = songById(selId);
  if (!s) return;
  if (net.room) {
    if (net.isLeader()) net.send({ type: 'select', songId: s.id, diff: settings.diff, keys: settings.mode, ai: soloPick(s) });   // 방장의 곡별 AI 채보 선택
    else if (net.room.songId !== s.id) { net.send({ type: 'suggest', songId: s.id }); toast('방장에게 이 곡을 추천했어요.'); }
    return;
  }
  if (hlActive()) {
    if (s.hl) { startSolo(s.id, settings.diff, settings.mode, null, hlPractice(s.hl)); return; }
    toast('이 곡은 하이라이트 구간을 몰라서 전체곡으로 플레이해요.', 2600);
  }
  startSolo(s.id, settings.diff, settings.mode);
}
$('#btnPlay').addEventListener('click', playSelected);

/* ============================================================ 연습 모드 */
function openPractice() {
  const s = songById(selId);
  if (!s || net.room) return;
  const dur = Math.max(2, Math.floor(s.duration || 60));
  const saved = store.get('practice_' + s.id, null);
  const st = saved ? saved.start : s.hl ? Math.floor(s.hl.from) : Math.floor(dur * 0.25);
  const en = saved ? saved.end : Math.min(dur, st + 30);
  $('#prSong').innerHTML = `${esc(s.title)} · <span class="tag">${settings.mode}KEY</span> ${DIFF_EN[settings.diff]}`;
  $('#prStart').max = dur - 1; $('#prEnd').max = dur;
  $('#prStart').value = st; $('#prEnd').value = Math.max(st + 1, en);
  if (saved) { $('#prRate').value = String(saved.rate); $('#prLoop').value = saved.loop ? '1' : '0'; }
  prLabels();
  $('#practiceDlg').showModal();
}
function prLabels() {
  let a = +$('#prStart').value, b = +$('#prEnd').value;
  if (b <= a) { b = a + 1; $('#prEnd').value = b; }
  $('#prStartV').textContent = fmtTime(a);
  $('#prEndV').textContent = fmtTime(b);
}
$('#prStart').addEventListener('input', prLabels);
$('#prEnd').addEventListener('input', () => {
  if (+$('#prEnd').value <= +$('#prStart').value) $('#prStart').value = +$('#prEnd').value - 1;
  prLabels();
});
$('#btnPractice').addEventListener('click', openPractice);
$('#prGo').addEventListener('click', () => {
  const s = songById(selId);
  if (!s) return;
  const pr = { start: +$('#prStart').value, end: +$('#prEnd').value, rate: +$('#prRate').value, loop: $('#prLoop').value === '1' };
  store.set('practice_' + s.id, pr);
  $('#practiceDlg').close();
  startSolo(s.id, settings.diff, settings.mode, null, pr);
});
$('#btnRank').addEventListener('click', () => selId && openRank(selId, settings.mode, settings.diff));
$('#btnEdit').addEventListener('click', () => selId && openEditor(selId, settings.diff, settings.mode));
$('#btnAiOne').addEventListener('click', async () => {
  const s = songById(selId);
  if (!s) return;
  if (s.ai && !confirm(`'${s.title}'의 AI 채보를 새로 다시 만들까요? (곡당 7~8분 · 기록은 그대로)`)) return;
  try {
    await api('/ai/batch', { method: 'POST', body: { ids: [s.id] } });
    toast(`'${s.title}' AI 채보를 대기열에 넣었어요.`, 2600);
    loadJobs();
  } catch (err) { toast(err.message); }
});
$('#btnDel').addEventListener('click', async () => {
  const s = songById(selId);
  if (!s || !confirm(`'${s.title}' 곡을 삭제할까요? (채보와 순위도 함께 지워져요)`)) return;
  try { stopPreview(); await api('/songs/' + s.id, { method: 'DELETE' }); toast('삭제했어요.'); refreshSongs(); } catch (err) { toast(err.message); }
});

/* ============================================================ 미리듣기 */
async function startPreview(id) {
  const s = songById(id);
  if (!s || currentScreen !== 'lobby') return;
  try { await yt.ready; } catch (e) { toast(e.message); return; }
  if (currentScreen !== 'lobby' || selId !== id) return;
  preview.id = id;
  $('.jacket-wrap').classList.add('previewing');
  placePlayer($('#slotPreview'));
  try {
    // 곡에서 가장 잘 들리는 부분(후렴)부터 — 모르면 곡의 35% 지점
    yt.player.loadVideoById({ videoId: id, startSeconds: s.hl ? Math.max(0, s.hl.from - 0.4) : Math.floor((s.duration || 60) * 0.35) });
    yt.player.unMute();
    yt.volume(Math.round(settings.volume * 0.8));
  } catch { /* 무시 */ }
  clearTimeout(preview.timer);
  preview.timer = setTimeout(stopPreview, 25000);
  renderDetail();
}
function stopPreview() {
  clearTimeout(preview.auto);
  if (!preview.id) return;
  clearTimeout(preview.timer);
  preview.id = null;
  yt.pause();
  $('.jacket-wrap').classList.remove('previewing');
  if (currentScreen === 'lobby') placePlayer(null);
  renderDetail();
}
$('#btnPreview').addEventListener('click', () => {
  if (preview.id === selId) stopPreview(); else startPreview(selId);
});
yt.on((st, err) => {
  if (st === 'error' && preview.id) { toast(err.message, 3500); stopPreview(); }
});

/* ============================================================ 곡 추가 (호스트) */
let addBusy = false;
async function addSong(regenerate = false, url = null) {
  url = url || $('#addUrl').value.trim();
  if (!url) { toast('유튜브 링크를 붙여넣어 주세요.'); return; }
  if (addBusy) { toast('이미 만드는 중이에요.'); return; }
  const st = $('#addStatus');
  try {
    addBusy = true;
    st.className = 'add-status';
    st.textContent = '요청 중...';
    const j = await api('/songs', { method: 'POST', body: { url, regenerate } });
    if (j.exists) {
      addBusy = false;
      st.textContent = '';
      if (confirm('이미 추가된 곡이에요. 자동 채보를 다시 만들까요? (수정한 채보는 덮어써져요)')) return addSong(true, url);
      return;
    }
    if (j.queued) {
      // 클라우드: 대기열에 넣고 바로 다음 곡을 넣을 수 있게 (PC 채보 엔진이 만들면 목록에 나타남)
      st.className = 'add-status ok';
      st.textContent = `'${j.title}' 대기열에 넣었어요. PC 채보 엔진이 만들면 곡 목록에 나타나요.`;
      $('#addUrl').value = '';
      loadJobs();
      return;
    }
    while (true) {
      await sleep(900);
      const job = await api('/jobs/' + j.jobId);
      st.innerHTML = `<span class="spin"></span>${esc(job.msg)}`;
      if (job.stage === 'done') {
        st.className = 'add-status ok';
        st.textContent = '완료! 곡 목록에 추가됐어요.';
        $('#addUrl').value = '';
        await refreshSongs();
        select(job.songId, { auto: false });
        break;
      }
      if (job.stage === 'error') {
        st.className = 'add-status err';
        st.textContent = job.msg;
        break;
      }
    }
  } catch (e) {
    st.className = 'add-status err';
    st.textContent = e.message;
  } finally {
    addBusy = false;
  }
}
$('#btnAdd').addEventListener('click', () => addSong());

/* 클라우드: PC 채보 엔진 대기열 (호스트) */
let pcJobs = { jobs: [], worker: null };
let engineState = null;          // 실행기(exe)가 알려주는 내 PC 채보 엔진 상태
const jobSeen = {};
async function loadJobs() {
  if (!isHost || !isCloud) return;
  try { pcJobs = await api('/jobs'); } catch { return; }
  for (const j of pcJobs.jobs) {
    if (jobSeen[j.id] && jobSeen[j.id] !== j.stage) {
      if (j.stage === 'done') toast(j.aiOnly ? `'${j.title}' AI 채보 완성!` : `'${j.title}' 곡이 추가됐어요!`, 3000);
      else if (j.stage === 'error') toast(`'${j.title}' ${j.aiOnly ? 'AI 채보' : ''} 만들기 실패: ${j.msg}`, 5000);
    }
    jobSeen[j.id] = j.stage;
  }
  renderJobs();
}
const PC_ACTIVE = ['claimed', 'info', 'download', 'analyze', 'ai', 'upload'];
function renderJobs() {
  if (!isHost || !isCloud) return;
  const w = pcJobs.worker || {};
  const jobs = pcJobs.jobs || [];
  const waiting = jobs.filter((j) => j.stage === 'waitpc').length;
  const working = jobs.some((j) => PC_ACTIVE.includes(j.stage));
  $('#pcDot').className = 'pc-dot' + (w.online ? (working ? ' work' : ' on') : '');
  let text;
  if (w.online) text = `채보 PC 연결됨${w.ai ? ' · AI 채보 켜짐' : ''}${working ? ' · 만드는 중' : ''}${waiting ? ` · 대기 ${waiting}곡` : working ? '' : ' · 쉬는 중'}`;
  else if (engineState && engineState.state !== 'ready') text = `채보 엔진: ${engineState.msg || '준비 중...'}`;
  else text = `채보 PC 꺼짐${waiting ? ` · 대기 ${waiting}곡` : ''} — 호스트 PC에서 LINKBEAT 실행기를 켜면 만들어져요`;
  $('#pcText').textContent = text;
  $('#btnAiBatch').classList.toggle('hidden', !w.ai);
  $('#btnAiOne').classList.toggle('hidden', !w.ai || !!net.room || !selId);
  $('#pcList').innerHTML = jobs.map((j) => {
    const live = j.stage === 'waitpc' || PC_ACTIVE.includes(j.stage);
    const msg = j.stage === 'done' ? '완료' : j.stage === 'canceled' ? '취소됨' : j.msg;
    return `<li class="${esc(j.stage)}"><span class="pt" title="${esc(j.title)}">${j.aiOnly ? '<span class="tag ai-tag">AI</span> ' : ''}${esc(j.title)}${j.by && j.by !== '호스트' ? ` <small class="muted">· ${esc(j.by)} 신청</small>` : ''}</span>
      <span class="pm" title="${esc(j.msg || '')}">${esc((msg || '').slice(0, 40))}</span>
      ${live ? `<button class="ghost small-btn" data-cancel="${esc(j.id)}" type="button">취소</button>` : ''}${j.stage === 'error' ? `<button class="ghost small-btn" data-retry="${esc(j.id)}" type="button">다시</button>` : ''}</li>`;
  }).join('');
}
$('#pcList').addEventListener('click', async (e) => {
  const rb = e.target.closest('button[data-retry]');
  if (rb) {
    rb.disabled = true;
    try { await api(`/jobs/${rb.dataset.retry}/retry`, { method: 'POST', body: {} }); loadJobs(); } catch (err) { toast(err.message); rb.disabled = false; }
    return;
  }
  const b = e.target.closest('button[data-cancel]');
  if (!b) return;
  b.disabled = true;
  try { await api('/jobs/' + b.dataset.cancel, { method: 'DELETE' }); loadJobs(); } catch (err) { toast(err.message); }
});
net.on('jobs', () => loadJobs());
$('#btnAiBatch').addEventListener('click', async () => {
  const mug = songs.filter((s) => aiIsMug(s));
  if (mug.length && confirm(`예전 AI(MuG)로 만든 AI 채보 ${mug.length}곡을 새 AI로 다시 만들까요? (곡당 7~8분 · 기록은 그대로)`)) {
    try {
      const r = await api('/ai/batch', { method: 'POST', body: { ids: mug.map((s) => s.id) } });
      toast(`${r.queued}곡을 AI 채보 대기열에 넣었어요.`, 3000);
      loadJobs();
    } catch (err) { toast(err.message); }
    return;
  }
  const left = songs.filter((s) => !s.ai).length;
  const old = songs.filter((s) => s.ai && !(s.ai.gen >= 2)).length;
  let all = false;
  if (old && confirm(`예전 방식(롱노트 많음) AI 채보 ${old}곡${left ? `과 AI 채보가 없는 ${left}곡` : ''}을 새 방식으로 만들까요? (곡당 7~8분 · 기록은 그대로)`)) {
    try {
      const r = await api('/ai/batch', { method: 'POST', body: { old: true } });
      toast(`${r.queued}곡을 AI 채보 대기열에 넣었어요.`, 3000);
      loadJobs();
    } catch (err) { toast(err.message); }
    return;
  }
  if (old) return;
  if (!left) {
    if (!confirm(`모든 곡에 이미 AI 채보가 있어요. ${songs.length}곡의 AI 채보를 전부 새로 다시 만들까요? (곡당 7~8분 · 기록은 그대로)`)) return;
    all = true;
  } else if (!confirm(`AI 채보가 없는 ${left}곡을 대기열에 넣어요. 호스트 PC의 AI 채보 도구가 한 곡씩 만들어요 (곡당 7~8분).\n새로 추가한 곡이 항상 먼저 만들어져요. 진행할까요?`)) return;
  try {
    const r = await api('/ai/batch', { method: 'POST', body: { all } });
    toast(r.queued ? `${r.queued}곡을 AI 채보 대기열에 넣었어요.` : '넣을 곡이 없어요.', 3000);
    loadJobs();
  } catch (err) { toast(err.message); }
});
/* 실행기(exe): 예전에 내 PC에서 쓰던 곡·기록·프로필을 이 서버로 옮기기 */
$('#btnImport').addEventListener('click', async () => {
  if (!window.lbDesktop) return;
  if (!confirm('예전에 쓰던 링크비트 폴더를 고르면, 그 안의 곡·기록·프로필·신청을 이 서버로 옮겨요.\n이미 서버에 있는 곡은 건너뛰고, 기록은 더 높은 점수를 남겨요. 진행할까요?')) return;
  try {
    const r = await window.lbDesktop.importLocal();
    if (r && r.msg) toast(r.msg, 5000);
    refreshSongs(); loadRequests();
  } catch (err) { toast(err.message || String(err), 5000); }
});
/* 클라우드: 호스트 키 입력 (설정 창) */
$('#hostKeyGo').addEventListener('click', async () => {
  const k = $('#hostKeyIn').value.trim();
  if (!k) return;
  hostKey = k;
  try {
    const w = await api('/whoami');
    if (!w.host) throw new Error('키가 맞지 않아요.');
    store.set('hostKey', k);
    if (window.lbDesktop) await window.lbDesktop.setHostKey(k);   // 실행기면 채보 엔진도 켬
    toast('호스트로 확인됐어요. 다시 불러올게요.');
    setTimeout(() => location.reload(), 600);
  } catch (err) {
    hostKey = store.get('hostKey', '');
    toast(err.message, 3000);
  }
});
$('#addUrl').addEventListener('keydown', (e) => { if (e.key === 'Enter') addSong(); });

/* ============================================================ 곡 신청함 */
let requests = [];
async function loadRequests() {
  try { requests = (await api('/requests')).requests; } catch { return; }
  renderRequests();
}
function renderRequests() {
  const n = requests.length + (isHost ? avRequests.length : 0);
  $('#reqCount').textContent = n;
  $('#reqCount').classList.toggle('hidden', !n);
  $('#reqCount2').textContent = n;
  $('#reqCount2').classList.toggle('hidden', !n);
  if (!requests.length) { $('#reqList').innerHTML = `<li class="empty-req">${isHost ? '신청된 곡이 없어요.' : '신청된 곡이 없어요. 위에서 곡을 신청해 보세요!'}</li>`; return; }
  $('#reqList').innerHTML = requests.map((r) => `<li data-id="${esc(r.id)}" data-vid="${esc(r.vid)}">
      <img src="https://i.ytimg.com/vi/${esc(r.vid)}/default.jpg" alt="" loading="lazy">
      <div class="req-info"><div class="req-title" title="${esc(r.title)}">${esc(r.title)}</div><div class="req-by">${esc(r.by)} 님 신청</div></div>
      ${r.state === 'queued' ? '<span class="req-state">승인됨 · 만드는 중</span>'
        : isHost ? `<div class="req-btns"><button class="primary" data-act="ok">승인</button><button class="ghost" data-act="no">거절</button></div>` : '<span class="req-by">대기 중</span>'}
    </li>`).join('');
}
$('#reqList').addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-act]');
  if (!b || !isHost) return;
  const li = b.closest('li');
  if (b.dataset.act === 'ok' && isCloud) {
    // 클라우드: 승인한 신청만 PC 채보 엔진 대기열로
    b.disabled = true;
    try { await api(`/requests/${li.dataset.id}/approve`, { method: 'POST' }); loadJobs(); } catch (err) { toast(err.message); b.disabled = false; }
    return;
  }
  if (b.dataset.act === 'ok') {
    if (addBusy) { toast('다른 곡을 만드는 중이에요. 끝나면 다시 눌러 주세요.'); return; }
    b.disabled = true; b.textContent = '만드는 중';
    addSong(false, 'https://youtu.be/' + li.dataset.vid);   // 완료되면 서버가 신청을 지워요
  } else {
    try { await api('/requests/' + li.dataset.id, { method: 'DELETE' }); } catch (err) { toast(err.message); }
  }
});
async function submitRequest() {
  const url = $('#reqUrl').value.trim();
  const st = $('#reqStatus');
  if (!url) { toast('유튜브 링크를 붙여넣어 주세요.'); return; }
  if (!settings.nick) toast('닉네임을 정해 두면 누가 신청했는지 보여요.');
  st.className = 'add-status';
  st.innerHTML = '<span class="spin"></span>신청하는 중...';
  try {
    const r = await api('/requests', { method: 'POST', body: { url, name: settings.nick || '' } });
    st.className = 'add-status ok';
    st.textContent = `'${r.title}' 신청 완료! 호스트가 승인하면 곡 목록에 나타나요.`;
    $('#reqUrl').value = '';
  } catch (err) {
    st.className = 'add-status err';
    st.textContent = err.message;
  }
}
$('#btnReq').addEventListener('click', submitRequest);
$('#reqUrl').addEventListener('keydown', (e) => { if (e.key === 'Enter') submitRequest(); });
net.on('requests', (m) => {
  loadRequests();
  if (isHost && m.new) toast(`🎵 ${m.new.by} 님이 '${m.new.title}' 곡을 신청했어요`, 4000);
});

/* AI 캐릭터 신청 (방장만 보임): 친구가 'AI로 그리기'를 누르면 여기로 → 승인해야 호스트 PC가 그림 */
let avRequests = [];
async function loadAvRequests() {
  if (!isHost || !isCloud) { avRequests = []; renderAvRequests(); return; }
  try { avRequests = (await api('/avatar/ai/requests')).requests || []; } catch { return; }
  renderAvRequests();
}
function renderAvRequests() {
  const box = $('#avReqBox');
  box.classList.toggle('hidden', !avRequests.length);
  $('#avReqList').innerHTML = avRequests.map((r) => `<li data-id="${esc(r.id)}">
      <span class="avreq-face">${typeof miniHtml === 'function' ? miniHtml(r.avatar, 40) : ''}</span>
      <div class="req-info"><div class="req-title">${esc(r.name)} 님${r.mode === 'pixel' ? ' <small class="muted">· 동작만 다시</small>' : ''}</div>
        <div class="req-by">${r.desc ? '원하는 모습: ' + esc(r.desc) : '캐릭터 설정대로'}${r.ref ? ' · 참고 사진 있음' : ''}</div>
        ${r.ref ? `<img class="avreq-ref" src="${esc(r.ref)}" alt="참고 사진">` : ''}</div>
      <div class="req-btns"><button class="primary" data-act="ok">승인</button><button class="ghost" data-act="no">거절</button></div>
    </li>`).join('');
  if (typeof paintMinis === 'function') paintMinis($('#avReqList'));
  renderRequests();
}
$('#avReqList').addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-act]');
  if (!b || !isHost) return;
  const li = b.closest('li');
  $$('button', li).forEach((x) => { x.disabled = true; });
  try {
    await api(`/avatar/ai/requests/${li.dataset.id}`, { method: 'POST', body: { ok: b.dataset.act === 'ok' } });
    toast(b.dataset.act === 'ok' ? '승인했어요. 호스트 PC가 차례대로 그려요.' : '거절했어요.');
  } catch (err) { toast(err.message); }
  loadAvRequests();
});
$('#avReqList').addEventListener('click', (e) => {     // 참고 사진 크게
  const im = e.target.closest('.avreq-ref');
  if (im) im.classList.toggle('big');
});
net.on('avjobs', (m) => {
  if (!isHost) return;
  loadAvRequests();
  if (m.avReq) toast(`🎨 ${m.avReq.name} 님이 AI 캐릭터 그리기를 신청했어요 (신청함에서 승인)`, 4500);
});
net.on('songs', () => { if (currentScreen === 'lobby' && !addBusy) refreshSongs(); });

/* ============================================================ 플레이 */
async function fetchSong(id) { return api('/songs/' + id); }

/* 고스트 대결 상대: 친구 1위 기록 (1위가 나면 내 최고 기록). 점수 흐름이 없는 예전 기록은 고르게 올랐다고 가정 */
function ghostFor(id, diff, nl, hl, ai) {
  const s = songById(id);
  if (!s) return null;
  const nick = (settings.nick || '').trim();
  const top = boardOf(s, nl, diff, hl, ai)[0];
  const linear = (score) => Array.from({ length: 21 }, (_, i) => Math.round((score * i) / 20));
  const mk = (e, label) => ({ label, score: e.score, g: Array.isArray(e.g) && e.g.length >= 2 ? e.g : linear(e.score) });
  if (top && top.name !== nick) return mk(top, `${top.name} · 1위`);
  const mine = myRecord(s, nl, diff, hl, ai);
  return mine && mine.score > 0 ? mk(mine, '내 최고 기록') : null;
}

let soloSeq = 0;
async function startSolo(id, diff, nl = 4, customNotes = null, practice = null, opts = {}) {
  const token = ++soloSeq;
  stopPreview();
  if (game) game.destroy();
  let song;
  try { song = await fetchSong(id); } catch (e) { toast(e.message); return; }
  if (token !== soloSeq) return;   // 그 사이에 다른 곡을 시작했으면 이건 버림
  stopPreview();
  if (game) game.destroy();
  if (practice && practice.hl && song._hl) practice = hlPractice(song._hl);   // 서버의 최신 구간으로
  const useAi = !customNotes && !!aiChartOf(song, diff, nl) && (typeof opts.ai === 'boolean' ? opts.ai : songPick(songById(id) || song));
  const notes = customNotes || (useAi ? aiChartOf(song, diff, nl) : chartOf(song, diff, nl));
  if (!notes.length) { toast('이 난이도에는 노트가 없어요.'); return; }
  pendingResults = null;
  const g = new Game({ song, diff, keys: nl, notes, onExit: backFromGame, practice });
  game = g;
  if (!customNotes && (!practice || practice.hl)) g.ghost = ghostFor(id, diff, nl, !!(practice && practice.hl), useAi);
  if (opts.ghost) g.ghost = opts.ghost;       // 도전장·복수전: 그 친구 기록과 대결
  if (opts.duel) g.duel = opts.duel;
  g.customNotes = customNotes;
  g.ai = useAi;
  setupGameScreen(g, false);
  if (practice && !g.notes.length) { g.destroy(); toast('그 구간에는 노트가 없어요.'); backFromGame(); return; }
  try {
    await g.load();
    if (game !== g || g.phase !== 'ready') return;
    if (isTouch) await g.waitTap('준비되면 탭하세요');
    if (game === g && g.phase === 'ready') g.begin(2.5);
  } catch (e) {
    g.abort(e.message);
  }
}

function setupGameScreen(g, multi) {
  hideOverlay();
  $('#gTitle').textContent = g.song.title;
  const extra = [g.ai ? 'AI 채보' : '', ...g.modNames, g.hl ? 'HIGHLIGHT' : g.practice ? `연습 x${g.practice.rate}` : ''].filter(Boolean).join(' · ');
  $('#gMeta').innerHTML = `<span class="tag">${g.nl}KEY</span> ${DIFF_EN[g.diff]} ${starHtml(g.stars)} · BPM ${Math.round(g.song.bpm)} · ${fmtTime(g.song.duration)}${extra ? ` <br><span class="warn">${esc(extra)}</span>` : ''}`;
  $('#livePanel').classList.toggle('hidden', !multi);
  $('#screen-game').classList.toggle('multi', !!multi);
  const bg = $('#gameBg');     // 배경 연출: 곡 썸네일
  if (bg) { $('.gb-img', bg).style.backgroundImage = `url("https://i.ytimg.com/vi/${g.song.id}/hqdefault.jpg")`; bg.style.setProperty('--pulse', '0'); }
  $('#specPanel').classList.add('hidden');
  $('#liveBoard').innerHTML = '';
  updateOffsetShow();
  showScreen('game');
}

function backFromGame() {
  if (editor && editor.testing) {
    editor.testing = false;
    showScreen('editor');
    editor.loop();
    return;
  }
  showScreen('lobby');
  renderMods();
  refreshSongs();
}

function updateOffsetShow() {
  $('#offsetShow').textContent = `(${settings.offset > 0 ? '+' : ''}${settings.offset}ms)`;
}
$('#btnTouchPause').addEventListener('click', () => { if (game && currentScreen === 'game') game.pause(); });

/* ============================================================ 결과 */
const RANK_ORDER = RANKS;
const rankIdx = (k) => RANK_ORDER.indexOf(k);
/* 이번 판 전까지의 내 최고 기록 (서버 순위표의 내 기록과 이 컴퓨터의 기록 중 더 좋은 것) */
function prevBestOf(g) {
  const s = songById(g.song.id);
  const nick = (settings.nick || '').trim();
  const cands = [];
  if (s && nick) { const e = boardOf(s, g.nl, g.diff, !!g.hl, !!g.ai).find((x) => x.name === nick); if (e) cands.push(e); }
  const lb = getBest(g.song.id, g.diff, g.nl, !!g.hl, !!g.ai);
  if (lb) cands.push(lb);
  if (!cands.length) return null;
  const best = cands.reduce((a, b) => (b.score > a.score ? b : a));
  const bestRank = cands.map((c) => rankFor(c)).filter((k) => rankIdx(k) >= 0).sort((a, b) => rankIdx(b) - rankIdx(a))[0] || best.rank;
  const same = cands.filter((c) => c.score === best.score);      // 같은 기록이 서버·이 브라우저에 있으면 빠진 칸을 서로 채움
  const pick = (k) => { const c = same.find((x) => x[k] != null); return c ? c[k] : null; };
  return { score: best.score || 0, rank: bestRank, acc: pick('acc'), maxCombo: pick('maxCombo'), counts: pick('counts') };
}
/* 판정 개수·정확도·최대 콤보를 최고 기록과 비교 (예전 기록이라 판정 개수가 없으면 그 칸은 안 보임) */
function renderStatDelta(prev, r, show) {
  const put = (id, d, goodUp, fmt) => {
    const el = $(id);
    if (!el) return;
    if (d == null || !isFinite(d)) { el.textContent = ''; el.className = 'sd'; return; }
    const better = goodUp ? d > 0 : d < 0;
    el.className = 'sd ' + (d === 0 ? 'same' : better ? 'up' : 'down');
    el.textContent = d === 0 ? '±0' : (d > 0 ? '▲' : '▼') + fmt(Math.abs(d));
  };
  const on = show && prev && !r.incomplete;
  const c = on && prev.counts;
  const n = (x) => x.toLocaleString();
  put('#dPerfect', c ? r.counts.perfect - c.perfect : null, true, n);
  put('#dGreat', c ? r.counts.great - c.great : null, false, n);
  put('#dGood', c ? r.counts.good - c.good : null, false, n);
  put('#dMiss', c ? r.counts.miss - c.miss : null, false, n);
  put('#dAcc', on && prev.acc != null ? Math.round((r.acc - prev.acc) * 100) / 100 : null, true, (x) => x.toFixed(2) + '%');
  put('#dCombo', on && prev.maxCombo != null ? r.maxCombo - prev.maxCombo : null, true, n);
}
/* 점수가 얼마나 올랐는지 · 등급이 몇에서 몇으로 올랐는지 */
function renderBestDelta(prev, r, show) {
  const dl = $('#rDelta'), ru = $('#rRankUp');
  dl.className = 'r-delta hidden'; ru.className = 'r-rankup hidden';
  if (!show || r.incomplete) return;
  if (!prev) {
    dl.className = 'r-delta up';
    dl.innerHTML = '★ 첫 기록!';
    return;
  }
  const d = r.score - prev.score;
  dl.className = 'r-delta ' + (d > 0 ? 'up' : d === 0 ? 'same' : 'down');
  dl.innerHTML = d > 0 ? `▲ +${d.toLocaleString()} <small>· 최고 기록 갱신! (이전 ${prev.score.toLocaleString()})</small>`
    : d === 0 ? '최고 기록과 같은 점수예요'
      : `최고 기록 ${prev.score.toLocaleString()}까지 <b>−${Math.abs(d).toLocaleString()}</b>`;
  if (rankIdx(r.rank) > rankIdx(prev.rank) && rankIdx(prev.rank) >= 0) {
    ru.className = 'r-rankup up';
    ru.innerHTML = `<span class="rank-${esc(prev.rank)}">${esc(prev.rank)}</span><i>→</i><span class="rank-${esc(r.rank)}">${esc(r.rank)}</span><em>RANK UP</em>`;
  } else if (rankIdx(prev.rank) >= 0) {
    ru.className = 'r-rankup';
    ru.innerHTML = `최고 등급 <span class="rank-${esc(prev.rank)}">${esc(prev.rank)}</span>`;
  }
}

function showResult(g, r) {
  lastResult = { g, r };
  const isTest = !!(editor && editor.testing) || !!g.customNotes || (!!g.practice && !g.hl);
  const prevBest = isTest ? null : prevBestOf(g);      // 기록을 저장하기 전에 읽어 둠
  const newLocal = !isTest && setBest(g.song.id, g.diff, g.nl, r, g.hl, !!g.ai);
  renderBestDelta(prevBest, r, !isTest);
  renderStatDelta(prevBest, r, !isTest);
  const mods = (g.ai ? ' <span class="tag ai-tag">AI 채보</span>' : '') + (g.hl ? ' <span class="tag hl-tag">HIGHLIGHT</span>' : '') + (g.modNames.length ? ` <span class="warn">${g.modNames.join(' · ')}</span>` : '');
  $('#rSong').innerHTML = `${esc(g.song.title)} <span class="tag">${g.nl}KEY</span> ${DIFF_EN[g.diff]} ${starHtml(g.stars)}${mods}`;
  $('#rRank').textContent = r.rank;
  $('#rRank').className = 'r-rank rank-' + r.rank;
  $('#rScore').textContent = r.score.toLocaleString();
  $('#rAcc').textContent = r.acc.toFixed(2) + '%';
  $('#rCombo').textContent = r.maxCombo;
  $('#rPerfect').textContent = r.counts.perfect;
  $('#rGreat').textContent = r.counts.great;
  $('#rGood').textContent = r.counts.good;
  $('#rMiss').textContent = r.counts.miss;
  const tot = Math.max(1, r.counts.perfect + r.counts.great + r.counts.good + r.counts.miss);
  [['.c-perfect', r.counts.perfect], ['.c-great', r.counts.great], ['.c-good', r.counts.good], ['.c-miss', r.counts.miss]].forEach(([k, v]) => {
    const u = $(`#rCounts ${k} .cbar u`);
    if (u) { u.style.setProperty('--w', '0%'); requestAnimationFrame(() => requestAnimationFrame(() => u.style.setProperty('--w', `${(v / tot * 100).toFixed(1)}%`))); }
  });
  $('#rBadge').textContent = r.incomplete ? '중도 포기' : r.counts.miss === 0 && r.counts.good === 0 && r.counts.great === 0 ? 'ALL PERFECT' : r.fc ? 'FULL COMBO' : '';
  $('#rBest').textContent = g.practice && !g.hl ? '연습 모드라 기록은 남지 않아요.' : isTest ? '테스트 플레이라 기록은 남지 않아요.' : newLocal ? (g.hl ? '하이라이트 최고 기록 갱신!' : '내 최고 기록 갱신!') : '';
  const rg = $('#rGhost');
  rg.classList.add('hidden');
  if (g.ghost && !r.incomplete && settings.ghost !== false) {
    const d = r.score - g.ghost.score;
    g.ghostWin = d > 0;
    rg.innerHTML = `👻 VS ${esc(g.ghost.label)} · ${d > 0 ? `<b class="win">승리!</b> (+${d.toLocaleString()})` : d === 0 ? '<b>무승부</b>' : `<b class="lose">아쉽게 패배</b> (−${Math.abs(d).toLocaleString()})`}`;
    rg.classList.remove('hidden');
  }
  $('#btnRetry').classList.toggle('hidden', g.multi);
  $('#btnResRank').classList.toggle('hidden', isTest);
  $('#btnToLobby').textContent = editor && editor.testing ? '수정 화면으로' : g.multi ? '방으로' : '곡 선택으로';
  $('#rMulti').classList.toggle('hidden', !g.multi);
  if (g.multi) {
    if (pendingResults) renderMultiResults(pendingResults);
    else $('#rMultiList').innerHTML = '<li class="muted">다른 플레이어가 끝나길 기다리는 중...</li>';
  }
  showScreen('result');
  requestAnimationFrame(() => drawTiming(g.offsets));
  startResultAvatar(r);
  if (g.fcKind && !r.incomplete) startConfetti(g.fcKind === 'ap');
  if (!isTest && typeof achieveOnResult === 'function') { try { achieveOnResult(g, r); } catch (e) { console.warn('업적 확인 오류', e); } }
  if (typeof gainXp === 'function') { try { if (isTest) $('#rXp').classList.add('hidden'); else gainXp(g, r); } catch (e) { console.warn('경험치 오류', e); } }
  if (!isTest) {
    api('/scores', {
      method: 'POST',
      body: { songId: g.song.id, diff: g.diff, keys: g.nl, name: settings.nick || '이름없음', ...r, hl: g.hl, ai: !!g.ai,
        multi: !!g.multi, ghostWin: !!g.ghostWin, pumpkins: g.pumpkins || 0, ...(g.duel ? { duel: g.duel } : {}) },
    }).then((res) => {
      if (typeof growOnResult === 'function') { try { growOnResult(g, r, res); } catch (e) { console.warn('보상 표시 오류', e); } }
      if (lastResult.g !== g || r.incomplete) return;
      const parts = [];
      if (res.newBest) parts.push('<b class="nb">NEW RECORD</b>');
      if (res.position) parts.push(`친구 순위 <b>${res.position}위</b> / ${res.total}명`);
      $('#rBest').innerHTML = parts.join(' · ') || $('#rBest').innerHTML;
      afterDailyPlay(g, r);
    }).catch(() => { if (typeof growOnResult === 'function') growOnResult(g, r, null); });
  }
}

/* 풀콤보·올퍼펙트: 결과 화면에 꽃가루 (몇 초 뒤 저절로 사라짐) */
let confettiRaf = 0;
function startConfetti(big) {
  cancelAnimationFrame(confettiRaf);
  let cv = $('#confetti');
  if (!cv) {
    cv = document.createElement('canvas');
    cv.id = 'confetti';
    $('#screen-result').appendChild(cv);
  }
  const dpr = window.devicePixelRatio || 1;
  const W = window.innerWidth, H = window.innerHeight;
  cv.width = W * dpr; cv.height = H * dpr;
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const cols = big ? ['#ffc83d', '#fff3b0', '#ff9de0', '#9ff6ff', '#ffffff', '#ff7a3d'] : ['#4de1ff', '#3f8cff', '#ffffff', '#ffc83d'];
  const N = big ? 170 : 110;
  const ps = Array.from({ length: N }, (_, i) => ({
    x: Math.random() * W, y: -20 - Math.random() * H * 0.6,
    vx: (Math.random() - 0.5) * 60, vy: 90 + Math.random() * 140,
    w: 6 + Math.random() * 6, h: 3 + Math.random() * 5,
    r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 9, sw: Math.random() * Math.PI * 2, c: cols[i % cols.length],
  }));
  const t0 = performance.now();
  let last = t0;
  const step = (now) => {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    const age = (now - t0) / 1000;
    ctx.clearRect(0, 0, W, H);
    if (currentScreen !== 'result' || age > 6) { ctx.clearRect(0, 0, W, H); return; }
    ctx.globalAlpha = age > 4.8 ? Math.max(0, (6 - age) / 1.2) : 1;
    for (const p of ps) {
      p.sw += dt * 3; p.x += (p.vx + Math.sin(p.sw) * 40) * dt; p.y += p.vy * dt; p.r += p.vr * dt;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.scale(1, Math.abs(Math.cos(p.sw * 1.3)) * 0.8 + 0.2);
      ctx.fillStyle = p.c; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); ctx.restore();
    }
    ctx.globalAlpha = 1;
    confettiRaf = requestAnimationFrame(step);
  };
  confettiRaf = requestAnimationFrame(step);
}

/* 결과 화면 내 일러스트·캐릭터를 누르면 크게 */
$('#rIllust').addEventListener('click', () => openBigView(settings.avatar, 'il', settings.nick || '내 캐릭터'));
$('#rAvatar').addEventListener('click', () => openBigView(settings.avatar, 'char', settings.nick || '내 캐릭터'));
/* 결과 화면 캐릭터: 등급에 따라 환호 / 보통 / 아쉬움 */
let resultAvRaf = 0;
function startResultAvatar(r) {
  cancelAnimationFrame(resultAvRaf);
  const stage = new AvatarStage($('#rAvatar'));
  const good = !r.incomplete && rankIdx(r.rank) >= rankIdx('S');
  const bad = r.incomplete || r.rank === 'C' || r.rank === 'D';
  const url = typeof aiIllustUrl === 'function' ? aiIllustUrl(settings.avatar) : '';   // AI 일러스트가 있으면 그걸 크게
  const il = $('#rIllust');
  il.classList.toggle('hidden', !url);
  $('#rAvatar').classList.toggle('hidden', !!url);
  if (url) {
    if (il.getAttribute('src') !== url) il.src = url;
    il.className = 'r-illust ' + (good ? 'good' : bad ? 'bad' : '');
    return;
  }
  const force = good ? { pose: 'up', eyes: 'happy', mouth: 'open' }
    : bad ? { pose: 'sad', eyes: 'closed', mouth: 'sad', sweat: true }
    : { pose: 'right', mouth: 'smile' };
  const step = () => {
    if (currentScreen !== 'result') return;
    stage.draw({ force, bounce: good });
    resultAvRaf = requestAnimationFrame(step);
  };
  resultAvRaf = requestAnimationFrame(step);
}

/* 판정 오차 분포 그래프 + 싱크 추천 */
function drawTiming(offsets) {
  const cv = $('#rtCanvas');
  const dpr = window.devicePixelRatio || 1;
  const r = cv.parentElement.getBoundingClientRect();
  const w = Math.max(100, Math.floor(r.width)), h = Math.max(60, Math.floor(r.height));
  cv.width = w * dpr; cv.height = h * dpr;
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const ms = offsets.map((x) => x * 1000);
  const n = ms.length;
  const BIN = 10, LIM = 140, NB = (LIM * 2) / BIN;
  const bins = new Array(NB).fill(0);
  for (const v of ms) bins[clamp(Math.floor((v + LIM) / BIN), 0, NB - 1)]++;
  const max = Math.max(1, ...bins);
  const bw = w / NB;
  for (let i = 0; i < NB; i++) {
    const c = -LIM + (i + 0.5) * BIN;
    const a = Math.abs(c);
    ctx.fillStyle = a <= JUDGE.perfect * 1000 ? '#ffe45e' : a <= JUDGE.great * 1000 ? '#5effa1' : '#5ec8ff';
    const bh = (bins[i] / max) * (h - 18);
    ctx.fillRect(i * bw + 1, h - 14 - bh, bw - 2, bh);
  }
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.fillRect(w / 2 - 0.5, 0, 1, h - 14);
  ctx.font = '700 10px "Orbitron", sans-serif';
  ctx.fillStyle = 'rgba(160,190,255,0.8)';
  ctx.textBaseline = 'bottom';
  ctx.textAlign = 'left'; ctx.fillText('◀ FAST', 4, h - 1);
  ctx.textAlign = 'right'; ctx.fillText('SLOW ▶', w - 4, h - 1);
  ctx.textAlign = 'center'; ctx.fillText('0', w / 2, h - 1);
  const sug = $('#rtSuggest');
  if (n < 5) { $('#rtStats').textContent = ''; sug.textContent = '판정 기록이 너무 적어요.'; return; }
  const mean = ms.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(ms.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
  const fast = ms.filter((v) => v < -JUDGE.perfect * 1000).length;
  const slow = ms.filter((v) => v > JUDGE.perfect * 1000).length;
  $('#rtStats').textContent = `평균 ${mean > 0 ? '+' : ''}${mean.toFixed(1)}ms · 흔들림 ±${sd.toFixed(0)}ms · FAST ${fast} / SLOW ${slow}`;
  if (n >= 20 && Math.abs(mean) >= 10) {
    const next = clamp(Math.round((settings.offset + mean) / 5) * 5, -300, 300);
    sug.innerHTML = `평균적으로 <b>${Math.abs(mean).toFixed(0)}ms ${mean > 0 ? '늦게' : '빨리'}</b> 치고 있어요. 싱크를 ${settings.offset}ms → <b>${next}ms</b>로 바꾸면 좋아요. <button id="rtApply" class="primary">적용</button>`;
    $('#rtApply').onclick = () => {
      settings.offset = next; saveSettings(); updateOffsetShow();
      sug.textContent = `싱크를 ${next}ms로 바꿨어요. 다음 판부터 적용돼요.`;
    };
  } else {
    sug.textContent = Math.abs(mean) < 10 ? '타이밍이 잘 맞아요. 지금 싱크 그대로 좋아요!' : '판정 기록이 더 쌓이면 싱크를 추천해 드릴게요.';
  }
}

const r_avatars = {};
function renderMultiResults(m) {
  const avOf = (id) => ((net.room && net.room.players.find((p) => p.id === id)) || {}).avatar || r_avatars[id];
  for (const r of m.results) plRemember({ id: r.id, name: r.name, title: r.title, avatar: avOf(r.id) || r.avatar });
  $('#rMultiList').innerHTML = m.results.map((r, i) =>
    `<li class="${r.id === net.id ? 'me' : ''}" data-pl="${esc(r.id)}"><span class="pos">${i + 1}</span><span class="n">${miniHtml(avOf(r.id) || r.avatar, 24)} ${typeof lvTag === 'function' ? lvTag(r.level) : ''}${r.title ? `<span class="${ptCls(r.title)}">${esc(r.title)}</span>` : ''}${nameDeco(r)}${r.diff ? ` <small class="ld"><span class="tag">${r.keys || 4}K</span> ${DIFF_EN[r.diff] || ''}</small>` : ''}</span>
      <span class="s">${(r.score || 0).toLocaleString()}</span><span class="a">${(r.acc || 0).toFixed(2)}%</span>
      <span class="rk rank-${esc(r.rank || '')}">${r.incomplete ? '포기' : esc(r.rank || '')}</span></li>`).join('');
  paintMinis($('#rMultiList'));
  if (typeof growDuelResult === 'function') growDuelResult(m);
}

$('#btnRetry').addEventListener('click', () => {
  if (!lastResult) return;
  const g = lastResult.g;
  startSolo(g.song.id, g.diff, g.nl, g.customNotes, g.practice);
});
$('#btnResRank').addEventListener('click', () => lastResult && openRank(lastResult.g.song.id, lastResult.g.nl, lastResult.g.diff, lastResult.g.hl, !!lastResult.g.ai));
$('#btnToLobby').addEventListener('click', () => { game = null; backFromGame(); });

/* ============================================================ 순위표 */
const rankCtx = { id: null, mode: 4, diff: 'normal', hl: false, ai: false, data: null };
async function openRank(id, mode, diff, hl = hlActive(), ai = aiOn(songById(id), mode, diff)) {
  Object.assign(rankCtx, { id, mode, diff, hl: !!hl, ai: !!ai, data: null });
  const s = songById(id);
  $('#rankTitle').textContent = s ? s.title : '';
  $('#rankList').innerHTML = '<li class="muted">불러오는 중...</li>';
  if (!$('#rankDlg').open) $('#rankDlg').showModal();
  try {
    const data = await api('/scores/' + id);
    if (rankCtx.id !== id) return;
    rankCtx.data = data;
  } catch (e) {
    if (rankCtx.id !== id) return;
    $('#rankList').innerHTML = `<li class="muted">${esc(e.message)}</li>`;
    return;
  }
  renderRank();
}
function renderRank() {
  const { mode, diff, hl, data } = rankCtx;
  const sAi = songById(rankCtx.id);
  const showAi = mode === 4 && !!(sAi && sAi.ai);
  const ai = showAi && rankCtx.ai;
  $$('#rankMode button').forEach((b) => b.classList.toggle('on', +b.dataset.mode === mode));
  $$('#rankHl button').forEach((b) => b.classList.toggle('on', (b.dataset.hl === '1') === hl));
  $('#rankAi').classList.toggle('hidden', !showAi);
  $$('#rankAi button').forEach((b) => b.classList.toggle('on', (b.dataset.ai === '1') === ai));
  $$('#rankDiff button').forEach((b) => b.classList.toggle('on', b.dataset.diff === diff));
  if (!data) return;
  const s = songById(rankCtx.id);
  const st = s ? (ai ? (s.ai.stars || {})[diff] || 0 : ((s.stars || {})[mode] || {})[diff] || 0) : 0;
  $('#rankPlays').innerHTML = `총 ${data.plays}회 플레이${s ? ` · ${mode}KEY ${DIFF_EN[diff]}${ai ? ' AI' : ''} ${starHtml(st)}` : ''}`;
  const rows = data.entries.filter((e) => e.diff === diff && (e.keys || 4) === mode && !!e.hl === hl && !!e.ai === ai).sort((a, b) => b.score - a.score);
  const nick = settings.nick || '';
  $('#rankList').innerHTML = rows.length ? rows.map((e, i) => {
    const d = new Date(e.at * 1000);
    return `<li class="${e.name === nick ? 'me' : ''}"><span class="pos">${i + 1}</span><span class="n">${esc(e.name)}</span>
      <span class="rk rank-${esc(rankFor(e))}">${esc(rankFor(e))}</span><span class="s">${e.score.toLocaleString()}</span>
      <span class="a">${e.acc.toFixed(2)}%${e.fc ? ' <b class="fc">FC</b>' : ''}</span>
      <span class="dt">${d.getMonth() + 1}/${d.getDate()}</span></li>`;
  }).join('') : '<li class="muted">아직 기록이 없어요. 첫 번째 주인공이 되어 보세요!</li>';
}
$('#rankMode').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { rankCtx.mode = +b.dataset.mode; renderRank(); } });
$('#rankDiff').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { rankCtx.diff = b.dataset.diff; renderRank(); } });
$('#rankHl').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { rankCtx.hl = b.dataset.hl === '1'; renderRank(); } });
$('#rankAi').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { rankCtx.ai = b.dataset.ai === '1'; renderRank(); } });
$('#rankClose').addEventListener('click', () => $('#rankDlg').close());

/* ============================================================ 멀티 */
let lastRoomSong = null;
let roomAllReady = false;
function renderRoom() {
  const r = net.room;
  $('#multiOut').classList.toggle('hidden', !!r);
  $('#multiIn').classList.toggle('hidden', !r);
  if (typeof renderSide === 'function') renderSide();
  if (r) {
    $('#roomCode').textContent = r.code;
    const stateName = { idle: '', loading: '로딩', loaded: '준비', playing: '플레이 중', done: '완료', error: '오류' };
    const s = r.songId ? songById(r.songId) : null;
    $('#roomPlayers').innerHTML = r.players.map((p) => {
      const pk = p.keys === 6 ? 6 : 4, pd = p.diff || 'normal';
      const st = s ? ' ' + starHtml(starOf(s, pk, pd)) : '';
      plRemember(p);
      // 게임 전엔 준비 여부 (방장은 '방장'), 게임 중엔 로딩·플레이 중 같은 상태
      const lead = p.id === r.leader;
      const tag = r.phase === 'lobby' && (p.state === 'idle' || !p.state)
        ? (lead ? '<span class="rdy lead">방장</span>' : p.ready ? '<span class="rdy on">✓ 준비</span>' : '<span class="rdy">대기</span>')
        : `<span class="muted small">${stateName[p.state] || ''}</span>`;
      return `<li class="${p.id === net.id ? 'me' : ''}${!lead && p.ready ? ' ready' : ''}" data-pl="${esc(p.id)}" title="눌러서 ${esc(p.name)} 님 캐릭터·자주 하는 노래 보기">${miniHtml(p.avatar)}${lead ? '<span class="crown">👑</span>' : ''}<span class="pn">${p.title ? `<span class="${ptCls(p.title)}">${esc(p.title)}</span>` : ''}<span class="pn-n">${typeof lvTag === 'function' ? lvTag(p.level) : ''}${nameDeco(p)}</span></span>
        <span class="pdiff"><span class="tag">${pk}K</span> ${DIFF_EN[pd] || ''}${st}</span>
        ${tag}</li>`;
    }).join('');
    $('#roomPlayers').insertAdjacentHTML('beforeend', (r.watchers || []).map((p) => {
      plRemember(p);
      return `<li class="watch${p.id === net.id ? ' me' : ''}" data-pl="${esc(p.id)}" title="게임이 끝나면 같이 해요">${miniHtml(p.avatar)}<span class="pn">${p.title ? `<span class="${ptCls(p.title)}">${esc(p.title)}</span>` : ''}<span class="pn-n">${typeof lvTag === 'function' ? lvTag(p.level) : ''}${nameDeco(p)}</span></span><span class="rdy watch">👀 구경 중</span></li>`;
    }).join(''));
    paintMinis($('#roomPlayers'));
    $('#roomSong').textContent = r.songId ? r.songTitle : '방장이 곡을 고르는 중...';
    $('#roomDiff').innerHTML = (r.songId ? `난이도·키는 각자 골라요 · 내 선택 <span class="tag">${settings.mode}KEY</span> ${DIFF_EN[settings.diff]} ${s ? starHtml(starOf(s, settings.mode, settings.diff)) : ''}` : '')
      + (r.ai === false ? '<div class="ai-note">기존 채보로 플레이 (방장이 이 곡은 기존 채보로 골랐어요)</div>' : '')
      + (r.hl ? `<div class="hl-note">★ 하이라이트 모드 — 후렴만 플레이${s && s.hl ? ` (${fmtTime(s.hl.from)}~${fmtTime(s.hl.end)})` : ''}</div>` : '');
    // 방장이 곡을 바꾸면 내 목록에서도 그 곡을 골라 별점을 바로 보여줌
    if (r.songId && r.songId !== lastRoomSong && !net.isLeader() && songById(r.songId) && currentScreen === 'lobby') {
      lastRoomSong = r.songId;      // 실제로 골라준 경우에만 기억 (결과 화면에 있을 땐 로비로 돌아올 때 다시 시도)
      select(r.songId, { auto: false });
    }
    const leader = net.isLeader();
    const others = r.players.filter((p) => p.id !== r.leader), readyN = others.filter((p) => p.ready).length;
    const allReady = readyN === others.length;
    $('#btnRoomStart').classList.toggle('hidden', !leader);
    $('#btnRoomStart').disabled = !r.songId || r.phase !== 'lobby' || !allReady;
    $('#btnRoomStart').textContent = !r.songId ? '게임 시작' : allReady ? '게임 시작' : `준비 기다리는 중 (${readyN}/${others.length})`;
    $('#btnRoomForce').classList.toggle('hidden', !leader || !r.songId || allReady || r.phase !== 'lobby');
    // 방장이 아니면 '준비' 버튼 (누를 때마다 준비 ↔ 취소)
    const me = r.players.find((p) => p.id === net.id);
    const imReady = !!(me && me.ready);
    $('#btnReady').classList.toggle('hidden', leader || r.phase !== 'lobby');
    const watching = (r.watchers || []).some((p) => p.id === net.id);
    $('#btnWatch').classList.toggle('hidden', !watching);
    // 방장: 모두 준비되면 '띵-동' (한 번만)
    const allSet = leader && r.phase === 'lobby' && !!r.songId && others.length > 0 && allReady;
    if (allSet && !roomAllReady) { sfx.ding(); toast('모두 준비됐어요! 시작해 볼까요?', 2200); }
    roomAllReady = allSet;
    $('#btnReady').classList.toggle('on', imReady);
    $('#btnReady').classList.toggle('primary', !imReady);
    $('#btnReady').textContent = imReady ? '✓ 준비 완료 · 누르면 취소' : '준비';
    $('#roomWait').classList.toggle('hidden', leader);
    $('#roomWait').textContent = watching ? '구경 중이에요 · 이번 판이 끝나면 같이 해요' : r.phase !== 'lobby' ? '게임 진행 중...' : !r.songId ? '방장이 곡을 고르는 중...'
      : imReady ? '방장이 시작하길 기다리는 중...' : '곡을 확인하고 준비를 눌러 주세요 · 다른 곡을 고르면 "이 곡 하자"로 추천할 수 있어요';
  }
  renderSongs();
}

/* ============================================================ 다른 사람 카드: 방·실시간 순위·친구 화면·결과에서 누르면
   그 사람이 쓰는 일러스트·캐릭터(표정)와 자주 하는 노래. 플레이 중에도 키 입력을 막지 않게 작은 창(바깥·ESC·✕로 닫힘) */
const plSeen = {};      // id → {id, name, title, avatar} (방을 나간 뒤 결과 화면에서도 쓰게)
function plRemember(p) { if (p && p.id) plSeen[p.id] = { id: p.id, name: p.name, title: p.title || '', avatar: p.avatar, level: p.level || (plSeen[p.id] && plSeen[p.id].level) || 0, deco: p.deco || (plSeen[p.id] && plSeen[p.id].deco), medal: p.medal || 0 }; }
function plLookup(id) {
  const p = net.room && net.room.players.find((x) => String(x.id) === String(id));     // 방 번호표(id)는 숫자, 화면의 data-pl은 글자
  if (p) plRemember(p);
  return plSeen[id] || null;
}
let plReq = 0;
let plShown = null;     // 카드에 보이는 사람 (크게 보기용)
function plCardOpen() { return !$('#plCard').classList.contains('hidden'); }
function closePlCard() { $('#plCard').classList.add('hidden'); plReq++; }
function plFillChar(card, a) {
  const il = $('.pl-il', card), big = $('.pl-big', card), dot = $('.pl-dot', card), faces = $('.pl-faces', card);
  faces.innerHTML = '';
  big.classList.add('hidden'); big.removeAttribute('style');
  dot.classList.add('hidden');
  const url = aiIllustUrl(a);
  il.classList.add('hidden');
  if (url) { il.onload = () => il.classList.remove('hidden'); il.onerror = () => il.classList.add('hidden'); il.src = url; }
  else il.removeAttribute('src');
  if (a.ai && a.aiUse !== 'off') {
    const tok = a.ai, sk = new Image();
    sk.onload = () => {      // 스티커: 크게 + 표정 6개 (누르면 그 표정)
      const n = STK_EXPR.length, bg = `url('/avatars/${tok}_x.webp')`;
      big.classList.remove('hidden');
      Object.assign(big.style, { backgroundImage: bg, backgroundSize: `${n * 100}% 100%`, backgroundPosition: '0 0', aspectRatio: `${sk.width / n} / ${sk.height}` });
      const names = { idle: '기본', smile: '웃음', cheer: '신남', oops: '놀람', sad: '슬픔', blink: '깜빡' };
      faces.innerHTML = STK_EXPR.map((e, i) => `<span role="button" tabindex="0" class="pl-face${i ? '' : ' on'}" data-i="${i}" title="${names[e] || e}"
        style="background-image:${bg};background-size:${n * 100}% 100%;background-position:${(i / (n - 1)) * 100}% 0;aspect-ratio:${sk.width / n} / ${sk.height}"></span>`).join('');
    };
    sk.onerror = () => {     // 스티커가 없는 예전 AI 캐릭터 (도트)
      big.classList.remove('hidden');
      Object.assign(big.style, { backgroundImage: `url("/avatars/${tok}_p.png")`, backgroundSize: 'contain', backgroundPosition: 'center bottom', aspectRatio: '3 / 4', imageRendering: 'pixelated' });
    };
    sk.src = `/avatars/${tok}_x.webp`;
    return;
  }
  // 직접 꾸민 도트 캐릭터
  dot.classList.remove('hidden');
  const ctx = dot.getContext('2d');
  ctx.clearRect(0, 0, dot.width, dot.height);
  try { drawAvatar(ctx, avatarValid(a), { pose: 'idle' }, dot.width / 2, dot.height - 6, 4.4); } catch { /* 무시 */ }
}
function plSongsHtml(j) {
  if (!j.songs.length) return '<li class="muted pl-empty">아직 끝까지 한 곡이 없어요.</li>';
  return j.songs.map((r, i) => {
    const b = r.best, here = !!songById(r.id);
    return `<li class="${here ? 'can' : ''}" data-sid="${esc(r.id)}" title="${here ? '눌러서 이 곡 고르기' : ''}"><span class="pl-n">${i + 1}</span>`
      + `<span class="pl-t"><b>${esc(r.title)}</b><small>${esc(r.artist || '')}</small></span>`
      + `<span class="pl-p">${r.plays ? `${r.plays}번` : '기록 있음'}</span>`
      + `<span class="pl-b">${b ? `<span class="rk rank-${esc(rankFor(b))}">${esc(rankFor(b))}</span><small>${b.keys === 6 ? '6K' : '4K'} ${DIFF_EN[b.diff] || ''}</small>` : ''}</span></li>`;
  }).join('');
}
/* 프로필 카드: 최고 기록 (등급 → 별 → 난이도 순) */
function plBestsHtml(j) {
  const b = j.bests || [];
  if (!b.length) return '<li class="muted pl-empty">아직 남긴 기록이 없어요.</li>';
  return b.map((r, i) => {
    const here = !!songById(r.id), rk = r.rank || '';
    const tags = `${r.keys === 6 ? '6K' : '4K'} ${DIFF_EN[r.diff] || ''}${r.stars ? ` ★${(+r.stars).toFixed(1)}` : ''}${r.ai ? ' · AI' : ''}`;
    return `<li class="${here ? 'can' : ''}" data-sid="${esc(r.id)}" title="${here ? '눌러서 이 곡 고르기' : ''}"><span class="pl-n">${i + 1}</span>`
      + `<span class="pl-t"><b>${esc(r.title)}</b><small>${esc(tags)}</small></span>`
      + `<span class="pl-p">${Number.isFinite(+r.acc) ? (+r.acc).toFixed(2) + '%' : ''}${r.fc && rk !== 'MAX' ? ' <em class="pl-fc">FC</em>' : ''}</span>`
      + `<span class="pl-b"><span class="rk rank-${esc(rk)}">${esc(rk)}</span></span></li>`;
  }).join('');
}
/* 프로필 카드: Lv · 업적 · 등급 통계 · 대표 업적 */
function plStatsHtml(j, lv, ach) {
  const st = j.stats || {}, rk = st.ranks || {};
  const chips = [];
  if (lv > 0) chips.push(`<span class="pl-chip lv"><small>레벨</small><b>Lv ${lv}</b></span>`);
  if (ach && ach.n != null) chips.push(`<span class="pl-chip"><small>업적</small><b>🏆 ${ach.n}${ach.total ? `<i>/${ach.total}</i>` : ''}</b></span>`);
  chips.push(`<span class="pl-chip"><small>기록</small><b>${st.records || 0}<i>개</i></b></span>`);
  if (st.fc) chips.push(`<span class="pl-chip"><small>풀콤보</small><b>${st.fc}</b></span>`);
  const rows = ['MAX', 'SSS', 'SS', 'S'].filter((k) => rk[k]).map((k) => `<span class="pl-rk"><span class="rk rank-${k}">${k}</span>×${rk[k]}</span>`).join('');
  return `<div class="pl-chips">${chips.join('')}</div>${rows ? `<div class="pl-rks">${rows}</div>` : ''}`;
}
function plBadgesHtml(ids) {
  const list = (ids || []).map((id) => (typeof ACH_BY !== 'undefined' ? ACH_BY[id] : null)).filter(Boolean);
  if (!list.length) return '';
  return '<small class="muted">대표 업적</small>' + list.map((a) => `<span class="pl-badge${a.tier === 'legend' ? ' legend' : ''}" title="${esc(a.desc)}">${a.tier === 'legend' ? '👑' : '🏆'} ${esc(a.name)}</span>`).join('');
}
let plTab = 'best';
function plSetTab(t) {
  plTab = t;
  const card = $('#plCard');
  $$('.pl-tab', card).forEach((b) => b.classList.toggle('on', b.dataset.t === t));
  $('.pl-bests', card).classList.toggle('hidden', t !== 'best');
  $('.pl-freq', card).classList.toggle('hidden', t !== 'songs');
}
async function openPlCard(id, anchor) {
  const p = plLookup(id);
  if (!p) return;
  const card = $('#plCard'), a = avatarValid(p.avatar);
  plShown = { avatar: a, name: p.name };
  $('.pl-av', card).innerHTML = miniHtml(a, 34);
  paintMinis($('.pl-av', card));
  const mine = String(id) === String(net.id);
  const lv = mine && typeof myLevel === 'function' ? myLevel() : p.level;
  $('.pl-name', card).innerHTML = (typeof lvTag === 'function' ? lvTag(lv) : '') + nameDeco(mine && typeof myGrow !== 'undefined' && myGrow ? { ...p, deco: settings.deco || {}, medal: myGrow.medal } : p) + (mine ? ' <small>(나)</small>' : '');
  card.className = 'pl-card' + ((p.deco || {}).card ? ' ' + p.deco.card : '');
  $('.pl-grow', card).innerHTML = '';
  $('.pl-chal', card).classList.toggle('hidden', mine);
  $('.pl-chal', card).dataset.name = p.name;
  $('.pl-title', card).textContent = p.title || '';
  $('.pl-title', card).classList.toggle('hidden', !p.title);
  $('.pl-title', card).classList.toggle('legend', ptCls(p.title) !== 'ptitle');
  plFillChar(card, a);
  // 방장이면 같은 방의 다른 사람에게: 방장 넘기기 · 내보내기 (게임 중에는 못 함)
  const inRoom = net.room && net.room.players.some((x) => String(x.id) === String(id));
  const canLead = inRoom && net.isLeader() && String(id) !== String(net.id);
  $('.pl-acts', card).classList.toggle('hidden', !canLead);
  $('.pl-acts', card).dataset.id = id;
  $$('.pl-acts button', card).forEach((b) => { b.disabled = !!(net.room && net.room.phase !== 'lobby'); });
  const kb = $('.pl-kick', card);
  kb.classList.remove('sure');
  kb.textContent = '내보내기';
  $('.pl-sum', card).textContent = '';
  $('.pl-stats', card).innerHTML = '';
  $('.pl-badges', card).innerHTML = '';
  $$('.pl-songs', card).forEach((el) => { el.innerHTML = '<li class="muted pl-empty">불러오는 중...</li>'; });
  plSetTab(plTab);
  card.classList.remove('hidden');
  // 자리: 누른 줄 옆 (오른쪽 → 안 되면 왼쪽), 화면 밖으로 안 나가게
  const r = anchor.getBoundingClientRect(), w = card.offsetWidth, h = card.offsetHeight, vw = window.innerWidth, vh = window.innerHeight;
  let x = r.right + 10;
  if (x + w > vw - 8) x = r.left - w - 10;
  if (x < 8) x = Math.max(8, Math.min(vw - w - 8, r.left));
  const y = Math.max(8, Math.min(vh - h - 8, r.top - 20));
  card.style.left = `${Math.round(x)}px`;
  card.style.top = `${Math.round(y)}px`;
  const my = ++plReq;
  try {
    const res = await fetch(`/api/player/${encodeURIComponent(p.name)}`);
    const j = await res.json();
    if (my !== plReq) return;
    if (!res.ok) throw new Error(j.error || res.status);
    $('.pl-freq', card).innerHTML = plSongsHtml(j);
    $('.pl-bests', card).innerHTML = plBestsHtml(j);
    $('.pl-sum', card).textContent = j.totalPlays ? `지금까지 ${j.totalPlays}판 · ${j.songCount}곡` : j.songCount ? `${j.songCount}곡` : '';
    const pf = j.prof || {};
    const me = mine && typeof achSummary === 'function' ? achSummary() : null;     // 내 카드는 이 기기의 값 (가장 최신)
    const ach = me ? { n: me.ach, total: me.achTotal } : pf.ach != null ? { n: pf.ach, total: pf.achTotal || 0 } : null;
    const lv2 = lv || pf.lv || 0;
    if (lv2 && !lv) $('.pl-name', card).innerHTML = (typeof lvTag === 'function' ? lvTag(lv2) : '') + nameDeco(p);
    const gr = j.grow || {};
    if (gr.deco && gr.deco.card) card.classList.add(gr.deco.card);
    if (!p.deco && gr.deco) $('.pl-name', card).innerHTML = (typeof lvTag === 'function' ? lvTag(lv2) : '') + nameDeco({ ...p, deco: gr.deco, medal: gr.medal });
    const bits = [];
    if (gr.streak) bits.push(`<span class="pl-gchip">🔥 ${gr.streak}일 연속</span>`);
    if (gr.chal && (gr.chal.w || gr.chal.l)) bits.push(`<span class="pl-gchip">⚔️ 대결 ${gr.chal.w}승 ${gr.chal.l}패</span>`);
    if (gr.champ) bits.push(`<span class="pl-gchip gold">🏆 리그 우승 ${gr.champ}회</span>`);
    if (gr.medal) bits.push(`<span class="pl-gchip">${MEDALS[gr.medal]} 지난주 리그 ${gr.medal}위</span>`);
    $('.pl-grow', card).innerHTML = bits.join('');
    if (!p.title && pf.title) {      // 지금 접속 안 한 사람: 저장된 칭호
      $('.pl-title', card).textContent = pf.title;
      $('.pl-title', card).classList.remove('hidden');
      $('.pl-title', card).classList.toggle('legend', ptCls(pf.title) !== 'ptitle');
    }
    $('.pl-stats', card).innerHTML = plStatsHtml(j, lv2, ach);
    $('.pl-badges', card).innerHTML = plBadgesHtml(me ? me.achTop : pf.top);
    if (!(j.bests || []).length && j.songs.length && plTab === 'best') plSetTab('songs');
  } catch (e) {
    if (my === plReq) $$('.pl-songs', card).forEach((el) => { el.innerHTML = '<li class="muted pl-empty">기록을 불러오지 못했어요.</li>'; });
  }
  // 위치 다시 맞춤 (목록이 채워지며 길어졌을 때)
  const h2 = card.offsetHeight;
  card.style.top = `${Math.round(Math.max(8, Math.min(vh - h2 - 8, parseFloat(card.style.top))))}px`;
}
document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-pl]');
  if (t && !e.target.closest('#plCard') && !e.target.closest('button')) { e.stopPropagation(); openPlCard(t.dataset.pl, t); return; }   // 줄 안의 버튼(같이 하기 등)은 그 버튼 일을
  if (!plCardOpen() || e.target.closest('#plCard')) return;
  closePlCard();
}, true);
$('#plCard').addEventListener('click', (e) => {
  if (e.target.closest('.pl-x')) { closePlCard(); return; }
  const big = e.target.closest('.pl-il, .pl-big, .pl-dot');
  if (big && plShown) {        // 일러스트·캐릭터를 누르면 크게
    const on = $('#plCard .pl-face.on');
    openBigView(plShown.avatar, big.classList.contains('pl-il') ? 'il' : 'char', plShown.name, { face: on ? +on.dataset.i : 0 });
    return;
  }
  const f = e.target.closest('.pl-face');
  if (f) {
    const n = STK_EXPR.length;
    $$('#plCard .pl-face').forEach((x) => x.classList.toggle('on', x === f));
    $('#plCard .pl-big').style.backgroundPosition = `${(+f.dataset.i / (n - 1)) * 100}% 0`;
    return;
  }
  const give = e.target.closest('.pl-give'), kick = e.target.closest('.pl-kick');
  if (give || kick) {
    const id = +$('#plCard .pl-acts').dataset.id;
    if (kick && !kick.classList.contains('sure')) {      // 실수로 누르지 않게 한 번 더
      kick.classList.add('sure');
      kick.textContent = '정말 내보낼까요? 한 번 더 누르기';
      return;
    }
    net.send({ type: give ? 'giveLeader' : 'kick', id });
    closePlCard();
    return;
  }
  const tab = e.target.closest('.pl-tab');
  if (tab) { plSetTab(tab.dataset.t); return; }
  const li = e.target.closest('.pl-songs li.can');
  if (li && currentScreen === 'lobby') { select(li.dataset.sid); closePlCard(); }
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && plCardOpen()) { e.stopPropagation(); e.preventDefault(); closePlCard(); } }, true);

/* 곡 추천: 채팅에 카드로 — 방장은 '이 곡으로'를 누르면 바로 바뀌고, 다른 사람은 '보기'로 그 곡을 열어 봄 */
function addSuggest(m) {
  const log = $('#chatLog');
  const div = document.createElement('div');
  div.className = 'sug';
  const mine = m.id === net.id;
  div.innerHTML = `🎵 <b>${esc(m.name)}</b> 님 추천 <span class="sug-t">${esc(m.title)}</span>`
    + (songById(m.songId) && !mine ? ` <button type="button" class="small-btn sug-go${net.isLeader() ? ' primary' : ''}" data-sid="${esc(m.songId)}">${net.isLeader() ? '이 곡으로' : '보기'}</button>` : '');
  log.appendChild(div);
  while (log.children.length > 100) log.firstChild.remove();
  log.scrollTop = log.scrollHeight;
  if (net.isLeader() && !mine) sfx.tick(0.18, 1200);
}
$('#chatLog').addEventListener('click', (e) => {
  const b = e.target.closest('.sug-go');
  if (!b || !songById(b.dataset.sid)) return;
  if (currentScreen === 'lobby') select(b.dataset.sid);
  if (net.isLeader() && net.room && net.room.phase === 'lobby') {
    const s = songById(b.dataset.sid);
    net.send({ type: 'select', songId: s.id, diff: settings.diff, keys: settings.mode, ai: soloPick(s) });
  }
});

/* ============================================================ 오늘의 곡: 날마다 한 곡·난이도, 그날의 순위 */
let dailyTimer = 0;
function fmtLeft(sec) {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
  return h ? `${h}시간 ${m}분` : `${m}분`;
}
async function loadDaily() {
  try {
    const r = await fetch('/api/daily');
    const j = await r.json();
    if (!r.ok || !j.songId) { daily = null; renderDaily(); return null; }
    j.loadedAt = Date.now();
    daily = j;
  } catch { /* 무시 */ }
  renderDaily();
  return daily;
}
function dailyLeft() { return daily ? Math.max(0, daily.endsIn - (Date.now() - daily.loadedAt) / 1000) : 0; }
function renderDaily() {
  const bar = $('#dailyBar');
  if (!bar) return;
  const s = daily && songById(daily.songId);
  bar.classList.toggle('hidden', !s);
  if (!s) return;
  $('#dbTitle').textContent = s.title;
  $('#dbArtist').textContent = artistOf(s);
  $('#dbDiff').textContent = `4K ${DIFF_EN[daily.diff] || ''}`;
  $('#dbDiff').className = `tag diff-${daily.diff}`;
  const nick = (settings.nick || '').trim();
  const b = daily.board || [];
  const mi = b.findIndex((e) => e.name === nick);
  const top = b[0];
  $('#dbTop').innerHTML = top ? `1위 <b>${esc(top.name)}</b> ${top.score.toLocaleString()}${mi >= 0 ? ` · 나 <b>${mi + 1}위</b>` : ''} · ${b.length}명 도전` : '아직 아무도 도전하지 않았어요 — 첫 1위가 되어 보세요!';
  $('#dbLeft').textContent = `남은 시간 ${fmtLeft(dailyLeft())}`;
  if ($('#dailyMenu') && !$('#dailyMenu').classList.contains('hidden')) renderDailyMenu();
}
function renderDailyMenu() {
  const s = daily && songById(daily.songId);
  if (!s) return;
  const nick = (settings.nick || '').trim();
  $('#dmSum').textContent = `${(daily.board || []).length}명 · 남은 시간 ${fmtLeft(dailyLeft())}`;
  $('#dmSong').innerHTML = `${esc(s.title)} <small>${esc(artistOf(s))}</small> <span class="tag">4K ${DIFF_EN[daily.diff] || ''}</span>`;
  $('#dmList').innerHTML = (daily.board || []).map((e, i) => `<li class="${e.name === nick ? 'me' : ''}"><span class="dm-pos">${i + 1}</span><span class="dm-name">${esc(e.name)}${e.ai ? ' <small>AI</small>' : ''}</span>`
    + `<span class="dm-score">${e.score.toLocaleString()}</span><span class="dm-acc">${(+e.acc).toFixed(2)}%</span><span class="rk rank-${esc(rankFor(e))}">${esc(rankFor(e))}</span></li>`).join('')
    || '<li class="muted">아직 기록이 없어요.</li>';
  $('#dmPrev').textContent = daily.prev ? `어제의 1위: ${daily.prev.winner} · ${daily.prev.title} (${DIFF_NAME[daily.prev.diff] || ''}) ${daily.prev.score.toLocaleString()}점` : '';
}
$('#dbGo').addEventListener('click', () => {
  if (!daily) return;
  if (net.room && !net.isLeader()) { toast('방에 있을 땐 방장이 곡을 골라요. 방을 나가서 도전해 보세요.'); return; }
  if (settings.mode !== 4) setMode(4);
  if (settings.diff !== daily.diff) setDiff(daily.diff);
  if (!net.room && settings.hlMode) { settings.hlMode = false; saveSettings(); renderSongs(); }
  select(daily.songId);
  toast('오늘의 곡이에요! PLAY를 누르면 시작해요. (4키 · 전체곡 기록이 순위에 들어가요)', 2600);
});
$('#dbRank').addEventListener('click', (e) => {
  e.stopPropagation();
  const m = $('#dailyMenu');
  if (!m.classList.contains('hidden')) { m.classList.add('hidden'); return; }
  m.classList.remove('hidden');
  const r = $('#dbRank').getBoundingClientRect(), w = m.offsetWidth;
  m.style.top = `${Math.round(r.bottom + 6)}px`;
  m.style.left = `${Math.round(Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w)))}px`;
  renderDailyMenu();
  loadDaily();
});
$('#dmClose').addEventListener('click', () => $('#dailyMenu').classList.add('hidden'));
document.addEventListener('click', (e) => { if (!e.target.closest('#dailyMenu, #dbRank')) $('#dailyMenu').classList.add('hidden'); });
/* 오늘의 곡을 끝까지 했으면 순위를 다시 받아서 알려 줌 */
function isDailyPlay(g) { return !!(daily && g && g.song && g.song.id === daily.songId && g.diff === daily.diff && g.nl === 4 && !g.hl && !g.practice); }
async function afterDailyPlay(g, r) {
  if (!isDailyPlay(g) || r.incomplete) return;
  const d = await loadDaily();
  if (!d) return;
  const nick = (settings.nick || '').trim();
  const pos = (d.board || []).findIndex((e) => e.name === nick) + 1;
  if (pos) toast(`🎯 오늘의 곡 ${pos}위! (${d.board.length}명 중)`, 3000);
  if (typeof achieveOnDaily === 'function') achieveOnDaily(pos, d.day);
}
loadDaily();
dailyTimer = setInterval(() => { if (document.hidden) return; if (daily && dailyLeft() <= 0) loadDaily(); else renderDaily(); }, 60000);
setInterval(() => { if (!document.hidden) loadDaily(); }, 300000);

/* ============================================================ 지금 접속 중인 사람 */
const ON_KIND = { lobby: '로비', room: '방', multi: '멀티 플레이 중', watch: '구경 중', solo: '혼자 플레이 중', edit: '채보 편집 중', calib: '싱크 맞추는 중' };
let onTimer = 0;
function onMenuOpen() { return !$('#onMenu').classList.contains('hidden'); }
function closeOnMenu() { $('#onMenu').classList.add('hidden'); clearInterval(onTimer); }
function onStatusHtml(st) {
  const k = ON_KIND[st.kind] || '';
  if (st.kind === 'room') return `방 <b>${esc(st.room)}</b>${st.leader ? ' · 방장' : ''}${st.n ? ` · ${st.n}명` : ''}${st.song ? ` · ${esc(st.song)}` : ''}`;
  if (st.kind === 'multi' || st.kind === 'watch') return `${k} · 방 <b>${esc(st.room)}</b>${st.song ? ` · ${esc(st.song)}` : ''}`;
  return k + (st.song ? ` · ${esc(st.song)}` : '');
}
async function loadOnline() {
  try {
    const r = await fetch('/api/online');
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || r.status);
    $('#onCount').textContent = j.n;
    $('#onSum').textContent = `${j.n}명`;
    const myRoom = net.room && net.room.code;
    $('#onList').innerHTML = j.people.map((p) => {
      plRemember(p);
      const me = String(p.id) === String(net.id);
      const st = p.status || {};
      const can = !me && st.room && st.room !== myRoom;
      return `<li class="${me ? 'me' : ''}" data-pl="${esc(p.id)}">${miniHtml(p.avatar, 30)}<span class="on-who">`
        + `<span class="on-name">${typeof lvTag === 'function' ? lvTag(p.level) : ''}${p.title ? `<span class="${ptCls(p.title)}">${esc(p.title)}</span>` : ''}${nameDeco(p)}${me ? ' <small>(나)</small>' : ''}</span>`
        + `<span class="on-st on-${esc(st.kind || 'lobby')}">${onStatusHtml(st)}</span></span>`
        + (can ? `<button type="button" class="small-btn on-join" data-room="${esc(st.room)}">${st.kind === 'room' ? '같이 하기' : '구경하기'}</button>` : '')
        + '</li>';
    }).join('') || '<li class="muted">아무도 없어요.</li>';
    paintMinis($('#onList'));
  } catch (e) {
    $('#onList').innerHTML = `<li class="muted">불러오지 못했어요 (${esc(e.message)})</li>`;
  }
}
function openOnMenu() {
  const m = $('#onMenu'), r = $('#btnOnline').getBoundingClientRect();
  m.classList.remove('hidden');
  const w = m.offsetWidth;
  m.style.top = `${Math.round(r.bottom + 6)}px`;
  m.style.left = `${Math.round(Math.max(8, Math.min(window.innerWidth - w - 8, r.left)))}px`;
  loadOnline();
  clearInterval(onTimer);
  onTimer = setInterval(loadOnline, 5000);
}
$('#btnOnline').addEventListener('click', (e) => { e.stopPropagation(); if (onMenuOpen()) closeOnMenu(); else openOnMenu(); });
$('#onClose').addEventListener('click', closeOnMenu);
$('#onList').addEventListener('click', (e) => {
  const b = e.target.closest('.on-join');
  if (!b) return;
  e.stopPropagation();
  if (currentScreen === 'game' && game && game.phase === 'playing') { toast('지금 하는 곡이 끝난 뒤에 들어가 주세요.'); return; }
  net.send({ type: 'join', code: b.dataset.room });
  closeOnMenu();
  if (closePlCard) closePlCard();
  const tg = $('#listTabs [data-side="multi"]');
  if (tg && !tg.classList.contains('on') && currentScreen === 'lobby') tg.click();
});
document.addEventListener('click', (e) => {
  if (onMenuOpen() && !e.target.closest('#onMenu, #plCard, #bigView, #btnOnline')) closeOnMenu();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && onMenuOpen() && !plCardOpen()) { e.stopPropagation(); closeOnMenu(); } }, true);
net.on('online', (m) => { $('#onCount').textContent = m.n; if (onMenuOpen()) loadOnline(); });
// 혼자 하는 곡·편집 중을 서버에 알려 둠 ('접속 중' 목록에 보이게)
function onScreenChange(name) {
  const what = name === 'game' && game && !game.multi ? 'solo' : name === 'editor' ? 'edit' : name === 'calib' ? 'calib' : 'lobby';
  net.send({ type: 'activity', what, song: what === 'solo' && game ? game.song.title : what === 'edit' && editor && editor.song ? editor.song.title : '' });
}
net.on('status', (on) => { if (on) onScreenChange(currentScreen); });

/* ============================================================ 구경 (게임 중인 방에 들어왔을 때) */
const watch = { spec: null, peers: {}, game: 0 };
function watchBoard() {
  if (!net.room) return;
  const rows = net.room.players.map((p) => ({ id: p.id, name: p.name, avatar: p.avatar, diff: p.diff, keys: p.keys, ...(watch.peers[p.id] || { score: 0, combo: 0 }) }))
    .sort((a, b) => b.score - a.score);
  $('#wBoard').innerHTML = rows.map((r) => `<li data-pl="${esc(r.id)}"><span class="n">${miniHtml(r.avatar, 24)} ${esc(r.name)} <small class="ld">${r.keys || 4}K ${DIFF_EN[r.diff] || ''}</small></span><span class="s">${String(r.score).padStart(7, '0')}</span><span class="c">${r.combo}x</span></li>`).join('');
  paintMinis($('#wBoard'));
}
function stopWatch() {
  if (watch.spec) { watch.spec.destroy(); watch.spec = null; }
}
net.on('watch', async (m) => {
  stopWatch();
  watch.peers = {};
  watch.game = m.game;
  $('#wTitle').textContent = `구경 중 · ${m.songTitle || ''}`;
  $('#wNote').textContent = '게임이 끝나면 다음 판부터 같이 할 수 있어요.';
  $('#wBoardHead').textContent = '실시간 순위';
  $('#wBoard').innerHTML = '';
  if (!$('#watchDlg').open) $('#watchDlg').showModal();
  let song;
  try { song = await fetchSong(m.songId); } catch (e) { $('#wNote').textContent = `곡을 불러오지 못해서 순위만 보여요 (${e.message})`; watchBoard(); return; }
  if (watch.game !== m.game || !net.room) return;
  const fake = { song, hl: !!m.hl, practice: hlPractice(m.hl), ai: m.ai !== false && !aiHostOff(song) };
  try { watch.spec = new Spectator(fake, net.room.players, { box: '#wGrid', panel: '#wPanel', count: '#wCount' }); } catch (e) { console.warn('구경 화면 오류', e); }
  watchBoard();
});
$('#wClose').addEventListener('click', () => $('#watchDlg').close());
$('#btnWatch').addEventListener('click', () => { if (!$('#watchDlg').open) $('#watchDlg').showModal(); });

/* 칭호 뱃지: 전설 업적 칭호면 무지개빛 */
function ptCls(t) { return typeof achIsLegend === 'function' && achIsLegend(t) ? 'ptitle legend' : 'ptitle'; }

function addChat(m) {
  const log = $('#chatLog');
  const div = document.createElement('div');
  div.className = m.system ? 'sys' : '';
  div.innerHTML = m.system ? esc(m.text) : `<b>${esc(m.name)}</b> ${esc(m.text)}`;
  log.appendChild(div);
  while (log.children.length > 100) log.firstChild.remove();
  log.scrollTop = log.scrollHeight;
}

$('#btnCreate').addEventListener('click', () => {
  if (!net.open) { toast('서버에 연결 중이에요. 잠시 후 다시 시도해 주세요.'); return; }
  net.send({ type: 'create' });
});
$('#btnJoin').addEventListener('click', () => {
  const code = $('#joinCode').value.trim().toUpperCase();
  if (code.length !== 4) { toast('4글자 방 코드를 입력해 주세요.'); return; }
  net.send({ type: 'join', code });
});
$('#joinCode').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#btnJoin').click(); });
$('#btnLeave').addEventListener('click', () => { net.send({ type: 'leave' }); $('#chatLog').innerHTML = ''; });
$('#btnRoomStart').addEventListener('click', () => net.send({ type: 'start' }));
$('#btnRoomForce').addEventListener('click', () => net.send({ type: 'start', force: true }));
$('#btnReady').addEventListener('click', () => {
  const me = net.room && net.room.players.find((p) => p.id === net.id);
  net.send({ type: 'ready', on: !(me && me.ready) });
});
$('#chatInput').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || e.isComposing) return;
  const t = e.target.value.trim();
  if (t) net.send({ type: 'chat', text: t });
  e.target.value = '';
});

net.on('status', (ok) => {
  $('#connDot').classList.toggle('on', ok);
  $('#connDot').title = ok ? '서버 연결됨' : '서버 연결 끊김 — 다시 연결 중...';
});
net.on('room', () => {
  renderRoom();
  // 서버가 기억하는 내 난이도/키가 화면과 다르면 다시 알려줌 (게임 중에 바꾼 경우 등)
  const me = net.room && net.room.phase === 'lobby' && net.room.players.find((p) => p.id === net.id);
  if (me && (me.diff !== settings.diff || (me.keys || 4) !== settings.mode)) sendMyDiff();
  if (game && game.multi) {
    game.renderLive();
    if (game.spec) game.spec.sync(net.room ? net.room.players : []);
  }
  if (watch.spec && net.room) { watch.spec.sync(net.room.players); watchBoard(); }
  // 게임 화면 '친구 화면'에 구경하는 사람 수
  if (game && game.multi && net.room && (net.room.watchers || []).length) $('#specCount').textContent = `${game.spec ? game.spec.views.size : 0}명 · 👀 구경 ${net.room.watchers.length}명`;
});
net.on('rejoined', () => toast('방에 다시 들어왔어요.', 2200));
// 서버가 새 버전으로 바뀜 → 새로고침 알림 (방에 있었으면 새로고침해도 같은 방으로 돌아옴)
net.on('newver', () => {
  const b = $('#verBanner');
  if (b) b.classList.remove('hidden');
});
$('#verReload').addEventListener('click', () => location.reload());
$('#verLater').addEventListener('click', () => $('#verBanner').classList.add('hidden'));
net.on('left', (m) => {
  lastRoomSong = null;
  if (m && m.lost && net.lastRoom && currentScreen !== 'game') toast('서버와 다시 연결하는 중... 연결되면 방에 다시 들어가요.', 3500);
  stopWatch();
  if ($('#watchDlg').open) $('#watchDlg').close();
  renderRoom();
  if (m && m.kicked) toast('방장이 방에서 내보냈어요.', 3500);
  if (plCardOpen()) closePlCard();
  if (game && game.multi && game.phase !== 'ended') {
    game.destroy();
    game = null;
    showScreen('lobby');
    toast('방에서 나왔어요.');
  }
});
net.on('error', (m) => toast(m.msg, 3000));
net.on('chat', addChat);
net.on('suggest', addSuggest);

let prepareSeq = 0;
net.on('prepare', async (m) => {
  const token = ++prepareSeq;
  stopPreview();
  keyCapture = null;
  $$('dialog[open]').forEach((d) => d.close());
  if (editor) { editor.close(); editor = null; }
  if (calib) { calib.close(); calib = null; }
  if (game) game.destroy();
  pendingResults = null;
  let song;
  try { song = await fetchSong(m.songId); } catch (e) {
    if (token === prepareSeq) { toast(e.message); net.send({ type: 'loaded', error: true }); }
    return;
  }
  if (token !== prepareSeq || !net.room) return;   // 그사이 새 판이 시작됐거나 방을 나갔으면 버림
  if (game) game.destroy();
  const mAi = m.ai !== false && !aiHostOff(song) ? aiChartOf(song, m.diff, m.keys || 4) : null;   // 방: 방장이 곡마다 고른 대로
  const g = new Game({ song, diff: m.diff, keys: m.keys || 4, notes: mAi, multi: true, gameNo: m.game, onExit: backFromGame, practice: hlPractice(m.hl) });
  g.ai = !!mAi;
  game = g;
  setupGameScreen(g, true);
  try { g.spec = new Spectator(g, m.players || (net.room && net.room.players) || []);
    if (net.room) g.spec.sync(net.room.players); } catch (e) { console.warn('관전 화면 오류', e); }
  g.renderLive();
  try {
    await g.load();
    if (game !== g || g.phase !== 'ready') return;     // 불러오는 사이에 나갔으면 끝
    if (isTouch) await g.waitTap('준비되면 탭하세요');   // 폰은 탭을 받아야 소리가 나요
    if (game !== g || g.phase !== 'ready') return;
    if (g.pendingStart) startMulti(g, g.pendingStart);  // 이미 시작됐으면 바로 합류
    else net.send({ type: 'loaded' });
  } catch (e) {
    g.abort(e.message);
  }
});

function startMulti(g, at) {
  g.gotStart = true;
  const lead = (at - net.serverNow()) / 1000;
  g.begin(Math.max(2.0, lead));      // 늦게 합류해도 카운트인 세 번은 다 듣고 시작 (점수는 각자라 조금 늦어도 괜찮음)
}

net.on('start', (m) => {
  const g = game;
  if (!g || !g.multi || g.gameNo !== m.game) return;
  if (g.phase === 'ready' && !g.tapResolve) { hideOverlay(); startMulti(g, m.at); }
  else if (g.phase === 'loading' || g.phase === 'ready') g.pendingStart = m.at;   // 탭 대기 중이면 탭한 뒤 시작
});
net.on('progress', (m) => {
  if (watch.spec || $('#watchDlg').open) {
    watch.peers[m.id] = { score: m.score, combo: m.combo };
    if (watch.spec) watch.spec.onProgress(m);
    watchBoard();
  }
  if (!game || !game.multi) return;
  game.peers[m.id] = { score: m.score, combo: m.combo };
  if (game.spec) game.spec.onProgress(m);
});
net.on('results', (m) => {
  if (watch.spec || $('#watchDlg').open) {     // 구경하던 판이 끝남 → 최종 순위를 보여 주고, 이제 같이 함
    stopWatch();
    $('#wBoardHead').textContent = '최종 순위';
    $('#wNote').textContent = '판이 끝났어요! 이제 다음 판부터 같이 할 수 있어요. 준비를 눌러 주세요.';
    $('#wBoard').innerHTML = m.results.map((r) => `<li data-pl="${esc(r.id)}"><span class="n">${miniHtml(r.avatar, 24)} ${esc(r.name)}</span><span class="s">${(r.score || 0).toLocaleString()}</span><span class="c">${r.incomplete ? '포기' : esc(r.rank || '')}</span></li>`).join('');
    paintMinis($('#wBoard'));
    if (!$('#watchDlg').open) toast('구경하던 판이 끝났어요. 이제 같이 할 수 있어요!', 3000);
    return;
  }
  if (typeof achieveOnMulti === 'function') { try { achieveOnMulti(m); } catch { /* 무시 */ } }
  pendingResults = m;
  if (currentScreen === 'result' && lastResult && lastResult.g.multi) renderMultiResults(m);
});

/* ============================================================ 채보 수정 */
async function openEditor(id, diff, nl) {
  if (window.innerWidth < 820) { toast('채보 수정은 PC의 넓은 화면에서 해 주세요.'); return; }
  stopPreview();
  let song;
  try { song = await fetchSong(id); } catch (e) { toast(e.message); return; }
  if (editor) editor.close();
  editor = new Editor(song, diff, nl, () => {});
  editor.open();
}

function closeEditor() {
  if (!editor) return;
  if (editor.dirty && !confirm('저장하지 않은 변경 사항이 있어요. 그래도 나갈까요?')) return;
  editor.close();
  editor = null;
  showScreen('lobby');
  refreshSongs();
}

$('#edPlay').addEventListener('click', () => editor && editor.setPlaying(!editor.playing));
$('#edRec').addEventListener('click', () => editor && editor.toggleRec());
$('#edUndo').addEventListener('click', () => editor && editor.undo());
$('#edSave').addEventListener('click', () => editor && editor.save());
$('#edExit').addEventListener('click', closeEditor);
function edSwitch(diff, nl) {
  if (!editor) return false;
  if (editor.dirty && !confirm('저장하지 않은 변경 사항이 있어요. 버리고 바꿀까요?')) return false;
  editor.loadDiff(diff, nl);
  return true;
}
$('#edDiff').addEventListener('change', (e) => { if (!edSwitch(e.target.value, editor.nl)) e.target.value = editor.diff; });
$('#edKeys').addEventListener('change', (e) => { if (!edSwitch(editor.diff, +e.target.value)) e.target.value = String(editor.nl); });
$('#edSnap').addEventListener('change', (e) => { if (editor) editor.snap = +e.target.value; });
$('#edRate').addEventListener('change', (e) => {
  if (!editor) return;
  const wasPlaying = editor.playing;
  if (wasPlaying) editor.setPlaying(false);
  editor.rate = +e.target.value;
  if (wasPlaying) editor.setPlaying(true);
});
$('#edTick').addEventListener('change', (e) => { if (editor) editor.tickOn = e.target.value === '1'; });
$('#edBpm').addEventListener('change', (e) => {
  if (!editor) return;
  const v = parseFloat(e.target.value);
  if (v >= 30 && v <= 400) { editor.bpm = v; editor.dirty = true; editor.refreshPanel(); }
});
$('#edOffset').addEventListener('change', (e) => {
  if (!editor) return;
  const v = parseFloat(e.target.value);
  if (Number.isFinite(v)) { editor.offset = v; editor.dirty = true; editor.refreshPanel(); }
});
$('#edClear').addEventListener('click', () => {
  if (!editor || !confirm('이 난이도의 노트를 전부 지울까요? (저장 전까지는 되돌리기 가능)')) return;
  editor.pushUndo();
  editor.notes = [];
  editor.refreshPanel();
});
$('#edRegen').addEventListener('click', async () => {
  if (!editor || !confirm('자동 채보를 처음부터 다시 만들까요? 4키·6키 모든 난이도의 수정 내용이 사라져요.')) return;
  const id = editor.song.id;
  editor.dirty = false;
  closeEditor();
  addSong(true, id);
  toast('다시 만드는 중이에요. 곡 목록 위쪽에서 진행 상황을 볼 수 있어요.');
});
$('#edTest').addEventListener('click', async () => {
  if (!editor) return;
  editor.setPlaying(false);
  if (!editor.notes.length) { toast('노트가 없어요.'); return; }
  cancelAnimationFrame(editor.raf);
  editor.testing = true;
  const notes = editor.notes.map((n) => ({ ...n }));
  const song = { ...editor.song, bpm: editor.bpm, offset: editor.offset };
  if (editor.bpm !== editor.song.bpm || editor.offset !== editor.song.offset) song.beats = null;   // 박자를 고쳤으면 분석 박 위치 대신 BPM으로 마디선
  if (game) game.destroy();
  const g = new Game({ song, diff: editor.diff, keys: editor.nl, notes, onExit: backFromGame, mods: false });
  game = g;
  g.customNotes = notes;
  g.noLeadCut = true;            // 편집기 테스트: 곡 맨 앞 노트도 확인할 수 있게 빼지 않음
  setupGameScreen(g, false);
  try { await g.load(); if (g.phase === 'ready') g.begin(2); } catch (e) { g.abort(e.message); }
});

/* ============================================================ 싱크 맞추기 (박자 소리) */
function calNowShow() { $('#calNow').textContent = `${settings.offset > 0 ? '+' : ''}${settings.offset}ms`; }
function openCalib() {
  if ($('#settingsDlg').open) $('#settingsDlg').close();
  stopPreview();
  $('#calBpm').innerHTML = CAL_BPMS.map(([v, n]) => `<option value="${v}">${n}</option>`).join('');
  $('#calBpm').value = String(store.get('calBpm', 100));
  $('#calHide').checked = !!store.get('calHide', false);
  calNowShow();
  if (calib) calib.close();
  calib = new Calibrator();
  calib.render();
  showScreen('calib');
}
function closeCalib() {
  if (calib) { calib.close(); calib = null; }
  showScreen('lobby');
  renderSongs();
}
$('#btnCalib').addEventListener('click', openCalib);
$('#calBpm').addEventListener('change', (e) => { store.set('calBpm', +e.target.value); if (calib && calib.state === 'run') calib.start(); });
$('#calHide').addEventListener('change', (e) => store.set('calHide', e.target.checked));
$('#calStart').addEventListener('click', (e) => { e.currentTarget.blur(); if (calib) calib.start(); });   // 포커스가 남으면 Space가 버튼을 다시 누름
$('#calApply').addEventListener('click', () => {
  if (!calib) return;
  calib.apply();
  calNowShow();
  updateOffsetShow();
});
$('#calExit').addEventListener('click', closeCalib);

/* ============================================================ 설정 */
let keyCapture = null;   // { type: 'lane', m: 4|6, k: index } | { type: 'fn', name }
const fnLabel = (name) => keyLabel(settings.fnKeys[name]);
function renderKeysHelp() {
  $('#keysHelp').innerHTML = keysFor(settings.mode).map((k) => `<kbd>${esc(keyLabel(k))}</kbd>`).join('');
  $('#helpFn').innerHTML = `플레이 중 <kbd>${esc(fnLabel('syncDown'))}</kbd> <kbd>${esc(fnLabel('syncUp'))}</kbd> 싱크 · `
    + `<kbd>${esc(fnLabel('speedUp'))}</kbd> <kbd>${esc(fnLabel('speedDown'))}</kbd> 속도 · <kbd>${esc(fnLabel('pause'))}</kbd> 일시정지`;
  $('#gameHint').innerHTML = `${esc(fnLabel('pause'))} 일시정지 · <kbd>${esc(fnLabel('syncDown'))}</kbd>/<kbd>${esc(fnLabel('syncUp'))}</kbd> 싱크`
    + ` · <kbd>${esc(fnLabel('speedUp'))}</kbd>/<kbd>${esc(fnLabel('speedDown'))}</kbd> 속도`;
}
function renderKeySettings() {
  $$('.key-set').forEach((set) => {
    const m = +set.dataset.m;
    $$('button', set).forEach((b) => {
      const k = +b.dataset.k;
      const cap = keyCapture && keyCapture.type === 'lane' && keyCapture.m === m && keyCapture.k === k;
      b.textContent = cap ? '…' : keyLabel(keysFor(m)[k]);
      b.classList.toggle('capturing', !!cap);
    });
  });
  $('#fnGrid').innerHTML = Object.keys(DEFAULT_FN).map((name) => {
    const cap = keyCapture && keyCapture.type === 'fn' && keyCapture.name === name;
    return `<label>${FN_NAMES[name]}<button type="button" class="fn-key${cap ? ' capturing' : ''}" data-fn="${name}">${cap ? '…' : esc(fnLabel(name))}</button></label>`;
  }).join('');
}
/* 키를 바꾸고, 같은 때 쓰이는 다른 키와 겹치면 서로 맞바꿈. 바뀐 내용을 문장으로 돌려줌 */
function keyLayoutOk() {
  for (const m of [4, 6]) {
    const all = [...keysFor(m), ...Object.values(settings.fnKeys)];
    if (new Set(all).size !== all.length) return false;
    if (keysFor(m).includes('Escape')) return false;
  }
  return true;
}
function assignKey(cap, code) {
  const backup = JSON.stringify([settings.keys, settings.keys6, settings.fnKeys]);
  const msg = assignKeyRaw(cap, code);
  if (!keyLayoutOk()) {
    const [k4, k6, fn] = JSON.parse(backup);
    settings.keys = k4; settings.keys6 = k6; settings.fnKeys = fn;
    saveSettings();
    return { error: `${keyLabel(code)} 키는 다른 기능과 겹쳐서 여기에 쓸 수 없어요. 먼저 그 기능의 키를 바꿔 주세요.` };
  }
  return msg;
}
function assignKeyRaw(cap, code) {
  const where = (c) => cap.type === 'lane' ? `${cap.m}키 ${cap.k + 1}번 레인` : FN_NAMES[cap.name];
  const old = cap.type === 'lane' ? keysFor(cap.m)[cap.k] : settings.fnKeys[cap.name];
  if (old === code) return '';
  const swaps = [];
  const modes = cap.type === 'lane' ? [cap.m] : [4, 6];
  for (const m of modes) {
    const keys = keysFor(m);
    const i = keys.indexOf(code);
    if (i >= 0 && !(cap.type === 'lane' && i === cap.k)) { keys[i] = old; swaps.push(`${m}키 ${i + 1}번 레인`); }
  }
  for (const name of Object.keys(settings.fnKeys)) {
    if (settings.fnKeys[name] === code && !(cap.type === 'fn' && cap.name === name)) { settings.fnKeys[name] = old; swaps.push(FN_NAMES[name]); }
  }
  if (cap.type === 'lane') keysFor(cap.m)[cap.k] = code; else settings.fnKeys[cap.name] = code;
  saveSettings();
  const msg = `${where()} → ${keyLabel(code)}`;
  return swaps.length ? `${msg} (이미 쓰던 ${swaps.join(', ')}에는 ${keyLabel(old)}를 넣었어요)` : msg;
}
function renderSettings() {
  renderKeySettings();
  $('#setSpeed').value = settings.speed;
  $('#speedVal').textContent = settings.speed;
  $('#setOffset').value = settings.offset;
  $('#offsetVal').textContent = (settings.offset > 0 ? '+' : '') + settings.offset;
  $('#setVol').value = settings.volume;
  $('#volVal').textContent = settings.volume;
  $('#setLane').value = String(settings.dim);
  $('#setAuto').value = settings.autoPreview === false ? '0' : '1';
  if (typeof renderHitSetting === 'function') renderHitSetting();
  renderKeysHelp();
}
function openSettings() {
  keyCapture = null;
  $('#keyHint').textContent = '바꿀 칸을 누른 뒤 원하는 키를 누르세요';
  $('#keyHint').className = 'muted small';
  renderSettings();
  if (!$('#settingsDlg').open) $('#settingsDlg').showModal();
}
$('#btnSettings').addEventListener('click', openSettings);
$('#btnKeyEdit').addEventListener('click', openSettings);
$('#keysHelp').addEventListener('click', openSettings);
$('#settingsDlg').addEventListener('close', () => { keyCapture = null; saveSettings(); renderSettings(); renderMods(); });
$$('.key-set').forEach((set) => set.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  b.blur();   // 스페이스/엔터를 키로 고를 때 버튼이 다시 눌리지 않게
  keyCapture = { type: 'lane', m: +set.dataset.m, k: +b.dataset.k };
  $('#keyHint').textContent = '원하는 키를 누르세요 (ESC: 취소)';
  $('#keyHint').className = 'small';
  renderKeySettings();
}));
$('#fnGrid').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-fn]');
  if (!b) return;
  e.preventDefault();
  b.blur();
  keyCapture = { type: 'fn', name: b.dataset.fn };
  $('#keyHint').textContent = '원하는 키를 누르세요 (ESC: 취소)';
  $('#keyHint').className = 'small';
  renderKeySettings();
});
$('#btnKeyReset').addEventListener('click', () => {
  settings.keys = [...DEFAULT_KEYS4];
  settings.keys6 = [...DEFAULT_KEYS6];
  settings.fnKeys = { ...DEFAULT_FN };
  keyCapture = null;
  saveSettings();
  $('#keyHint').textContent = '모든 키를 기본값으로 되돌렸어요.';
  $('#keyHint').className = 'small ok';
  renderSettings();
});
$('#setSpeed').addEventListener('input', (e) => { settings.speed = +e.target.value; renderSettings(); });
$('#setOffset').addEventListener('input', (e) => { settings.offset = +e.target.value; renderSettings(); updateOffsetShow(); });
$('#setVol').addEventListener('input', (e) => { settings.volume = +e.target.value; yt.volume(settings.volume); renderSettings(); });
$('#setLane').addEventListener('change', (e) => { settings.dim = +e.target.value; });
$('#setAuto').addEventListener('change', (e) => { settings.autoPreview = e.target.value === '1'; if (!settings.autoPreview) stopPreview(); });

$('#nick').value = settings.nick || '';
$('#nick').addEventListener('change', (e) => {
  settings.nick = e.target.value.trim().slice(0, 16);
  saveSettings();
  net.send(helloMsg());
  renderSongs();
});

/* ============================================================ 키 입력 */
function isTyping(e) {
  const t = e.target;
  return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');
}

window.addEventListener('keydown', (e) => {
  if (window.gateOpen) return;          // 시작·로그인 화면에서는 게임 단축키를 쓰지 않음
  if (keyCapture) {
    e.preventDefault();
    e.stopPropagation();
    const hint = $('#keyHint');
    if (e.code === 'Escape' || !e.code) {
      hint.textContent = '취소했어요.';
      hint.className = 'muted small';
    } else {
      const msg = assignKey(keyCapture, e.code);
      if (msg && msg.error) {
        hint.textContent = msg.error;
        hint.className = 'small warn';
      } else {
        hint.textContent = msg || '같은 키예요. 그대로 둘게요.';
        hint.className = 'small ok';
      }
    }
    justCaptured = e.code;
    keyCapture = null;
    renderSettings();
    return;
  }
  if (currentScreen === 'game' && game) {
    const lane = keysFor(game.nl).indexOf(e.code);
    if (lane >= 0) {
      e.preventDefault();
      if (!e.repeat && $('#gameOverlay').classList.contains('hidden')) game.keyDown(lane, e.timeStamp);
      return;
    }
    const fk = settings.fnKeys;
    if (e.code === 'Escape' || e.code === fk.pause) {
      e.preventDefault();
      if (e.repeat) return;
      if (!$('#gameOverlay').classList.contains('hidden')) {
        if (game.phase === 'paused') game.resume(); else if (game.phase !== 'ready') hideOverlay();
      } else game.pause();
      return;
    }
    const syncD = e.code === fk.syncDown || e.code === 'NumpadSubtract';
    const syncU = e.code === fk.syncUp || e.code === 'NumpadAdd';
    if (syncD || syncU) {
      e.preventDefault();
      settings.offset = clamp(settings.offset + (syncD ? -5 : 5), -300, 300);
      saveSettings();
      updateOffsetShow();
      toast(`싱크 ${settings.offset > 0 ? '+' : ''}${settings.offset}ms`, 900);
      return;
    }
    if (e.code === fk.speedUp || e.code === fk.speedDown) {
      e.preventDefault();
      settings.speed = clamp(+settings.speed + (e.code === fk.speedUp ? 0.5 : -0.5), 1, 10);
      saveSettings();
      toast(`노트 속도 ${settings.speed.toFixed(1)}`, 800);
      return;
    }
    if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
    return;
  }
  if (currentScreen === 'calib' && calib && !isTyping(e)) {
    if (e.code === 'Escape') { closeCalib(); return; }
    if (e.code === 'Space' || keysFor(4).includes(e.code) || keysFor(6).includes(e.code)) {
      e.preventDefault();
      if (!e.repeat) calib.tap(e.timeStamp);
    }
    return;
  }
  if (currentScreen === 'editor' && editor && !isTyping(e)) { editor.keyDown(e); return; }
  if (currentScreen === 'result' && e.code === 'Enter' && !isTyping(e) && !document.querySelector('dialog[open]')) {
    e.preventDefault();
    if (!e.repeat) $('#btnToLobby').click();
    return;
  }
  if (currentScreen === 'lobby' && !isTyping(e) && !document.querySelector('dialog[open]')) {
    const i = view.findIndex((s) => s.id === selId);
    if (e.code === 'ArrowDown' || e.code === 'ArrowUp') {
      e.preventDefault();
      if (!view.length) return;
      const ni = clamp((i < 0 ? 0 : i) + (e.code === 'ArrowDown' ? 1 : -1), 0, view.length - 1);
      select(view[ni].id);
    } else if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
      e.preventDefault();
      const di = DIFFS.indexOf(settings.diff);
      setDiff(DIFFS[clamp(di + (e.code === 'ArrowRight' ? 1 : -1), 0, DIFFS.length - 1)]);
    } else if (e.code === 'Tab') {
      e.preventDefault();
      setMode(settings.mode === 4 ? 6 : 4);
    } else if (e.code === 'Enter') {
      e.preventDefault();
      if (!e.repeat) playSelected();
    }
  }
});

let justCaptured = null;
window.addEventListener('keyup', (e) => {
  if (justCaptured && e.code === justCaptured) { e.preventDefault(); justCaptured = null; return; }
  if (currentScreen === 'game' && game) {
    const lane = keysFor(game.nl).indexOf(e.code);
    if (lane >= 0) game.keyUp(lane, e.timeStamp);
    return;
  }
  if (currentScreen === 'editor' && editor && !isTyping(e)) editor.keyUp(e);
});

/* 창 전환 시 눌린 키 정리 */
window.addEventListener('blur', () => {
  if (!game) return;
  if (game.touchMap) game.touchMap.clear();
  for (let l = 0; l < game.nl; l++) if (game.pressed[l]) game.keyUp(l, performance.now());
});

/* 버튼·목록을 마우스로 누른 뒤 포커스가 남아 있으면, 스페이스/엔터/방향키가 그 버튼·목록을 다시 건드림 → 포커스 해제
   (예: 에디터에서 ▶재생 버튼을 누르고 Space로 멈추면 버튼이 다시 눌려 재생되던 문제) */
document.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (b && !b.closest('dialog') && e.detail > 0) b.blur();   // e.detail>0: 실제 마우스/터치 클릭만
});
document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.closest('dialog')) return;
  if (t.tagName === 'SELECT' || (t.tagName === 'INPUT' && t.type === 'number')) t.blur();
});

/* ============================================================ 시작 */
(async function boot() {
  document.body.classList.toggle('touch', isTouch);
  $('#sortSel').value = settings.sort || 'new';
  renderSettings();
  yt.init();
  net.connect();
  try { const w = await api('/whoami'); isHost = !!w.host; isCloud = !!w.cloud; } catch { isHost = false; }
  loadAvRequests();
  $('#pcBox').classList.toggle('hidden', !(isHost && isCloud));
  $('#hostKeyRow').classList.toggle('hidden', !isCloud || isHost);
  $('#dlDesktop').classList.toggle('hidden', !isCloud || !!window.lbDesktop || isTouch);
  if (isHost && isCloud) { loadJobs(); setInterval(loadJobs, 10000); }
  if (window.lbDesktop && isHost && isCloud) {
    $('#btnImport').classList.remove('hidden');
    window.lbDesktop.onEngine((st) => { engineState = st; renderJobs(); });
  }
  if (typeof renderProfileUi === 'function') renderProfileUi();
  loadBatch();
  $('#addBox').classList.toggle('hidden', !isHost);
  $('#reqBox').classList.toggle('hidden', isHost);
  renderMods();
  loadRequests();
  await refreshSongs();
  setInterval(() => { if (currentScreen === 'lobby' && !addBusy && !document.querySelector('dialog[open]')) refreshSongs(); }, 15000);
})();

/* ============================================================ 전체 채보 다시 만들기 (방장) */
let batchWasRunning = false;
function renderBatch(b) {
  if (!b || !isHost) return;
  const bar = $('#batchBar');
  bar.classList.toggle('hidden', !b.running);
  $('#btnBatch').disabled = !!b.running;
  if (b.running) {
    const pct = b.total ? Math.round((b.done / b.total) * 100) : 0;
    $('#bbFill').style.width = pct + '%';
    $('#bbText').textContent = b.cancel ? `멈추는 중... (지금 곡까지만 끝내요)` : `${b.done + 1 > b.total ? b.total : b.done + 1}/${b.total} · ${b.current || '준비 중'}`;
    $('#btnBatchStop').disabled = !!b.cancel;
    $('#batchInfo').textContent = '';
    batchWasRunning = true;
  } else if (b.finished) {
    const fail = b.failed || [];
    const failN = b.failedCount ?? fail.length;
    const info = $('#batchInfo');
    info.textContent = `마지막 전체 다시 만들기: ${b.ok}곡 완료${failN ? ` · ${failN}곡 건너뜀` : ''}${b.cancel ? ' (중간에 멈춤)' : ''}`;
    info.classList.toggle('err', failN > 0);
    info.title = fail.map((f) => `${f.title}: ${f.msg}`).join('\n');
    if (batchWasRunning) {
      batchWasRunning = false;
      toast(`전체 채보 다시 만들기 끝! ${b.ok}곡 완료${failN ? `, ${failN}곡은 받을 수 없어 기존 채보를 유지했어요` : ''}.`, 4500);
      refreshSongs();
    }
  }
}
net.on('batch', (m) => renderBatch(m.batch));
net.on('status', (ok) => { if (ok) loadBatch(); });   // 다시 연결되면 진행 상태를 새로 받음 (놓친 알림·서버 재시작 대비)
async function loadBatch() {
  if (!isHost) return;
  try { renderBatch(await api('/batch')); } catch { /* 무시 */ }
}
$('#btnBatch').addEventListener('click', () => {
  const n = songs.length;
  if (!n) { toast('다시 만들 곡이 없어요.'); return; }
  const min = Math.max(1, Math.round((n * 25) / 60));
  $('#bdEta').textContent = `${n}곡 · 약 ${min}분`;
  $('#batchDlg').showModal();
});
$('#bdCancel').addEventListener('click', () => $('#batchDlg').close());
$('#bdGo').addEventListener('click', async () => {
  $('#batchDlg').close();
  try {
    renderBatch(await api('/batch', { method: 'POST', body: { keepEdited: $('#bdKeep').checked } }));
    toast('전체 채보 다시 만들기를 시작했어요.');
  } catch (e) { toast(e.message, 3500); }
});
$('#btnBatchStop').addEventListener('click', async () => {
  try { renderBatch(await api('/batch', { method: 'DELETE' })); } catch (e) { toast(e.message); }
});

/* ============================================================ 곡 정보(제목·가수) 고치기 (방장) */
const ARTIST_SRC = { youtube: '유튜브 음악 정보', title: '영상 제목에서 추측', channel: '채널 이름에서 추측', manual: '직접 입력', '': '찾지 못함' };
$('#btnSongInfo').addEventListener('click', () => {
  const s = songById(selId);
  if (!s || !isHost) return;
  $('#siTitle').value = s.title;
  $('#siArtist').value = s.artist || '';   // 통일된 이름 (저장하면 같은 가수 곡 전부 이 이름으로)
  $('#siArtist').placeholder = s.channel || '가수 이름';
  siShift = +s.noteShift || 0;
  $('#siAiOff').checked = !!(s.ai && s.ai.off);
  $('.si-aioff').classList.toggle('hidden', !s.ai);
  $('#siShift').textContent = `${siShift > 0 ? '+' : ''}${siShift}ms`;
  $('#siInfo').textContent = `업로드 채널: ${s.channel || '-'} · 가수 정보: ${ARTIST_SRC[s.artistSrc || ''] || '-'}${s.artistRaw && s.artistRaw !== s.artist ? ` · 원래 표기: ${s.artistRaw}` : ''} · 여기서 고친 가수 이름은 같은 가수의 다른 곡에도 똑같이 적용돼요.`;
  $('#songInfoDlg').showModal();
  setTimeout(() => $('#siArtist').focus(), 30);
});
let siShift = 0;
$('#songInfoDlg').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-ns]');
  if (!b) return;
  siShift = Math.max(-150, Math.min(150, siShift + +b.dataset.ns));
  $('#siShift').textContent = `${siShift > 0 ? '+' : ''}${siShift}ms`;
});
$('#siCancel').addEventListener('click', () => $('#songInfoDlg').close());
async function saveSongInfo(body) {
  const s = songById(selId);
  if (!s) return;
  try {
    await api(`/songs/${s.id}`, { method: 'PATCH', body });
    $('#songInfoDlg').close();
    toast('곡 정보를 고쳤어요.');
    refreshSongs();
  } catch (e) { toast(e.message, 3500); }
}
$('#siSave').addEventListener('click', () => {
  const title = $('#siTitle').value.trim();
  if (!title) { toast('제목을 입력해 주세요.'); return; }
  const s0 = songById(selId);
  saveSongInfo({ title, artist: $('#siArtist').value.trim(), noteShift: siShift, ...(s0 && s0.ai ? { aiOff: $('#siAiOff').checked } : {}) });
});
$('#siAuto').addEventListener('click', () => saveSongInfo({ title: $('#siTitle').value.trim() || undefined, artist: '' }));
$('#siArtist').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) $('#siSave').click(); });

/* ============================================================ 화면 테마 */
function renderThemeRow() {
  const cur = (UI_THEMES.find((x) => x.id === settings.uiTheme) || UI_THEMES[0]).id;
  $('#themeRow').innerHTML = UI_THEMES.map((t) => `<button type="button" data-t="${t.id}" class="${t.id === cur ? 'on' : ''}"><i style="background:${t.sw}"></i>${t.name}</button>`).join('');
  const t = UI_THEMES.find((x) => x.id === cur) || UI_THEMES[0];
  $('#btnTheme').title = `화면 테마: ${t.name} (눌러서 고르기)`;
  // 고르기 창: 작은 미리보기(바탕 · 칸 · 고른 줄 · 글자)
  for (const grid of document.querySelectorAll('#themeMenu .tm-grid')) {
    grid.innerHTML = UI_THEMES.filter((x) => x.g === grid.dataset.g).map((x) => {
      const [bg, p2, a1, a2, ink] = x.pv;
      return `<button type="button" role="menuitemradio" aria-checked="${x.id === cur}" class="tm-item${x.id === cur ? ' on' : ''}" data-t="${x.id}">`
        + `<span class="tm-prev" style="background:${bg};--p2:${p2};--a1:${a1};--a2:${a2}"><i></i><i></i><i></i><b style="color:${ink}">Aa</b></span>`
        + `<span class="tm-name">${x.name}</span></button>`;
    }).join('');
  }
}
function themeMenuOpen() { return !$('#themeMenu').classList.contains('hidden'); }
function closeThemeMenu() {
  $('#themeMenu').classList.add('hidden');
  $('#btnTheme').setAttribute('aria-expanded', 'false');
}
function openThemeMenu() {
  const m = $('#themeMenu'), r = $('#btnTheme').getBoundingClientRect();
  m.classList.remove('hidden');
  const w = m.offsetWidth;
  m.style.top = `${Math.round(r.bottom + 6)}px`;
  m.style.left = `${Math.round(Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w)))}px`;
  $('#btnTheme').setAttribute('aria-expanded', 'true');
  const on = m.querySelector('.tm-item.on');
  if (on) on.focus({ preventScroll: true });
}
function setUiTheme(id) {
  settings.uiTheme = id;
  saveSettings();
  applyUiTheme();
  renderThemeRow();
  if (typeof renderDetail === 'function') renderDetail();
}
$('#themeRow').addEventListener('click', (e) => { const b = e.target.closest('[data-t]'); if (b) setUiTheme(b.dataset.t); });
$('#btnTheme').addEventListener('click', (e) => {
  e.stopPropagation();
  if (themeMenuOpen()) closeThemeMenu(); else openThemeMenu();
});
// 고르면 바로 바뀌고 창은 열린 채로 (여러 개를 눌러 보며 고를 수 있게) — 바깥을 누르거나 ESC·✕로 닫음
$('#themeMenu').addEventListener('click', (e) => {
  e.stopPropagation();
  const b = e.target.closest('[data-t]');
  if (b) {
    setUiTheme(b.dataset.t);
    const on = $('#themeMenu').querySelector(`[data-t="${b.dataset.t}"]`);
    if (on) on.focus({ preventScroll: true });
  }
});
$('#tmClose').addEventListener('click', closeThemeMenu);
document.addEventListener('click', () => { if (themeMenuOpen()) closeThemeMenu(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && themeMenuOpen()) { e.stopPropagation(); closeThemeMenu(); } }, true);
window.addEventListener('resize', () => { if (themeMenuOpen()) closeThemeMenu(); });
renderThemeRow();
