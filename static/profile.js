/* 링크비트 프로필 — 이름·키 설정·꾸미기·캐릭터·싱크·내 기록을 방장 PC 서버에 백업해요.
   브라우저 저장소는 '접속 주소'마다 따로라서, 친구 초대 주소가 바뀌면 처음 상태가 돼요.
   아이디 + 숫자 비밀번호로 불러오면 어느 주소에서든 그대로 이어서 할 수 있어요. */
'use strict';

// 기기마다 다른 값(유튜브 시작 지연 등)과 로그인 정보는 프로필에 올리지 않음
const PROFILE_SKIP = new Set(['hostKey', 'profileTok', 'profileId', 'profileUpdated', 'profileLater', 'profileOwner', 'profileDirty', 'ytLag', 'autoLogin']);

const profile = {
  tok: store.get('profileTok', null),
  id: store.get('profileId', null),
  timer: 0,
  dirty: !!store.get('profileDirty', false),   // 못 보낸 변경 (새로고침해도 기억)
  saving: false,
  failed: false,
  lastSaved: 0,

  /* 브라우저에 저장된 링크비트 값들을 모음 (값은 JSON 문자열 그대로) */
  collect() {
    const out = {};
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k || !k.startsWith('lb_')) continue;
        const n = k.slice(3);
        if (!PROFILE_SKIP.has(n)) out[n] = localStorage.getItem(k);
      }
    } catch { /* 무시 */ }
    return out;
  },

  /* 서버 값을 브라우저에 씀. 기록(best_)은 더 높은 점수를 남김. 이 브라우저 쪽이 더 좋은 게 있었으면 true */
  apply(data) {
    let localWins = false;
    for (const [n, v] of Object.entries(data || {})) {
      if (PROFILE_SKIP.has(n) || typeof v !== 'string') continue;
      if (n.startsWith('best_')) {
        const mine = store.get(n, null);
        try { if (mine && JSON.parse(v).score < mine.score) { localWins = true; continue; } } catch { continue; }
      }
      try { localStorage.setItem('lb_' + n, v); } catch { /* 무시 */ }
    }
    return localWins;
  },

  /* 다른 사람의 프로필로 바꿀 때: 이 브라우저에 남은 이전 사람의 기록은 지움 (설정은 그대로) */
  clearRecordsIfOtherOwner(id) {
    const owner = store.get('profileOwner', null);
    if (owner && owner.toLowerCase() !== id.toLowerCase()) {
      try {
        const del = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && (k.startsWith('lb_best_') || k.startsWith('lb_practice_'))) del.push(k);
        }
        del.forEach((k) => localStorage.removeItem(k));
      } catch { /* 무시 */ }
    }
  },

  headers() {
    const h = { 'Content-Type': 'application/json' };
    if (this.tok) h['X-Profile-Token'] = this.tok;
    return h;
  },

  setDirty(v) { this.dirty = v; store.set('profileDirty', v); },

  setLogin(tok, id, updated) {
    this.tok = tok; this.id = id;
    store.set('profileTok', tok); store.set('profileId', id); store.set('profileUpdated', updated || 0);
    store.set('profileOwner', id);
    renderProfileUi();
  },

  forget() {
    this.tok = null; this.id = null;
    this.setDirty(false);
    try { ['profileTok', 'profileId', 'profileUpdated'].forEach((k) => localStorage.removeItem('lb_' + k)); } catch { /* 무시 */ }
    renderProfileUi();
  },

  /* 바뀐 게 있으면 잠시 모았다가 저장 (설정을 연달아 바꿔도 한 번만 보냄) */
  schedule() {
    if (!this.tok) return;
    this.setDirty(true);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.push(), 1500);
    renderProfileUi();
  },

  async push({ keepalive = false } = {}) {
    if (!this.tok) return false;
    if (this.saving && !keepalive) { this.setDirty(true); return false; }   // 보내는 중이면 끝난 뒤 한 번 더
    clearTimeout(this.timer);
    const body = JSON.stringify({ data: this.collect() });
    if (keepalive && body.length > 60000) keepalive = false;   // 창 닫을 때 보내기는 64KB 제한
    this.setDirty(false);
    this.saving = true;
    renderProfileUi();
    let ok = false;
    try {
      const r = await fetch('/api/profile', { method: 'PUT', headers: this.headers(), keepalive, body });
      const j = await r.json().catch(() => ({}));
      if (r.status === 401) { this.forget(); if (typeof gateRequireLogin === 'function') gateRequireLogin('로그인이 풀렸어요. 다시 로그인해 주세요.'); return false; }
      if (!r.ok) throw new Error(j.error || r.status);
      if (j.data && Object.keys(j.data).length) this.apply(j.data);   // 서버에 더 좋은 기록이 있으면 받아옴
      store.set('profileUpdated', j.updated || 0);
      this.lastSaved = Date.now();
      this.failed = false;
      ok = true;
      return true;
    } catch (e) {
      this.setDirty(true);
      this.failed = String(e.message || e);
      return false;
    } finally {
      this.saving = false;
      renderProfileUi();
      if (ok && this.dirty) this.schedule();   // 보내는 동안 또 바뀐 게 있으면 이어서 저장
    }
  },

  async login(id, pin, create) {
    const r = await fetch('/api/profile/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, pin, create }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `오류 (${r.status})`);
    this.clearRecordsIfOtherOwner(j.id);
    if (create || !j.data || !Object.keys(j.data).length) {
      // 새 프로필: 지금 이 브라우저의 설정(+본인 기록)이 프로필이 돼요
      this.setLogin(j.token, j.id, 0);
      await this.push();
      return { reload: create ? false : true, created: !!j.created };
    }
    window.__lbReloading = true;
    this.apply(j.data);
    this.setLogin(j.token, j.id, j.updated);
    await this.push();          // 이 브라우저에만 있던 더 좋은 기록도 합쳐서 올림
    return { reload: true, created: false };
  },

  /* 시작할 때: 서버에 더 새 값이 있으면(다른 주소·기기에서 플레이) 받아오고 새로고침 */
  async start() {
    if (!this.tok) return;
    try {
      const r = await fetch('/api/profile', { headers: this.headers() });
      if (r.status === 401) { this.forget(); if (typeof gateRequireLogin === 'function') gateRequireLogin('로그인이 풀렸어요. 다시 로그인해 주세요.'); return; }
      const j = await r.json();
      if (!r.ok) return;
      const mine = store.get('profileUpdated', 0);
      if ((j.updated || 0) > mine + 0.5 && sessionStorage.getItem('lb_profileReloaded') !== '1') {
        window.__lbReloading = true;
        if (this.apply(j.data)) store.set('profileDirty', true);   // 이 브라우저 기록이 더 좋으면 새로고침 뒤 올림
        store.set('profileUpdated', j.updated);
        sessionStorage.setItem('lb_profileReloaded', '1');
        location.reload();
        return;
      }
      sessionStorage.removeItem('lb_profileReloaded');
      if (this.dirty) this.push();
    } catch { /* 서버가 아직 안 켜졌으면 다음에 */ }
  },
};
function profileSync() { profile.schedule(); }

