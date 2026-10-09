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
const starOf = (s, nl = settings.mode, diff = settings.diff) => ((s.stars || {})[nl] || {})[diff] || 0;
const countOf = (s, nl = settings.mode, diff = settings.diff) => ((nl === 6 ? s.counts6 : s.counts) || {})[diff] || 0;
/* 하이라이트 모드: 방에 있으면 방 설정(방장이 정함), 혼자면 내 설정 */
function hlActive() { return net.room ? !!net.room.hl : !!settings.hlMode; }
function hlPractice(h) { return h ? { start: h.start, from: h.from, end: h.end, rate: 1, loop: false, hl: true } : null; }
function boardOf(s, nl, diff, hl = hlActive()) {
  return (s.board || []).filter((e) => e.diff === diff && (e.keys || 4) === nl && !!e.hl === hl).sort((a, b) => b.score - a.score);
}
function myRecord(s, nl, diff, hl = hlActive()) {
  const nick = (settings.nick || '').trim();
  if (nick) {
    const e = boardOf(s, nl, diff, hl).find((x) => x.name === nick);
    if (e) return e;
  }
  return getBest(s.id, diff, nl, hl);
}

/* ============================================================ 곡 목록 */
/* 진짜 부른 가수 (모르면 업로드 채널) */
function artistOf(s) { return (s && (s.artist || s.channel)) || ''; }

