/* 링크비트 멀티 관전 화면 — 다른 플레이어의 기어를 작게 보여줘요.
   각자 받은 곡 정보에서 그 사람의 난이도/키 채보를 꺼내고,
   서버가 중계하는 진행 정보(곡 위치·누른 레인·판정·레인 배치)로 움직임을 재현해요. */
'use strict';

const SPEC_PPS = 1.15;     // 미니 기어 높이 대비 초당 스크롤 (화면 높이의 115%/초)
const SPEC_LOOK = 0.75;    // 판정선 위로 보여줄 시간(초)

class Spectator {
  constructor(game, roster) {
    this.game = game;
    this.song = game.song;
    this.box = $('#specGrid');
    this.views = new Map();
    this.raf = 0;
    this.sync(roster || []);
    $('#specPanel').classList.remove('hidden');
    this.start();
  }

  /* 방 인원/상태가 바뀌면 카드를 맞춤 (나간 사람은 지움) */
  sync(players) {
    const others = players.filter((p) => p.id !== net.id);
    const ids = new Set(others.map((p) => p.id));
    for (const [id, v] of this.views) if (!ids.has(id)) { v.el.remove(); this.views.delete(id); }
    for (const p of others) {
      let v = this.views.get(p.id);
      if (!v) {
        v = this.makeView(p);
        this.views.set(p.id, v);
        this.box.appendChild(v.el);
      }
      v.name = p.name;
      if (p.state) v.state = p.state;
      if (p.avatar) v.avatar = p.avatar;
      this.renderHead(v);
    }
    this.box.className = 'spec-grid n' + Math.min(7, this.views.size);
    $('#specPanel').classList.toggle('hidden', !this.views.size);
    $('#specCount').textContent = this.views.size ? `${this.views.size}명` : '';
  }

  makeView(p) {
    const nl = p.keys === 6 ? 6 : 4;
    const diff = p.diff || 'normal';
    const pr = this.game.hl ? this.game.practice : null;   // 하이라이트 모드: 그 구간 노트만
    const notes = chartOf(this.song, diff, nl).map((n) => ({ t: +n.t, l: n.l | 0, d: +n.d || 0 }))
      .filter((n) => !pr || (n.t >= (pr.from ?? pr.start) - 0.001 && n.t <= pr.end))
      .sort((a, b) => a.t - b.t);
    const el = document.createElement('div');
    el.className = 'spec-card';
    el.innerHTML = `<div class="spec-head"><span class="spec-av"></span><span class="spec-name"></span></div>
      <div class="spec-sub"><span class="spec-diff"></span><span class="spec-score">0000000</span></div>
      <div class="spec-field"><canvas></canvas><div class="spec-state"></div></div>`;
    const stars = starRating(notes, nl);
    return {
      id: p.id, name: p.name, avatar: p.avatar, diff, nl, notes, el, stars,
      cv: $('canvas', el), from: 0,
      t: null, recvAt: 0, shownT: null, bits: 0, map: [...Array(nl).keys()],
      score: 0, combo: 0, comboAt: 0, fever: false, state: p.state || 'loading',
      flash: new Array(6).fill(0), flashKind: new Array(6).fill(0), last: null,
    };
  }

  renderHead(v) {
    const el = v.el;
    const av = $('.spec-av', el);
    const key = JSON.stringify(v.avatar || null);
    if (av.dataset.k !== key) {
      av.dataset.k = key;
      av.innerHTML = typeof miniHtml === 'function' ? miniHtml(v.avatar, 20) : '';
      if (typeof paintMinis === 'function') paintMinis(av);
    }
    $('.spec-name', el).textContent = v.name;
    $('.spec-diff', el).innerHTML = `<span class="tag">${v.nl}K</span> <span class="star ${starClass(v.stars)}">${DIFF_EN[v.diff] || v.diff}</span>`;
    const st = { loading: '불러오는 중', loaded: '준비 완료', error: '오류', done: 'FINISH' }[v.state] || '';
    $('.spec-state', el).textContent = st;
    el.classList.toggle('ended', v.state === 'done' || v.state === 'error');
  }

  onProgress(m) {
    const v = this.views.get(m.id);
    if (!v) return;
    const now = performance.now();
    if (typeof m.t === 'number') {
      v.t = m.t;
      v.recvAt = now;
      if (v.shownT === null) v.shownT = m.t;
    }
    v.bits = m.p | 0;
    if (Array.isArray(m.m) && m.m.length === v.nl) v.map = m.m;
    if (Array.isArray(m.h)) {
      for (const [lane, k] of m.h) {
        if (lane < v.nl) { v.flash[lane] = now; v.flashKind[lane] = k; }
        v.last = { k, at: now };
      }
    }
    if (m.combo > v.combo) v.comboAt = now;
    v.score = m.score | 0;
    v.combo = m.combo | 0;
    v.fever = !!m.f;
    if (v.state !== 'done' && v.state !== 'error') v.state = 'playing';
    $('.spec-score', v.el).textContent = String(v.score).padStart(7, '0');
    $('.spec-state', v.el).textContent = '';
  }

