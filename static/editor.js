/* 링크비트 채보 수정 화면 */
'use strict';

class Editor {
  constructor(song, diff, keys, onExit) {
    this.song = song;
    this.diff = diff;
    this.nl = keys === 6 ? 6 : 4;
    this.onExit = onExit;
    this.bpm = song.bpm || 120;
    this.offset = song.offset || 0;
    this.pps = 320;
    this.snap = 4;
    this.rate = 1;
    this.tickOn = true;
    this.time = 0;
    this.playing = false;
    this.recording = false;
    this.clock = new SongClock();
    this.lastVT = -1;
    this.undoStack = [];
    this.dirty = false;
    this.drag = null;
    this.hover = null;
    this.recDown = new Array(6).fill(null);
    this.pressed = new Array(6).fill(false);
    this.cv = $('#edCanvas');
    this.raf = 0;
    this.prevT = 0;
    this.loadDiff(diff, this.nl);
    this.unsub = yt.on((st, err) => this.onYT(st, err));
    this.bind();
  }

  loadDiff(diff, nl = this.nl) {
    this.diff = diff;
    this.nl = nl;
    this.bpm = this.song.bpm || 120;      // 버리기로 했으면 BPM/첫 박 수정도 되돌림
    this.offset = this.song.offset || 0;
    this.notes = chartOf(this.song, diff, nl).map((n) => ({ t: +n.t, l: n.l | 0, d: +n.d || 0, ...(n.a ? { a: 1 } : {}) }));   // a: 드럼 강타 표시 유지
    this.undoStack = [];
    this.dirty = false;
    this.refreshPanel();
  }

  async open() {
    showScreen('editor');
    this.loop();
    try {
      await yt.preload(this.song.id);
      this.ready = true;
    } catch (e) {
      toast(e.message, 4000);
    }
  }

  /* ---------------- 시간 */
  now() { return this.playing ? this.clock.now() : this.time; }
  step() { return this.snap ? 60 / this.bpm / this.snap : 0.01; }
  snapT(t) {
    if (!this.snap) return Math.round(t * 1000) / 1000;
    const s = this.step();
    return +(this.offset + Math.round((t - this.offset) / s) * s).toFixed(3);
  }
  seek(t) {
    t = clamp(t, 0, (this.song.duration || 600));
    this.time = t;
    if (this.playing) { this.clock.set(t); yt.seek(t); }
    this.prevT = t;
  }

  onYT(st) {
    if (st === YTS.PLAYING && this.playing) {
      this.clock.set(yt.time()); this.clock.start(); this.lastVT = -1;
    } else if (st === YTS.BUFFERING && this.playing) {
      this.clock.stop();
    } else if ((st === YTS.ENDED || st === YTS.PAUSED) && this.playing) {
      this.setPlaying(false);
    }
  }

  setPlaying(on) {
    if (on === this.playing) return;
    if (on && !this.ready) { toast('영상을 불러오는 중이에요.'); return; }
    if (on) {
      this.playing = true;
      this.clock.rate = this.rate;
      this.clock.set(this.time);
      this.prevT = this.time;
      yt.rate(this.rate);
      yt.seek(this.time);
      yt.play();
    } else {
      this.time = this.clock.now();
      this.playing = false;
      this.clock.stop();
      yt.pause();
      this.recDown.fill(null);
    }
    this.refreshPanel();
  }

