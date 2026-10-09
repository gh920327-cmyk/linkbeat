/* 링크비트 꾸미기 창 + 실시간 미리보기 기어 */
'use strict';

class SkinPreview {
  constructor(cv) {
    this.cv = cv;
    this.nl = 4;
    this.raf = 0;
    this.reset();
  }
  reset() {
    this.t0 = performance.now();
    this.notes = [];
    this.nextNote = 0.6;
    this.seq = 0;
    this.combo = 0;
    this.comboPop = 0;
    this.popup = null;
    this.fx = fxNew(this.nl);
    this.pressed = new Array(this.nl).fill(false);
    this.holdUntil = new Array(this.nl).fill(-1);
    this.fever = 0;
  }
  setLanes(nl) { this.nl = nl; this.reset(); }
  start() {
    cancelAnimationFrame(this.raf);
    const step = () => { if (!this.running) return; this.frame(); this.raf = requestAnimationFrame(step); };
    this.running = true;
    this.raf = requestAnimationFrame(step);
  }
  stop() { this.running = false; cancelAnimationFrame(this.raf); }

  /* 정해진 패턴으로 노트를 만들고, 판정선에 닿으면 자동으로 '쳐서' 이펙트·판정·콤보를 보여줌 */
  spawn(t) {
    const pat4 = [0, 1, 2, 3, 2, 1, 0, 3, 1, 2];
    const pat6 = [0, 1, 2, 3, 4, 5, 4, 3, 2, 1, 0, 5];
    const pat = this.nl === 6 ? pat6 : pat4;
    while (this.nextNote < t + 2) {
      const i = this.seq++;
      const l = pat[i % pat.length];
      const hold = i % 9 === 4;
      this.notes.push({ t: this.nextNote, l, d: hold ? 0.6 : 0, hit: false });
      if (i % 16 === 15) {   // 드럼 강타 미리보기: 양손 동시치기
        this.notes[this.notes.length - 1].a = 1;
        this.notes.push({ t: this.nextNote, l: (l + Math.floor(this.nl / 2)) % this.nl, d: 0, a: 1, hit: false });
      } else if (i % 11 === 7) this.notes.push({ t: this.nextNote, l: (l + Math.floor(this.nl / 2)) % this.nl, d: 0, hit: false });
      this.nextNote += hold ? 0.5 : 0.28;
    }
  }
  frame() {
    const now = performance.now();
    const t = (now - this.t0) / 1000;
    this.spawn(t);
    const L = fitCanvas(this.cv, this.nl, { scale: settings.skin.laneScale, pos: settings.skin.gearPos });
    const { ctx, h, fieldW, x0 } = L;
    const judgeY = h - clamp(settings.skin.judgeY * (h / 700), 44, h * 0.45);
    const pps = 260;
    for (let l = 0; l < this.nl; l++) {
      const was = this.pressed[l];
      this.pressed[l] = t < this.holdUntil[l];
      if (was && !this.pressed[l]) this.fx.beamOff[l] = now;
    }
    // 자동 타격
    for (const n of this.notes) {
      if (!n.hit && n.t <= t) {
        n.hit = true;
        const r = (n.t * 7.3) % 1;
        const kind = r < 0.8 ? 'perfect' : 'great';
        const sub = kind === 'great' ? (r < 0.9 ? '빠름' : '느림') : '';
        this.popup = { kind, sub, at: now };
        this.combo++;
        this.comboPop = now;
        this.fever = Math.min(100, this.fever + 4);
        fxHit(this.fx, n.l, now);
        fxBurst(this.fx, n.l, kind, now);
        if (n.a) fxAccent(this.fx, n.l, kind, now);
        if (this.notes.some((m) => m !== n && m.t === n.t)) fxShake(this.fx, 2.2, now);
        if (this.combo % 50 === 0) fxMilestone(this.fx, this.combo, now);
        this.holdUntil[n.l] = n.t + Math.max(n.d, 0.07);
      }
    }
    this.notes = this.notes.filter((n) => n.t + n.d > t - 0.3);
    const o = fxOffset(this.fx, now);
    ctx.clearRect(0, 0, L.w, L.h);
    ctx.save();
    ctx.translate(o.dx, o.dy);
    drawLanes(L, judgeY, this.pressed, settings.dim);
    drawBeams(L, judgeY, this.pressed, this.fx, now);
    for (const n of this.notes) {
      const holding = n.hit && n.d > 0 && t < n.t + n.d;
      if (n.hit && !holding) continue;
      const yHead = holding ? judgeY : judgeY - (n.t - t) * pps;
      const yTail = n.d > 0 ? judgeY - (n.t + n.d - t) * pps : null;
      if (yTail === null && yHead < -20) continue;
      drawNote(L, n.l, yHead, yTail, holding ? 'hold' : 'live', n.a);
    }
    drawJudgeLine(L, judgeY, this.pressed);
    drawFx(L, judgeY, this.fx, now);
    for (let l = 0; l < this.nl; l++) if (this.pressed[l] && t < this.holdUntil[l] - 0.08) fxHoldSpark(this.fx, l, now);
    drawPunch(L, judgeY, this.fx, now);
    // 피버 게이지 + 연출
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(x0 + fieldW + 2, 10, 6, judgeY - 20);
    ctx.fillStyle = this.fever >= 100 ? C_GOLD : C_CYAN;
    const gh = (judgeY - 20) * this.fever / 100;
    ctx.fillRect(x0 + fieldW + 2, judgeY - 10 - gh, 6, gh);
    if (this.fever >= 100 && settings.skin.fever) {
      ctx.fillStyle = 'rgba(255,170,40,0.07)';
      ctx.fillRect(x0, 0, fieldW, judgeY);
      ctx.save();
      ctx.translate(x0 + fieldW / 2, 26);
      ctx.transform(1, 0, -0.18, 1, 0, 0);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `900 18px ${UI_FONT}`;
      ctx.fillStyle = C_GOLD;
      ctx.shadowColor = '#ff7a3d';
      ctx.shadowBlur = 14;
      ctx.fillText('FEVER x2', 0, 0);
      ctx.restore();
    }
    drawCombo(L, this.combo, this.comboPop, now);
    drawMilestone(L, this.fx, now);
    drawJudgePopup(L, this.popup, now);
    ctx.restore();
    if (this.combo > 400) this.reset();
  }
}