function computeView() {
  const q = $('#search').value.trim().toLowerCase();
  const list = songs.filter((s) => !q || [s.title, artistOf(s), s.artistRaw, s.channel].some((x) => (x || '').toLowerCase().includes(q)));
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
  if (!view.length) {
    $('#songList').innerHTML = `<div class="empty">${songs.length ? '검색 결과가 없어요.' : isHost
      ? '아직 곡이 없어요.<br>위에 유튜브 링크를 붙여넣어 첫 곡을 만들어 보세요!'
      : '아직 곡이 없어요. 호스트가 곡을 추가하면 여기에 나타나요.'}</div>`;
  } else {
    $('#songList').innerHTML = view.map((s) => {
      const rec = myRecord(s, nl, settings.diff);
      const pips = DIFFS.map((d) => {
        const v = starOf(s, nl, d);
        return `<span class="mini ${starClass(v)} ${d === settings.diff ? 'on' : ''}" title="${DIFF_NAME[d]} ★${v.toFixed(1)}">${v.toFixed(1)}</span>`;
      }).join('');
      const roomSel = net.room && net.room.songId === s.id ? ' roomsel' : '';
      return `<div class="row${s.id === selId ? ' sel' : ''}${roomSel}" data-id="${s.id}">
        <img class="row-thumb" src="https://i.ytimg.com/vi/${s.id}/default.jpg" alt="" loading="lazy">
        <div class="row-info"><div class="row-title">${esc(s.title)}</div><div class="row-artist">${esc(artistOf(s))}</div></div>
        <div class="row-stars">${pips}</div>
        <div class="row-rank">${rec ? `<b class="rank-${esc(rec.rank)}">${esc(rec.rank)}</b>` : ''}</div>
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
  if (!s) {
    $('#dJacket').removeAttribute('src');
    $('#dTitle').textContent = songs.length ? '곡을 선택하세요' : '곡을 추가해 주세요';
    $('#dArtist').textContent = '';
    $('#btnSongInfo').classList.add('hidden');
    ['#dBpm', '#dTime', '#dPlays', '#dTop', '#dMine'].forEach((k) => { $(k).textContent = '-'; });
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
  $('#dTop').innerHTML = top ? `${esc(top.name)} <em>${top.score.toLocaleString()}</em>` : '-';
  const mine = myRecord(s, nl, settings.diff);
  $('#dMine').innerHTML = mine ? `<span class="rank-${esc(mine.rank)}">${esc(mine.rank)}</span> <em>${mine.score.toLocaleString()}</em>${mine.fc ? ' <span class="fc">FC</span>' : ''}` : '-';
  const pb = $('#btnPlay');
  const hlOn = hlActive();
  if (inRoom) {
    pb.innerHTML = leader ? '이 곡으로<small>방에서 선택</small>' : '방장 선택<small>방장만 고를 수 있어요</small>';
    pb.disabled = !leader;
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
}
function renderMods() {
  $('#modMirror').classList.toggle('on', !!settings.mirror);
  $('#modRandom').classList.toggle('on', !!settings.random);
  $('#speedShow').textContent = (+settings.speed).toFixed(1);
  $('#speedKeys').textContent = `플레이 중 ${fnLabel('speedUp')} ${fnLabel('speedDown')}`;
}
$('#modMirror').addEventListener('click', () => { settings.mirror = !settings.mirror; saveSettings(); renderMods(); });
$('#modRandom').addEventListener('click', () => { settings.random = !settings.random; saveSettings(); renderMods(); });
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
$('#search').addEventListener('input', renderSongs);
$('#sortSel').addEventListener('change', (e) => { settings.sort = e.target.value; saveSettings(); renderSongs(); });

function playSelected() {
  const s = songById(selId);
  if (!s) return;
  if (net.room) {
    if (net.isLeader()) net.send({ type: 'select', songId: s.id, diff: settings.diff, keys: settings.mode });
    else toast('방장만 곡을 고를 수 있어요.');
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
      if (j.stage === 'done') toast(`'${j.title}' 곡이 추가됐어요!`, 3000);
      else if (j.stage === 'error') toast(`'${j.title}' 만들기 실패: ${j.msg}`, 5000);
    }
    jobSeen[j.id] = j.stage;
  }
  renderJobs();
}
const PC_ACTIVE = ['claimed', 'info', 'download', 'analyze', 'upload'];
function renderJobs() {
  if (!isHost || !isCloud) return;
  const w = pcJobs.worker || {};
  const jobs = pcJobs.jobs || [];
  const waiting = jobs.filter((j) => j.stage === 'waitpc').length;
  const working = jobs.some((j) => PC_ACTIVE.includes(j.stage));
  $('#pcDot').className = 'pc-dot' + (w.online ? (working ? ' work' : ' on') : '');
  let text;
  if (w.online) text = `채보 PC 연결됨${working ? ' · 만드는 중' : ''}${waiting ? ` · 대기 ${waiting}곡` : working ? '' : ' · 쉬는 중'}`;
  else if (engineState && engineState.state !== 'ready') text = `채보 엔진: ${engineState.msg || '준비 중...'}`;
  else text = `채보 PC 꺼짐${waiting ? ` · 대기 ${waiting}곡` : ''} — 호스트 PC에서 LINKBEAT 실행기를 켜면 만들어져요`;
  $('#pcText').textContent = text;
  $('#pcList').innerHTML = jobs.map((j) => {
    const live = j.stage === 'waitpc' || PC_ACTIVE.includes(j.stage);
    const msg = j.stage === 'done' ? '완료' : j.stage === 'canceled' ? '취소됨' : j.msg;
    return `<li class="${esc(j.stage)}"><span class="pt" title="${esc(j.title)}">${esc(j.title)}${j.by && j.by !== '호스트' ? ` <small class="muted">· ${esc(j.by)} 신청</small>` : ''}</span>
      <span class="pm" title="${esc(j.msg || '')}">${esc((msg || '').slice(0, 40))}</span>
      ${live ? `<button class="ghost small-btn" data-cancel="${esc(j.id)}" type="button">취소</button>` : ''}</li>`;
  }).join('');
}
$('#pcList').addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-cancel]');
  if (!b) return;
  b.disabled = true;
  try { await api('/jobs/' + b.dataset.cancel, { method: 'DELETE' }); loadJobs(); } catch (err) { toast(err.message); }
});
net.on('jobs', () => loadJobs());
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
  const n = requests.length;
  $('#reqCount').textContent = n;
  $('#reqCount').classList.toggle('hidden', !n);
  if (!n) { $('#reqList').innerHTML = `<li class="empty-req">${isHost ? '신청된 곡이 없어요.' : '신청된 곡이 없어요. 위에서 곡을 신청해 보세요!'}</li>`; return; }
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
net.on('songs', () => { if (currentScreen === 'lobby' && !addBusy) refreshSongs(); });

/* ============================================================ 플레이 */
async function fetchSong(id) { return api('/songs/' + id); }

let soloSeq = 0;
async function startSolo(id, diff, nl = 4, customNotes = null, practice = null) {
  const token = ++soloSeq;
  stopPreview();
  if (game) game.destroy();
  let song;
  try { song = await fetchSong(id); } catch (e) { toast(e.message); return; }
  if (token !== soloSeq) return;   // 그 사이에 다른 곡을 시작했으면 이건 버림
  stopPreview();
  if (game) game.destroy();
  if (practice && practice.hl && song._hl) practice = hlPractice(song._hl);   // 서버의 최신 구간으로
  const notes = customNotes || chartOf(song, diff, nl);
  if (!notes.length) { toast('이 난이도에는 노트가 없어요.'); return; }
  pendingResults = null;
  const g = new Game({ song, diff, keys: nl, notes, onExit: backFromGame, practice });
  game = g;
  g.customNotes = customNotes;
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
  const extra = [...g.modNames, g.hl ? 'HIGHLIGHT' : g.practice ? `연습 x${g.practice.rate}` : ''].filter(Boolean).join(' · ');
  $('#gMeta').innerHTML = `<span class="tag">${g.nl}KEY</span> ${DIFF_EN[g.diff]} ${starHtml(g.stars)} · BPM ${Math.round(g.song.bpm)} · ${fmtTime(g.song.duration)}${extra ? ` <br><span class="warn">${esc(extra)}</span>` : ''}`;
  $('#livePanel').classList.toggle('hidden', !multi);
  $('#screen-game').classList.toggle('multi', !!multi);
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
function showResult(g, r) {
  lastResult = { g, r };
  const isTest = !!(editor && editor.testing) || !!g.customNotes || (!!g.practice && !g.hl);
  const newLocal = !isTest && setBest(g.song.id, g.diff, g.nl, r, g.hl);
  const mods = (g.hl ? ' <span class="tag hl-tag">HIGHLIGHT</span>' : '') + (g.modNames.length ? ` <span class="warn">${g.modNames.join(' · ')}</span>` : '');
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
  $('#rBadge').textContent = r.incomplete ? '중도 포기' : r.counts.miss === 0 && r.counts.good === 0 && r.counts.great === 0 ? 'ALL PERFECT' : r.fc ? 'FULL COMBO' : '';
  $('#rBest').textContent = g.practice && !g.hl ? '연습 모드라 기록은 남지 않아요.' : isTest ? '테스트 플레이라 기록은 남지 않아요.' : newLocal ? (g.hl ? '하이라이트 최고 기록 갱신!' : '내 최고 기록 갱신!') : '';
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
  if (!isTest) {
    api('/scores', {
      method: 'POST',
      body: { songId: g.song.id, diff: g.diff, keys: g.nl, name: settings.nick || '이름없음', ...r, hl: g.hl },
    }).then((res) => {
      if (lastResult.g !== g || r.incomplete) return;
      const parts = [];
      if (res.newBest) parts.push('<b class="nb">NEW RECORD</b>');
      if (res.position) parts.push(`친구 순위 <b>${res.position}위</b> / ${res.total}명`);
      $('#rBest').innerHTML = parts.join(' · ') || $('#rBest').innerHTML;
    }).catch(() => {});
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

/* 결과 화면 캐릭터: 등급에 따라 환호 / 보통 / 아쉬움 */
let resultAvRaf = 0;
function startResultAvatar(r) {
  cancelAnimationFrame(resultAvRaf);
  const stage = new AvatarStage($('#rAvatar'));
  const good = !r.incomplete && (r.rank === 'SS' || r.rank === 'S');
  const bad = r.incomplete || r.rank === 'C' || r.rank === 'D';
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
  $('#rMultiList').innerHTML = m.results.map((r, i) =>
    `<li class="${r.id === net.id ? 'me' : ''}"><span class="pos">${i + 1}</span><span class="n">${miniHtml(avOf(r.id) || r.avatar, 24)} ${esc(r.name)}${r.diff ? ` <small class="ld"><span class="tag">${r.keys || 4}K</span> ${DIFF_EN[r.diff] || ''}</small>` : ''}</span>
      <span class="s">${(r.score || 0).toLocaleString()}</span><span class="a">${(r.acc || 0).toFixed(2)}%</span>
      <span class="rk rank-${esc(r.rank || '')}">${r.incomplete ? '포기' : esc(r.rank || '')}</span></li>`).join('');
  paintMinis($('#rMultiList'));
}

$('#btnRetry').addEventListener('click', () => {
  if (!lastResult) return;
  const g = lastResult.g;
  startSolo(g.song.id, g.diff, g.nl, g.customNotes, g.practice);
});
$('#btnResRank').addEventListener('click', () => lastResult && openRank(lastResult.g.song.id, lastResult.g.nl, lastResult.g.diff, lastResult.g.hl));
$('#btnToLobby').addEventListener('click', () => { game = null; backFromGame(); });

/* ============================================================ 순위표 */
const rankCtx = { id: null, mode: 4, diff: 'normal', hl: false, data: null };
async function openRank(id, mode, diff, hl = hlActive()) {
  Object.assign(rankCtx, { id, mode, diff, hl: !!hl, data: null });
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
  $$('#rankMode button').forEach((b) => b.classList.toggle('on', +b.dataset.mode === mode));
  $$('#rankHl button').forEach((b) => b.classList.toggle('on', (b.dataset.hl === '1') === hl));
  $$('#rankDiff button').forEach((b) => b.classList.toggle('on', b.dataset.diff === diff));
  if (!data) return;
  const s = songById(rankCtx.id);
  $('#rankPlays').innerHTML = `총 ${data.plays}회 플레이${s ? ` · ${mode}KEY ${DIFF_EN[diff]} ${starHtml(starOf(s, mode, diff))}` : ''}`;
  const rows = data.entries.filter((e) => e.diff === diff && (e.keys || 4) === mode && !!e.hl === hl).sort((a, b) => b.score - a.score);
  const nick = settings.nick || '';
  $('#rankList').innerHTML = rows.length ? rows.map((e, i) => {
    const d = new Date(e.at * 1000);
    return `<li class="${e.name === nick ? 'me' : ''}"><span class="pos">${i + 1}</span><span class="n">${esc(e.name)}</span>
      <span class="rk rank-${esc(e.rank)}">${esc(e.rank)}</span><span class="s">${e.score.toLocaleString()}</span>
      <span class="a">${e.acc.toFixed(2)}%${e.fc ? ' <b class="fc">FC</b>' : ''}</span>
      <span class="dt">${d.getMonth() + 1}/${d.getDate()}</span></li>`;
  }).join('') : '<li class="muted">아직 기록이 없어요. 첫 번째 주인공이 되어 보세요!</li>';
}
$('#rankMode').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { rankCtx.mode = +b.dataset.mode; renderRank(); } });
$('#rankDiff').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { rankCtx.diff = b.dataset.diff; renderRank(); } });
$('#rankHl').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { rankCtx.hl = b.dataset.hl === '1'; renderRank(); } });
$('#rankClose').addEventListener('click', () => $('#rankDlg').close());

/* ============================================================ 멀티 */
let lastRoomSong = null;
function renderRoom() {
  const r = net.room;
  $('#multiOut').classList.toggle('hidden', !!r);
  $('#multiIn').classList.toggle('hidden', !r);
  if (r) {
    $('#roomCode').textContent = r.code;
    const stateName = { idle: '', loading: '로딩', loaded: '준비', playing: '플레이 중', done: '완료', error: '오류' };
    const s = r.songId ? songById(r.songId) : null;
    $('#roomPlayers').innerHTML = r.players.map((p) => {
      const pk = p.keys === 6 ? 6 : 4, pd = p.diff || 'normal';
      const st = s ? ' ' + starHtml(starOf(s, pk, pd)) : '';
      return `<li class="${p.id === net.id ? 'me' : ''}">${miniHtml(p.avatar)}${p.id === r.leader ? '<span class="crown">👑</span>' : ''}<span class="pn">${esc(p.name)}</span>
        <span class="pdiff"><span class="tag">${pk}K</span> ${DIFF_EN[pd] || ''}${st}</span>
        <span class="muted small">${stateName[p.state] || ''}</span></li>`;
    }).join('');
    paintMinis($('#roomPlayers'));
    $('#roomSong').textContent = r.songId ? r.songTitle : '방장이 곡을 고르는 중...';
    $('#roomDiff').innerHTML = (r.songId ? `난이도·키는 각자 골라요 · 내 선택 <span class="tag">${settings.mode}KEY</span> ${DIFF_EN[settings.diff]} ${s ? starHtml(starOf(s, settings.mode, settings.diff)) : ''}` : '')
      + (r.hl ? `<div class="hl-note">★ 하이라이트 모드 — 후렴만 플레이${s && s.hl ? ` (${fmtTime(s.hl.from)}~${fmtTime(s.hl.end)})` : ''}</div>` : '');
    // 방장이 곡을 바꾸면 내 목록에서도 그 곡을 골라 별점을 바로 보여줌
    if (r.songId && r.songId !== lastRoomSong && !net.isLeader() && songById(r.songId) && currentScreen === 'lobby') {
      lastRoomSong = r.songId;      // 실제로 골라준 경우에만 기억 (결과 화면에 있을 땐 로비로 돌아올 때 다시 시도)
      select(r.songId, { auto: false });
    }
    const leader = net.isLeader();
    $('#btnRoomStart').classList.toggle('hidden', !leader);
    $('#btnRoomStart').disabled = !r.songId || r.phase !== 'lobby';
    $('#roomWait').classList.toggle('hidden', leader);
  }
  renderSongs();
}

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
});
net.on('left', () => {
  lastRoomSong = null;
  renderRoom();
  if (game && game.multi && game.phase !== 'ended') {
    game.destroy();
    game = null;
    showScreen('lobby');
    toast('방에서 나왔어요.');
  }
});
net.on('error', (m) => toast(m.msg, 3000));
net.on('chat', addChat);

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
  const g = new Game({ song, diff: m.diff, keys: m.keys || 4, multi: true, gameNo: m.game, onExit: backFromGame, practice: hlPractice(m.hl) });
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
  g.begin(Math.max(0.3, lead));
}

net.on('start', (m) => {
  const g = game;
  if (!g || !g.multi || g.gameNo !== m.game) return;
  if (g.phase === 'ready' && !g.tapResolve) { hideOverlay(); startMulti(g, m.at); }
  else if (g.phase === 'loading' || g.phase === 'ready') g.pendingStart = m.at;   // 탭 대기 중이면 탭한 뒤 시작
});
net.on('progress', (m) => {
  if (!game || !game.multi) return;
  game.peers[m.id] = { score: m.score, combo: m.combo };
  if (game.spec) game.spec.onProgress(m);
});
net.on('results', (m) => {
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
  setupGameScreen(g, false);
  try { await g.load(); if (g.phase === 'ready') g.begin(2); } catch (e) { g.abort(e.message); }
});

/* ============================================================ 싱크 자동 맞추기 */
function openCalib() {
  if (!songs.length) { toast('먼저 곡을 하나 추가해 주세요.'); return; }
  if ($('#settingsDlg').open) $('#settingsDlg').close();
  stopPreview();
  const last = store.get('calSong', selId);
  $('#calSong').innerHTML = songs.map((s) => `<option value="${s.id}">${esc(s.title)} (BPM ${Math.round(s.bpm)})</option>`).join('');
  if (songs.find((s) => s.id === last)) $('#calSong').value = last;
  $('#calNow').textContent = `${settings.offset > 0 ? '+' : ''}${settings.offset}ms`;
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
$('#calStart').addEventListener('click', () => {
  store.set('calSong', $('#calSong').value);
  if (calib) calib.start($('#calSong').value);
});
$('#calApply').addEventListener('click', () => {
  if (!calib) return;
  calib.apply();
  $('#calNow').textContent = `${settings.offset > 0 ? '+' : ''}${settings.offset}ms`;
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
  net.send({ type: 'hello', name: settings.nick, avatar: settings.avatar, diff: settings.diff, keys: settings.mode });
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
  $('#siInfo').textContent = `업로드 채널: ${s.channel || '-'} · 가수 정보: ${ARTIST_SRC[s.artistSrc || ''] || '-'}${s.artistRaw && s.artistRaw !== s.artist ? ` · 원래 표기: ${s.artistRaw}` : ''} · 여기서 고친 가수 이름은 같은 가수의 다른 곡에도 똑같이 적용돼요.`;
  $('#songInfoDlg').showModal();
  setTimeout(() => $('#siArtist').focus(), 30);
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
  saveSongInfo({ title, artist: $('#siArtist').value.trim() });
});
$('#siAuto').addEventListener('click', () => saveSongInfo({ title: $('#siTitle').value.trim() || undefined, artist: '' }));
$('#siArtist').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) $('#siSave').click(); });