  /* ---------------- 편집 */
  pushUndo() {
    this.undoStack.push(JSON.stringify(this.notes));
    if (this.undoStack.length > 200) this.undoStack.shift();
    this.dirty = true;
  }
  undo() {
    const s = this.undoStack.pop();
    if (!s) { toast('되돌릴 게 없어요.'); return; }
    this.notes = JSON.parse(s);
    this.dirty = true;
    this.refreshPanel();
  }
  sortNotes() { this.notes.sort((a, b) => a.t - b.t || a.l - b.l); }
  noteAt(lane, t, tol) {
    // 머리 근처 또는 롱노트 몸통
    let best = null;
    for (const n of this.notes) {
      if (n.l !== lane) continue;
      if (Math.abs(n.t - t) <= tol || (n.d > 0 && t >= n.t && t <= n.t + n.d)) {
        if (!best || Math.abs(n.t - t) < Math.abs(best.t - t)) best = n;
      }
    }
    return best;
  }
  addNote(t, l, d = 0) {
    t = Math.max(0, t);
    if (this.notes.some((n) => n.l === l && Math.abs(n.t - t) < 0.02)) return null;
    const n = { t: +t.toFixed(3), l, d: +Math.max(0, d).toFixed(3) };
    this.notes.push(n);
    this.sortNotes();
    this.dirty = true;
    return n;
  }

  /* ---------------- 좌표 */
  layout() {
    const L = fitCanvas(this.cv, this.nl);
    L.judgeY = Math.floor(L.h * 0.8);
    return L;
  }
  hit(e) {
    const L = this.lastL;
    const r = this.cv.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    const lane = Math.floor((x - L.x0) / L.laneW);
    const t = this.now() + (L.judgeY - y) / this.pps;
    return { lane: lane >= 0 && lane < this.nl ? lane : -1, t, y };
  }

  bind() {
    const cv = this.cv;
    this.h = {
      down: (e) => {
        if (currentScreen !== 'editor') return;
        const p = this.hit(e);
        if (p.lane < 0) return;
        e.preventDefault();
        if (e.button === 2) {
          const n = this.noteAt(p.lane, p.t, 12 / this.pps + 0.02);
          if (n) { this.pushUndo(); this.notes.splice(this.notes.indexOf(n), 1); this.refreshPanel(); }
          return;
        }
        if (e.button !== 0) return;
        const n = this.noteAt(p.lane, p.t, 12 / this.pps + 0.02);
        this.pushUndo();
        if (n) {
          this.drag = { mode: 'move', note: n, grab: p.t - n.t };
        } else {
          const nn = this.addNote(this.snapT(p.t), p.lane);
          if (nn) this.drag = { mode: 'hold', note: nn };
          else this.undoStack.pop();
        }
        cv.setPointerCapture(e.pointerId);
      },
      move: (e) => {
        if (currentScreen !== 'editor') return;
        const p = this.hit(e);
        this.hover = p.lane >= 0 ? { lane: p.lane, t: this.snapT(p.t) } : null;
        if (!this.drag) return;
        const n = this.drag.note;
        if (this.drag.mode === 'hold') {
          const end = this.snapT(p.t);
          n.d = end - n.t >= 0.08 ? +(end - n.t).toFixed(3) : 0;
        } else {
          n.t = Math.max(0, this.snapT(p.t - this.drag.grab));
          if (p.lane >= 0) n.l = p.lane;
          this.sortNotes();
        }
        this.refreshPanel();
      },
      up: () => { this.drag = null; },
      wheel: (e) => {
        if (currentScreen !== 'editor') return;
        e.preventDefault();
        if (e.ctrlKey) {
          this.pps = clamp(this.pps * (e.deltaY < 0 ? 1.12 : 1 / 1.12), 60, 2000);
        } else {
          this.seek(this.now() - e.deltaY / this.pps);
        }
      },
      ctx: (e) => e.preventDefault(),
    };
    cv.addEventListener('pointerdown', this.h.down);
    cv.addEventListener('pointermove', this.h.move);
    cv.addEventListener('pointerup', this.h.up);
    cv.addEventListener('pointercancel', this.h.up);
    cv.addEventListener('wheel', this.h.wheel, { passive: false });
    cv.addEventListener('contextmenu', this.h.ctx);
  }
  unbind() {
    const cv = this.cv;
    cv.removeEventListener('pointerdown', this.h.down);
    cv.removeEventListener('pointermove', this.h.move);
    cv.removeEventListener('pointerup', this.h.up);
    cv.removeEventListener('pointercancel', this.h.up);
    cv.removeEventListener('wheel', this.h.wheel);
    cv.removeEventListener('contextmenu', this.h.ctx);
  }

