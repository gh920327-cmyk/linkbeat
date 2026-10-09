/* 링크비트 시작 화면 → 로그인 → 게임
   - 시작 화면: 노트가 떨어지는 배경 + 로고, 아무 키나 누르거나 클릭하면 시작
   - 로그인: 프로필(아이디 + 숫자 비밀번호)로 로그인해야 게임에 들어가요. 처음이면 '새로 만들기'
   - 이 창(탭)에서 이미 들어왔으면 새로고침해도 바로 게임으로 */
'use strict';

window.gateOpen = true;
const gateEl = $('#gate');
let gateStage = 'title';
let gateRaf = 0;
let gateMode = 'login';   // login | create

/* ---------------- 배경: 4개 레인에 노트가 떨어지고 판정선에서 터짐 (128 BPM) */
function gateBg() {
  const cv = $('#gateBg');
  const ctx = cv.getContext('2d');
  const BPM = 128, beat = 60 / BPM;
  const notes = [];
  let lastSpawn = -1, t0 = performance.now(), last = t0;
  const bursts = [];
  const rnd = (() => { let s = 7; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
  const step = (now) => {
    if (!window.gateOpen) { cancelAnimationFrame(gateRaf); return; }
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = window.innerWidth, H = window.innerHeight;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const t = (now - t0) / 1000;
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    ctx.clearRect(0, 0, W, H);
    // 원근감 있는 레인 (가운데 아래로 모임)
    const fw = Math.min(560, W * 0.42), cx = W / 2, judge = H * 0.86, top = H * 0.08;
    const lx = (lane, y) => { const k = 0.45 + 0.55 * ((y - top) / (judge - top)); return cx + (lane - 2) * (fw / 4) * k; };
    const ph = (t % beat) / beat, pulse = Math.exp(-ph * 6);
    for (let l = 0; l <= 4; l++) {
      ctx.strokeStyle = `rgba(120,170,255,${l % 4 === 0 ? 0.28 : 0.12})`;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(lx(l, top), top); ctx.lineTo(lx(l, judge + 40), judge + 40); ctx.stroke();
    }
    // 박자선
    for (let k = 0; k < 8; k++) {
      const y = judge - ((k + ph) / 8) * (judge - top);
      if (y < top) continue;
      ctx.fillStyle = `rgba(255,255,255,${0.04 + 0.04 * (1 - (judge - y) / (judge - top))})`;
      ctx.fillRect(lx(0, y), y, lx(4, y) - lx(0, y), 1);
    }
    // 노트 생성 (반박마다, 가끔 동시치기)
    const half = Math.floor(t / (beat / 2));
    if (half !== lastSpawn) {
      lastSpawn = half;
      if (rnd() < 0.8) {
        const lane = Math.floor(rnd() * 4);
        notes.push({ lane, at: t + 1.6 });
        if (half % 8 === 0) notes.push({ lane: (lane + 2) % 4, at: t + 1.6, a: 1 });
      }
    }
    const colors = ['#4de1ff', '#3f8cff', '#3f8cff', '#4de1ff'];
    for (let i = notes.length - 1; i >= 0; i--) {
      const n = notes[i];
      const p = 1 - (n.at - t) / 1.6;
      if (p >= 1) { bursts.push({ lane: n.lane, at: now, a: n.a }); notes.splice(i, 1); continue; }
      const y = top + (judge - top) * p * p * 0.15 + (judge - top) * p * 0.85;
      const k = 0.45 + 0.55 * ((y - top) / (judge - top));
      const x = lx(n.lane + 0.5, y), w = (fw / 4) * k * 0.82, h = 10 * k;
      ctx.shadowColor = n.a ? '#ffc83d' : colors[n.lane]; ctx.shadowBlur = 14 * k;
      ctx.fillStyle = n.a ? '#ffe28a' : colors[n.lane];
      ctx.globalAlpha = Math.min(1, p * 3);
      ctx.fillRect(x - w / 2, y - h / 2, w, h);
      ctx.globalAlpha = 1; ctx.shadowBlur = 0;
    }
    // 판정선 + 박자 맥박
    const g = ctx.createLinearGradient(lx(0, judge), 0, lx(4, judge), 0);
    g.addColorStop(0, 'rgba(255,200,61,0)'); g.addColorStop(0.5, `rgba(255,200,61,${0.55 + 0.4 * pulse})`); g.addColorStop(1, 'rgba(255,200,61,0)');
    ctx.fillStyle = g; ctx.fillRect(lx(0, judge) - 30, judge - 1.5, lx(4, judge) - lx(0, judge) + 60, 3);
    // 터짐
    for (let i = bursts.length - 1; i >= 0; i--) {
      const b = bursts[i], e = (now - b.at) / 380;
      if (e >= 1) { bursts.splice(i, 1); continue; }
      const x = lx(b.lane + 0.5, judge);
      const r = (fw / 4) * (0.3 + 0.9 * e) * (b.a ? 1.5 : 1);
      const rg = ctx.createRadialGradient(x, judge, 0, x, judge, r);
      rg.addColorStop(0, `rgba(255,240,200,${0.55 * (1 - e)})`); rg.addColorStop(1, 'rgba(255,240,200,0)');
      ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(x, judge, r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = `rgba(255,255,255,${0.25 * (1 - e)})`;
      ctx.fillRect(x - (fw / 8) * 0.9, judge - 220 * (1 - e), (fw / 4) * 0.9, 220 * (1 - e));
    }
    gateEl.style.setProperty('--pulse', pulse.toFixed(3));
    gateRaf = requestAnimationFrame(step);
  };
  gateRaf = requestAnimationFrame(step);
}

/* 시작할 때 '쾅' 하는 소리 (직접 합성) */
function gateSound() {
  const ctx = sfx.ensure();
  if (!ctx) return;
  const t = ctx.currentTime + 0.02;
  const vol = clamp((settings.volume ?? 80) / 100, 0, 1) * 0.35;
  const out = ctx.createGain(); out.gain.value = vol; out.connect(ctx.destination);
  for (const [f, d] of [[110, 0], [164.8, 0.004], [220, 0.008], [329.6, 0.012]]) {
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.setValueAtTime(400, t); lp.frequency.exponentialRampToValueAtTime(4200, t + 0.12); lp.frequency.exponentialRampToValueAtTime(600, t + 0.9);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t + d); g.gain.linearRampToValueAtTime(0.22, t + d + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.0);
    o.connect(lp).connect(g).connect(out); o.start(t + d); o.stop(t + 1.05);
  }
  const k = ctx.createOscillator(); k.type = 'sine';
  k.frequency.setValueAtTime(150, t); k.frequency.exponentialRampToValueAtTime(40, t + 0.25);
  const kg = ctx.createGain(); kg.gain.setValueAtTime(0.9, t); kg.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
  k.connect(kg).connect(out); k.start(t); k.stop(t + 0.32);
}

function gateShow(stage) {
  gateStage = stage;
  gateEl.dataset.stage = stage;
  if (stage === 'login') {
    renderGateLogin();
    setTimeout(() => ($('#gtId').value ? $('#gtPin') : $('#gtId')).focus(), 350);
  }
}
function renderGateLogin() {
  $$('#gtTabs button').forEach((b) => b.classList.toggle('on', b.dataset.m === gateMode));
  $('#gtGo').textContent = gateMode === 'create' ? '만들고 시작하기' : '로그인';
  $('#gtHint').textContent = gateMode === 'create'
    ? '처음이에요? 아이디와 이 게임용 숫자 비밀번호(4~8자리)를 정해 주세요. 실제로 쓰는 비밀번호는 쓰지 마세요.'
    : '아이디와 숫자 비밀번호로 로그인하면 이름·설정·기록이 어느 컴퓨터에서든 그대로 이어져요.';
}

async function gatePress() {
  if (gateStage !== 'title') return;
  gateStage = 'busy';
  gateSound();
  gateEl.classList.add('hit');
  setTimeout(() => gateEl.classList.remove('hit'), 500);
  // 이미 로그인한 프로필이 있으면 확인만 하고 바로 입장
  if (profile.tok) {
    try {
      const r = await fetch('/api/profile', { headers: profile.headers() });
      if (r.ok) { gateWelcome(profile.id); return; }
      if (r.status === 401) profile.forget();
    } catch { /* 서버 연결 실패 → 로그인 화면에서 다시 */ }
  }
  setTimeout(() => gateShow('login'), 260);
}

function gateWelcome(id) {
  $('#gtWelcome').textContent = `${id} 님, 환영해요!`;
  gateShow('welcome');
  setTimeout(gateEnter, 900);
}

function gateEnter() {
  try { sessionStorage.setItem('lb_entered', '1'); } catch { /* 무시 */ }
  if (profile.id && !(settings.nick || '').trim()) {
    settings.nick = profile.id;
    saveSettings();
    if ($('#nick')) $('#nick').value = profile.id;
  }
  gateEl.classList.add('out');
  window.gateOpen = false;
  setTimeout(() => { gateEl.classList.add('hidden'); gateEl.classList.remove('out'); cancelAnimationFrame(gateRaf); }, 450);
  if (typeof refreshSongs === 'function') refreshSongs();
}

/* 로그아웃하면 다시 로그인 화면으로 */
function gateRequireLogin(msg) {
  try { sessionStorage.removeItem('lb_entered'); } catch { /* 무시 */ }
  if (window.gateOpen && gateStage === 'login') return;
  window.gateOpen = true;
  gateEl.classList.remove('hidden', 'out');
  gateBg();
  gateShow('login');
  if (msg) $('#gtMsg').textContent = msg;
}

$('#gtTabs').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-m]');
  if (b) { gateMode = b.dataset.m; $('#gtMsg').textContent = ''; renderGateLogin(); }
});
$('#gtForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = $('#gtId').value.trim(), pin = $('#gtPin').value.trim();
  const msg = $('#gtMsg');
  if (!id) { msg.textContent = '아이디를 입력해 주세요.'; return; }
  if (/\s/.test(id)) { msg.textContent = '아이디에는 띄어쓰기를 넣을 수 없어요.'; return; }
  if (!/^\d{4,8}$/.test(pin)) { msg.textContent = '비밀번호는 숫자 4~8자리예요.'; return; }
  $('#gtGo').disabled = true;
  msg.textContent = '';
  try {
    const r = await profile.login(id, pin, gateMode === 'create');
    try { sessionStorage.setItem('lb_entered', '1'); } catch { /* 무시 */ }
    if (r.reload) {          // 서버에 저장된 내 설정·기록을 불러와서 새로고침 (바로 게임 화면으로)
      sessionStorage.setItem('lb_profileReloaded', '1');
      location.reload();
      return;
    }
    gateWelcome(id);
  } catch (err) {
    msg.textContent = err.message;
    if (/그런 아이디가 없어요/.test(err.message)) msg.textContent = '그런 아이디가 없어요. 처음이면 위의 "새로 만들기"를 눌러 주세요.';
  } finally {
    $('#gtGo').disabled = false;
  }
});
gateEl.addEventListener('pointerdown', (e) => { if (gateStage === 'title' && !e.target.closest('.gate-card')) gatePress(); });
window.addEventListener('keydown', (e) => {
  if (!window.gateOpen) return;
  if (gateStage === 'title' && !e.repeat && !['Tab', 'Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) { e.preventDefault(); gatePress(); }
}, true);

/* 시작 */
(function gateBoot() {
  $('#gtVer').textContent = window.lbDesktop ? 'PC' : '';
  let entered = false;
  try { entered = sessionStorage.getItem('lb_entered') === '1'; } catch { /* 무시 */ }
  if (entered && profile.tok) {           // 이 창에서 이미 들어온 상태 (새로고침 등)
    window.gateOpen = false;
    gateEl.classList.add('hidden');
    return;
  }
  if (profile.id) $('#gtId').value = profile.id;
  else if (settings.nick) $('#gtId').value = settings.nick;
  gateMode = profile.id || settings.nick ? 'login' : 'create';
  gateBg();
  gateShow('title');
})();