  start() {
    cancelAnimationFrame(this.raf);
    this.running = true;
    let prev = performance.now();
    const step = (now) => {
      if (!this.running) return;
      const dt = Math.min(0.1, (now - prev) / 1000);
      prev = now;
      for (const v of this.views.values()) this.draw(v, now, dt);
      this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  }

  /* 받은 곡 위치 + 지난 시간으로 지금 위치를 추정하고 부드럽게 따라감 */
  timeOf(v, now, dt) {
    if (v.t === null) return null;
    const est = v.t + Math.min(0.3, (now - v.recvAt) / 1000);
    if (v.shownT === null || Math.abs(est - v.shownT) > 0.25) {
      if (v.shownT !== null && est < v.shownT) v.from = 0;   // 되돌아가면 지나간 노트 목록도 다시 계산
      v.shownT = est;
    }
    else v.shownT += dt + (est - v.shownT) * 0.15;
    return v.shownT;
  }

  draw(v, now, dt) {
    const cv = v.cv;
    const dpr = window.devicePixelRatio || 1;
    const r = cv.parentElement.getBoundingClientRect();
    const w = Math.max(40, Math.floor(r.width)), h = Math.max(60, Math.floor(r.height));
    if (cv.width !== w * dpr || cv.height !== h * dpr) {
      cv.width = w * dpr; cv.height = h * dpr;
      cv.style.width = w + 'px'; cv.style.height = h + 'px';
    }
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const nl = v.nl;
    const lw = w / nl;
    const jy = h - 14;
    const pps = h * SPEC_PPS;
    const colors = laneColors(nl);

    ctx.fillStyle = v.fever ? 'rgba(60,34,8,0.92)' : 'rgba(6,10,22,0.92)';
    ctx.fillRect(0, 0, w, h);
    for (let l = 0; l < nl; l++) {
      if (v.bits & (1 << l)) {
        const g = ctx.createLinearGradient(0, jy, 0, jy - h * 0.5);
        g.addColorStop(0, 'rgba(120,180,255,0.35)'); g.addColorStop(1, 'rgba(120,180,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(l * lw, 0, lw, jy);
      }
      if (l) { ctx.fillStyle = 'rgba(255,255,255,0.07)'; ctx.fillRect(l * lw, 0, 1, h); }
    }

    const t = this.timeOf(v, now, dt);
    if (t !== null) {
      while (v.from < v.notes.length && v.notes[v.from].t + v.notes[v.from].d < t - 0.3) v.from++;
      const top = t + Math.max(SPEC_LOOK, jy / pps);
      const nh = Math.max(3, Math.round(h * 0.022));
      for (let i = v.from; i < v.notes.length; i++) {
        const n = v.notes[i];
        if (n.t > top) break;
        const lane = v.map[n.l] ?? n.l;
        const x = lane * lw + 1.5, nw = lw - 3;
        ctx.fillStyle = colors[lane];
        if (n.d > 0) {
          const y1 = Math.min(jy, jy - (n.t - t) * pps);
          const y2 = jy - (n.t + n.d - t) * pps;
          if (y1 > y2) {
            ctx.globalAlpha = 0.45;
            ctx.fillRect(x + nw * 0.2, y2, nw * 0.6, y1 - y2);
            ctx.globalAlpha = 1;
          }
          if (n.t >= t - 0.02) ctx.fillRect(x, y1 - nh / 2, nw, nh);
        } else if (n.t >= t - 0.02) {
          const y = jy - (n.t - t) * pps;
          ctx.fillRect(x, y - nh / 2, nw, nh);
        }
      }
    }

    // 판정선 + 타격 반짝임
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.fillRect(0, jy, w, 2);
    for (let l = 0; l < nl; l++) {
      const k = (now - v.flash[l]) / 200;
      if (k >= 0 && k < 1) {
        ctx.globalAlpha = 1 - k;
        ctx.fillStyle = JUDGE_COLORS[JUDGE_KINDS[v.flashKind[l]]] || '#fff';
        ctx.fillRect(l * lw + 1, jy - 8, lw - 2, 10);
        ctx.globalAlpha = 1;
      }
    }
    // 최근 판정 / 콤보
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (v.last && now - v.last.at < 450) {
      const kind = JUDGE_KINDS[v.last.k] || 'perfect';
      ctx.font = `900 ${Math.max(9, Math.min(13, w / 7))}px ${UI_FONT}`;
      ctx.fillStyle = JUDGE_COLORS[kind];
      ctx.fillText(JUDGE_TEXT[kind], w / 2, h * 0.58);
    }
    if (v.combo >= 2) {
      const pop = clamp((now - v.comboAt) / 160, 0, 1);
      ctx.font = `900 ${Math.round(Math.max(12, Math.min(22, w / 4.5)) * (1 + 0.15 * (1 - pop)))}px ${UI_FONT}`;
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.fillText(String(v.combo), w / 2, h * 0.36);
    }
  }

  destroy() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.box.innerHTML = '';
    this.views.clear();
    $('#specPanel').classList.add('hidden');
  }
}