  /* ---------------- 키보드 (app.js에서 전달) */
  keyDown(e) {
    const code = e.code;
    if ((e.ctrlKey || e.metaKey) && code === 'KeyZ') { e.preventDefault(); this.undo(); return; }
    if ((e.ctrlKey || e.metaKey) && code === 'KeyS') { e.preventDefault(); this.save(); return; }
    const lane = keysFor(this.nl).indexOf(code);
    if (lane >= 0 && this.recording && this.playing) {
      e.preventDefault();
      if (e.repeat || this.recDown[lane]) return;
      this.pressed[lane] = true;
      const t = this.clock.now(e.timeStamp) - settings.offset / 1000;
      this.pushUndo();
      const n = this.addNote(this.snapT(t), lane);
      this.recDown[lane] = n ? { note: n, t } : null;
      if (!n) this.undoStack.pop();
      this.refreshPanel();
      return;
    }
    if (code === 'Space') { e.preventDefault(); this.setPlaying(!this.playing); return; }
    if (code === 'KeyR' && !e.ctrlKey) { this.toggleRec(); return; }
    if (code === 'ArrowLeft' || code === 'ArrowRight') {
      e.preventDefault();
      const s = this.snap ? this.step() : 0.05;
      const cur = this.now();
      let t = code === 'ArrowLeft' ? cur - s : cur + s;
      if (this.snap) t = this.snapT(t);
      if (Math.abs(t - cur) < 0.001) t += code === 'ArrowLeft' ? -s : s;
      this.seek(t);
      return;
    }
    if (code === 'Home') { this.seek(0); return; }
  }
  keyUp(e) {
    const lane = keysFor(this.nl).indexOf(e.code);
    if (lane < 0) return;
    this.pressed[lane] = false;
    const r = this.recDown[lane];
    this.recDown[lane] = null;
    if (!r || !this.playing) return;
    const t = this.clock.now(e.timeStamp) - settings.offset / 1000;
    if (t - r.t >= 0.25) {
      const end = this.snapT(t);
      r.note.d = Math.max(0, +(end - r.note.t).toFixed(3));
      this.refreshPanel();
    }
  }
  toggleRec() {
    this.recording = !this.recording;
    toast(this.recording ? '녹화 모드: 재생하면서 4키를 누르세요' : '녹화 모드 끔');
    this.refreshPanel();
  }

  /* ---------------- 그리기 */
  loop() {
    cancelAnimationFrame(this.raf);
    const step = () => {
      if (this.closed) return;
      if (this.playing) {
        const vt = yt.time();
        if (vt !== this.lastVT && yt.state() === YTS.PLAYING) { this.clock.sync(vt); this.lastVT = vt; }
        const cur = this.clock.now();
        if (this.tickOn) {
          for (const n of this.notes) {
            if (n.t > cur) break;
            if (n.t > this.prevT && n.t <= cur) { sfx.tick(0.3, n.l === 0 || n.l === this.nl - 1 ? 1900 : 1300); break; }
          }
        }
        this.prevT = cur;
        $('#edTime').textContent = fmtTime(cur, true);
      }
      this.draw();
      this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  }

  draw() {
    const L = this.layout();
    this.lastL = L;
    const { ctx, w, h, laneW, fieldW, x0, judgeY } = L;
    const cur = this.now();
    drawLanes(L, judgeY, this.pressed, 0.92);
    const tBottom = cur - (h - judgeY) / this.pps;
    const tTop = cur + judgeY / this.pps;

    // 그리드: 스냅선 / 박 / 마디
    const bl = 60 / this.bpm;
    const div = this.snap || 1;
    const s = bl / div;
    let k = Math.floor((tBottom - this.offset) / s);
    ctx.font = '500 11px "JetBrains Mono", monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let t = this.offset + k * s; t <= tTop; t += s, k++) {
      const y = judgeY - (t - cur) * this.pps;
      const isBeat = k % div === 0;
      const beatNo = Math.round(k / div);
      const isBar = isBeat && beatNo % 4 === 0;
      ctx.fillStyle = isBar ? 'rgba(255,255,255,0.45)' : isBeat ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.06)';
      ctx.fillRect(x0, Math.round(y), fieldW, isBar ? 2 : 1);
      if (isBar && beatNo >= 0) {
        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ctx.fillText(String(beatNo / 4 + 1), x0 - 8, y);
      }
    }