/* ---------------- 창 */
let skinPrev = null;
$('#hitSound').innerHTML = hitSoundOptions();

function renderSkin() {
  const sk = settings.skin;
  $('#themeSw').innerHTML = Object.entries(THEMES).map(([id, th]) => {
    const c = id === 'custom' ? sk.colors : th;
    return `<button class="sw${sk.theme === id ? ' on' : ''}" data-theme="${id}" title="${esc(th.name)}">
      <span class="chips"><i style="background:${c.a}"></i><i style="background:${c.b}"></i><i style="background:${c.c}"></i></span>${esc(th.name)}</button>`;
  }).join('');
  $('#customColors').classList.toggle('dim', sk.theme !== 'custom');
  $$('#customColors input').forEach((inp) => { inp.value = sk.colors[inp.dataset.c]; });
  $$('#noteShape button').forEach((b) => b.classList.toggle('on', b.dataset.v === sk.note));
  $('#noteH').value = sk.noteH; $('#noteHVal').textContent = sk.noteH;
  $('#laneScale').value = String(sk.laneScale);
  $('#gearPos').value = sk.gearPos;
  $('#lineSw').innerHTML = Object.entries(LINE_COLORS).map(([id, c]) =>
    `<button class="dot-sw${sk.line === id ? ' on' : ''}" data-line="${id}" style="--c:${c}" title="${id}"></button>`).join('');
  $('#judgeYIn').value = sk.judgeY; $('#judgeYVal').textContent = sk.judgeY;
  $$('#effectOpt button').forEach((b) => b.classList.toggle('on', b.dataset.v === sk.effect));
  $('#hitSound').value = sk.hitSound;
  $('#hitVol').value = sk.hitVol; $('#hitVolVal').textContent = sk.hitVol;
  $('#judgeText').value = sk.judgeText;
  $('#optEarly').checked = !!sk.earlyLate;
  $('#optCombo').checked = !!sk.combo;
  $('#optFever').checked = !!sk.fever;
  $('#optShake').checked = sk.shake !== false;
  $('#optChorus').checked = sk.chorusFx !== false;
  $('#optApplause').checked = sk.applause !== false;
  $$('#punchOpt button').forEach((b) => b.classList.toggle('on', b.dataset.v === (sk.punch || 'mid')));
}
function skinChanged() { saveSettings(); renderSkin(); }

function openSkin() {
  if ($('#settingsDlg').open) $('#settingsDlg').close();
  renderSkin();
  $('#skinDlg').showModal();
  if (!skinPrev) skinPrev = new SkinPreview($('#skinCanvas'));
  skinPrev.reset();
  skinPrev.start();
}
$('#btnSkin').addEventListener('click', openSkin);
$('#btnSkin2').addEventListener('click', openSkin);
$('#skinClose').addEventListener('click', () => $('#skinDlg').close());
$('#skinDlg').addEventListener('close', () => { if (skinPrev) skinPrev.stop(); saveSettings(); });