/* ---------------- 화면 */
function renderProfileUi() {
  const b = $('#btnProfile');
  if (!b) return;
  const on = !!profile.tok;
  b.classList.toggle('on', on);
  b.innerHTML = on ? `<span class="cloud ${profile.saving || profile.dirty ? 'busy' : ''}">☁</span>${esc(profile.id)}` : '<span class="cloud">☁</span>프로필';
  b.title = on ? (profile.failed ? `저장하지 못했어요: ${profile.failed}` : profile.dirty || profile.saving ? '저장 중...' : '서버에 저장됨') : '프로필을 만들면 주소가 바뀌어도 설정·기록이 유지돼요';
  b.classList.toggle('err', on && !!profile.failed);
  const host = (typeof isHost !== 'undefined' && isHost) || !!hostKey;
  const showBanner = false;   // 이제 시작할 때 로그인 화면에서 로그인하므로 안내 띠는 쓰지 않음
  $('#profileBanner').classList.toggle('hidden', !showBanner);
  if ($('#profileDlg').open) renderProfileDlg();
}

let profileMode = 'load';   // load | create
function renderProfileDlg() {
  const on = !!profile.tok;
  $('#pfOut').classList.toggle('hidden', on);
  $('#pfIn').classList.toggle('hidden', !on);
  if (on) {
    $('#pfWho').textContent = profile.id;
    $('#pfAuto').checked = store.get('autoLogin', true) !== false;
    $('#pfState').textContent = profile.saving || profile.dirty ? '저장 중...' : profile.lastSaved
      ? `마지막 저장 ${new Date(profile.lastSaved).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}` : '서버에 저장되어 있어요';
    return;
  }
  $$('#pfTabs button').forEach((x) => x.classList.toggle('on', x.dataset.m === profileMode));
  $('#pfGo').textContent = profileMode === 'create' ? '새 프로필 만들기' : '불러오기';
  $('#pfPinHint').textContent = profileMode === 'create'
    ? '숫자 4~8자리. 실제로 쓰는 비밀번호 말고 이 게임용 숫자를 정해 주세요.'
    : '프로필을 만들 때 정한 숫자예요.';
}
function openProfile(mode) {
  if (mode) profileMode = mode;
  $('#pfMsg').textContent = '';
  if (!$('#pfId').value) $('#pfId').value = profile.id || settings.nick || '';
  $('#pfPin').value = '';
  renderProfileDlg();
  $('#profileDlg').showModal();
  setTimeout(() => (profile.tok ? $('#pfClose') : $('#pfId').value ? $('#pfPin') : $('#pfId')).focus(), 30);
}