    // 노트
    for (const n of this.notes) {
      if (n.t > tTop + 0.1) break;
      if (n.t + n.d < tBottom - 0.1) continue;
      const yHead = judgeY - (n.t - cur) * this.pps;
      const yTail = n.d > 0 ? judgeY - (n.t + n.d - cur) * this.pps : null;
      drawNote(L, n.l, yHead, yTail, this.drag && this.drag.note === n ? 'hold' : 'live');
    }

    // 마우스 위치 미리보기
    if (this.hover && !this.drag) {
      const y = judgeY - (this.hover.t - cur) * this.pps;
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.setLineDash([4, 4]);
      roundRect(ctx, x0 + this.hover.lane * laneW + 5, y - 9, laneW - 10, 18, 6);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // 현재 위치선
    ctx.fillStyle = this.recording ? '#ff4d6d' : '#fff';
    ctx.shadowColor = ctx.fillStyle;
    ctx.shadowBlur = 10;
    ctx.fillRect(x0 - 6, judgeY - 1, fieldW + 12, 3);
    ctx.shadowBlur = 0;
    if (this.recording) {
      ctx.textAlign = 'left';
      ctx.font = '700 13px "Noto Sans KR", sans-serif';
      ctx.fillStyle = '#ff4d6d';
      ctx.fillText('● 녹화 중', x0 + 4, 18);
    }
    if (!this.ready) {
      ctx.textAlign = 'center';
      ctx.font = '700 18px "Noto Sans KR", sans-serif';
      ctx.fillStyle = '#fff';
      ctx.fillText('영상 불러오는 중...', x0 + fieldW / 2, h * 0.4);
    }
    if (!this.playing) $('#edTime').textContent = fmtTime(cur, true);
  }

  refreshPanel() {
    $('#edTitle').textContent = this.song.title;
    $('#edDiff').value = this.diff;
    $('#edKeys').value = String(this.nl);
    $('#edBpm').value = this.bpm;
    $('#edOffset').value = this.offset;
    const holds = this.notes.filter((n) => n.d > 0).length;
    $('#edCount').innerHTML = `${starHtml(starRating(this.notes, this.nl))} 노트 ${this.notes.length}개 (긴 노트 ${holds})${this.dirty ? ' · <b class="warn">저장 안 됨</b>' : ''}`;
    $('#edPlay').innerHTML = (this.playing ? '❚❚ 정지' : '▶ 재생') + ' <kbd>Space</kbd>';
    $('#edRec').classList.toggle('rec-on', this.recording);
  }

  async save() {
    try {
      const body = { notes: this.notes, keys: this.nl };
      await api(`/songs/${this.song.id}/charts/${this.diff}`, { method: 'PUT', body });
      if (this.bpm !== this.song.bpm || this.offset !== this.song.offset) {
        await api(`/songs/${this.song.id}`, { method: 'PATCH', body: { bpm: this.bpm, offset: this.offset } });
        this.song.bpm = this.bpm;
        this.song.offset = this.offset;
        delete this.song.beats;   // 서버도 박자를 고치면 분석 박 위치를 버림
      }
      const ck = this.nl === 6 ? 'charts6' : 'charts';
      (this.song[ck] ||= {})[this.diff] = this.notes.map((n) => ({ ...n }));
      this.dirty = false;
      this.refreshPanel();
      toast('저장했어요!');
      return true;
    } catch (e) {
      toast('저장 실패: ' + e.message, 3500);
      return false;
    }
  }

  close() {
    this.closed = true;
    cancelAnimationFrame(this.raf);
    this.setPlaying(false);
    this.unsub();
    this.unbind();
  }
}