$('#skinPrevMode').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  $$('#skinPrevMode button').forEach((x) => x.classList.toggle('on', x === b));
  skinPrev.setLanes(+b.dataset.nl);
});
$('#themeSw').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-theme]');
  if (!b) return;
  const sk = settings.skin;
  if (b.dataset.theme === 'custom' && sk.theme !== 'custom' && THEMES[sk.theme]) {
    const t = THEMES[sk.theme];   // 지금 테마 색에서 시작
    sk.colors = { a: t.a, b: t.b, c: t.c };
  }
  sk.theme = b.dataset.theme;
  skinChanged();
});
$$('#customColors input').forEach((inp) => inp.addEventListener('input', () => {
  settings.skin.colors[inp.dataset.c] = inp.value;
  settings.skin.theme = 'custom';
  saveSettings();
  renderSkin();
}));
$('#noteShape').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-v]');
  if (b) { settings.skin.note = b.dataset.v; skinChanged(); }
});
$('#noteH').addEventListener('input', (e) => { settings.skin.noteH = +e.target.value; skinChanged(); });
$('#laneScale').addEventListener('change', (e) => { settings.skin.laneScale = +e.target.value; skinChanged(); });
$('#gearPos').addEventListener('change', (e) => { settings.skin.gearPos = e.target.value; skinChanged(); });
$('#lineSw').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-line]');
  if (b) { settings.skin.line = b.dataset.line; skinChanged(); }
});
$('#judgeYIn').addEventListener('input', (e) => { settings.skin.judgeY = +e.target.value; skinChanged(); });
$('#effectOpt').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-v]');
  if (b) { settings.skin.effect = b.dataset.v; skinChanged(); }
});
$('#hitSound').addEventListener('change', (e) => { settings.skin.hitSound = e.target.value; skinChanged(); sfx.hit(); });
$('#hitVol').addEventListener('input', (e) => { settings.skin.hitVol = +e.target.value; skinChanged(); });
$('#hitVol').addEventListener('change', () => sfx.hit());
$('#hitTest').addEventListener('click', () => {
  playHitDemo();
});
$('#judgeText').addEventListener('change', (e) => { settings.skin.judgeText = e.target.value; skinChanged(); });
$('#optEarly').addEventListener('change', (e) => { settings.skin.earlyLate = e.target.checked; skinChanged(); });
$('#optCombo').addEventListener('change', (e) => { settings.skin.combo = e.target.checked; skinChanged(); });
$('#optFever').addEventListener('change', (e) => { settings.skin.fever = e.target.checked; skinChanged(); });
$('#optShake').addEventListener('change', (e) => { settings.skin.shake = e.target.checked; skinChanged(); });
$('#optChorus').addEventListener('change', (e) => { settings.skin.chorusFx = e.target.checked; skinChanged(); });
$('#optApplause').addEventListener('change', (e) => { settings.skin.applause = e.target.checked; skinChanged(); if (!e.target.checked && sfx.clapStop) sfx.clapStop(); });
for (const [id, big] of [['#applauseTest', false], ['#applauseTestAp', true]]) {
  $(id).addEventListener('click', () => {
    if (settings.skin.applause === false) { toast('풀콤보 박수가 꺼져 있어요.'); return; }
    sfx.applause(big);
  });
}
$('#punchOpt').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-v]');
  if (b) { settings.skin.punch = b.dataset.v; skinChanged(); }
});
$('#skinReset').addEventListener('click', () => {
  settings.skin = JSON.parse(JSON.stringify(DEFAULT_SKIN));
  skinChanged();
  toast('꾸미기를 기본값으로 되돌렸어요.');
});

/* 타격음 미리듣기 (박자에 맞춰 4번) */
function playHitDemo() {
  if (settings.skin.hitSound === 'off') { toast('타격음이 꺼져 있어요. 종류를 먼저 골라 주세요.'); return; }
  [0, 180, 360, 540].forEach((ms) => setTimeout(() => sfx.hit(), ms));
}

/* 설정 창의 타격음 칸 (꾸미기 창과 같은 값을 써요) */
$('#setHit').innerHTML = hitSoundOptions();
function renderHitSetting() {
  $('#setHit').value = settings.skin.hitSound;
  $('#setHitVol').value = settings.skin.hitVol;
  $('#setHitVolVal').textContent = settings.skin.hitVol;
}
$('#setHit').addEventListener('change', (e) => { settings.skin.hitSound = e.target.value; saveSettings(); renderHitSetting(); sfx.hit(); });
$('#setHitVol').addEventListener('input', (e) => { settings.skin.hitVol = +e.target.value; saveSettings(); renderHitSetting(); });
$('#setHitVol').addEventListener('change', () => sfx.hit());
$('#setHitTest').addEventListener('click', playHitDemo);