$('#btnProfile').addEventListener('click', () => openProfile());
$('#pfClose').addEventListener('click', () => $('#profileDlg').close());
$('#pfTabs').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-m]');
  if (b) { profileMode = b.dataset.m; $('#pfMsg').textContent = ''; renderProfileDlg(); }
});
$('#pfForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = $('#pfId').value.trim(), pin = $('#pfPin').value.trim();
  const msg = $('#pfMsg');
  if (!id) { msg.textContent = '아이디를 입력해 주세요.'; return; }
  if (!/^\d{4,8}$/.test(pin)) { msg.textContent = '비밀번호는 숫자 4~8자리예요.'; return; }
  $('#pfGo').disabled = true;
  msg.textContent = '';
  try {
    const r = await profile.login(id, pin, profileMode === 'create');
    if (r.reload) {
      toast('프로필을 불러왔어요!');
      sessionStorage.setItem('lb_profileReloaded', '1');
      setTimeout(() => location.reload(), 400);
      return;
    }
    $('#profileDlg').close();
    toast(r.created ? `프로필 '${id}'을(를) 만들었어요. 이제 자동으로 저장돼요.` : `'${id}'로 로그인했어요.`, 3000);
  } catch (err) {
    msg.textContent = err.message;
  } finally {
    $('#pfGo').disabled = false;
  }
});
$('#pfSave').addEventListener('click', async () => {
  toast((await profile.push()) ? '서버에 저장했어요.' : '저장하지 못했어요. 서버 연결을 확인해 주세요.');
});
$('#pfLogout').addEventListener('click', async () => {
  if (profile.dirty) await profile.push();
  try { await fetch('/api/profile/logout', { method: 'POST', headers: profile.headers() }); } catch { /* 무시 */ }
  profile.forget();
  $('#profileDlg').close();
  if (typeof gateRequireLogin === 'function') gateRequireLogin('로그아웃했어요. 다시 들어오려면 로그인해 주세요.');
});
$('#pfAuto').addEventListener('change', (e) => {
  store.set('autoLogin', e.target.checked);
  toast(e.target.checked ? '자동 로그인을 켰어요. 다음부터 시작 화면에서 바로 들어가요.' : '자동 로그인을 껐어요. 게임을 켤 때마다 로그인해요.', 3000);
});
$('#pbLoad').addEventListener('click', () => openProfile('load'));
$('#pbCreate').addEventListener('click', () => openProfile('create'));
$('#pbLater').addEventListener('click', () => { store.set('profileLater', true); renderProfileUi(); });

// 창을 닫기 직전에 못 보낸 변경이 있으면 보냄
window.addEventListener('pagehide', () => { if (profile.dirty) profile.push({ keepalive: true }); });
// 같은 브라우저의 다른 탭에서 로그인/로그아웃하면 이 탭도 새로고침 (예전 설정으로 덮어쓰지 않게)
window.addEventListener('storage', (e) => {
  if (e.key === 'lb_profileTok' && e.newValue !== e.oldValue && !(typeof game !== 'undefined' && game && game.phase === 'playing')) {
    window.__lbReloading = true;
    location.reload();
  }
});

renderProfileUi();
profile.start();
