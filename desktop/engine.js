// 링크비트 PC 채보 엔진 관리 (호스트 PC에서만 켜짐)
// - 컴퓨터에 깔린 파이썬으로 전용 가상환경을 한 번 만들고(numpy·scipy·yt-dlp 등), 켤 때마다 yt-dlp만 최신으로
// - worker.py 를 뒤에서 실행: 서버 대기열의 곡을 받아 채보를 만들어 올림
// - 상태는 'status' 이벤트로 알림: { state: 'setup'|'install'|'ready'|'working'|'offline'|'error'|'off', msg }
const { spawn } = require('child_process');
const crypto = require('crypto');
const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');

const IS_WIN = process.platform === 'win32';

function run(cmd, args, { cwd, onLine, timeout = 0 } = {}) {
  return new Promise((resolve) => {
    let out = '';
    let p;
    try {
      p = spawn(cmd, args, { cwd, windowsHide: true, env: { ...process.env, PYTHONIOENCODING: 'utf-8', PIP_DISABLE_PIP_VERSION_CHECK: '1' } });
    } catch (e) { resolve({ code: -1, out: String(e) }); return; }
    const t = timeout ? setTimeout(() => { try { p.kill(); } catch (e) { /* 무시 */ } }, timeout) : null;
    const feed = (b) => {
      const s = b.toString('utf8');
      out += s;
      if (onLine) s.split(/\r?\n/).forEach((l) => l.trim() && onLine(l.trim()));
    };
    p.stdout.on('data', feed);
    p.stderr.on('data', feed);
    p.on('error', (e) => { if (t) clearTimeout(t); resolve({ code: -1, out: out + String(e) }); });
    p.on('close', (code) => { if (t) clearTimeout(t); resolve({ code, out }); });
  });
}

class Engine extends EventEmitter {
  constructor({ dataDir, srcDir, server }) {
    super();
    this.dataDir = dataDir;            // %APPDATA%/LINKBEAT/engine
    this.srcDir = srcDir;              // worker.py · pipeline.py · chartgen.py · requirements.txt 가 있는 곳
    this.server = server;
    this.venv = path.join(dataDir, 'venv');
    this.vpy = IS_WIN ? path.join(this.venv, 'Scripts', 'python.exe') : path.join(this.venv, 'bin', 'python');
    this.key = '';
    this.child = null;
    this.stopping = false;
    this.last = { state: 'off', msg: '' };
    this.backoff = 3000;
    this.preparing = null;
    this.gen = 0;                      // 다시 켤 때마다 올림 → 예전 엔진이 꺼지면서 스스로 다시 켜지지 않게
  }

  set(state, msg) {
    this.last = { state, msg };
    this.emit('status', this.last);
  }

  async findPython() {
    const tries = IS_WIN ? [['py', ['-3']], ['python', []], ['python3', []]] : [['python3', []], ['python', []]];
    for (const [cmd, pre] of tries) {
      const r = await run(cmd, [...pre, '-c', 'import sys;print(sys.version_info[0]*100+sys.version_info[1])'], { timeout: 20000 });
      const v = parseInt((r.out || '').trim().split(/\s+/).pop(), 10);
      if (r.code === 0 && v >= 309) return [cmd, pre];
    }
    return null;
  }

  reqHash() {
    const req = fs.readFileSync(path.join(this.srcDir, 'requirements.txt'), 'utf8');
    return crypto.createHash('sha1').update(req).digest('hex').slice(0, 12);
  }

  // 가상환경 준비 (처음 한 번 2~5분). 이미 돼 있으면 yt-dlp만 최신으로.
  prepare() {
    if (!this.preparing) this.preparing = this._prepare().finally(() => { this.preparing = null; });
    return this.preparing;
  }

  async _prepare() {
    fs.mkdirSync(this.dataDir, { recursive: true });
    const mark = path.join(this.dataDir, 'installed.txt');
    const want = this.reqHash();
    const ok = fs.existsSync(this.vpy) && fs.existsSync(mark) && fs.readFileSync(mark, 'utf8').trim() === want;
    if (!ok) {
      this.set('setup', '파이썬 찾는 중...');
      const py = await this.findPython();
      if (!py) {
        this.set('error', '파이썬이 없어요. 채보를 만들려면 파이썬 3.9 이상이 필요해요.');
        const e = new Error('NO_PYTHON');
        e.code = 'NO_PYTHON';
        throw e;
      }
      if (!fs.existsSync(this.vpy)) {
        this.set('install', '채보 엔진 설치 중... (처음 한 번, 몇 분 걸려요)');
        const r = await run(py[0], [...py[1], '-m', 'venv', this.venv], { timeout: 180000 });
        if (r.code !== 0 || !fs.existsSync(this.vpy)) { this.set('error', '가상환경을 만들지 못했어요: ' + r.out.slice(-200)); throw new Error('VENV'); }
      }
      this.set('install', '채보 엔진 설치 중... 필요한 프로그램 받는 중 (처음 한 번, 몇 분 걸려요)');
      await run(this.vpy, ['-m', 'pip', 'install', '--upgrade', 'pip'], { timeout: 300000 });
      const r = await run(this.vpy, ['-m', 'pip', 'install', '-r', path.join(this.srcDir, 'requirements.txt')], {
        timeout: 1200000,
        onLine: (l) => { const m = l.match(/^(Collecting|Downloading|Installing collected packages:)\s*(\S+)?/); if (m) this.set('install', `채보 엔진 설치 중... ${m[1] === 'Installing collected packages:' ? '설치하는 중' : (m[2] || '').slice(0, 40)}`); },
      });
      if (r.code !== 0) { this.set('error', '설치에 실패했어요. 인터넷 연결을 확인하고 실행기를 다시 켜 주세요.'); throw new Error('PIP'); }
      fs.writeFileSync(mark, want);
    } else {
      this.set('setup', '유튜브 다운로더 최신으로 맞추는 중...');
      await run(this.vpy, ['-m', 'pip', 'install', '-U', '-q', 'yt-dlp[default]'], { timeout: 180000 });
    }
    const chk = await run(this.vpy, [path.join(this.srcDir, 'worker.py'), '--check'], { cwd: this.srcDir, timeout: 120000 });
    if (chk.code !== 0) {
      fs.rmSync(mark, { force: true });     // 다음에 다시 설치
      this.set('error', '채보 엔진 확인에 실패했어요. 실행기를 다시 켜 주세요. ' + chk.out.slice(-160));
      throw new Error('CHECK');
    }
  }

  async start(key) {
    this.stop();
    this.key = key || '';
    const gen = this.gen;
    if (!this.key) { this.set('off', ''); return; }
    this.stopping = false;
    try { await this.prepare(); } catch (e) { return; }
    if (this.stopping || !this.key || gen !== this.gen) return;
    this.spawnWorker();
  }

  spawnWorker() {
    const gen = this.gen;
    const args = ['-u', path.join(this.srcDir, 'worker.py'), '--server', this.server, '--key', this.key];
    const p = spawn(this.vpy, args, { cwd: this.srcDir, windowsHide: true, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
    this.child = p;
    let buf = '';
    p.stdout.on('data', (b) => {
      buf += b.toString('utf8');
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line.startsWith('{')) continue;
        try { const st = JSON.parse(line); this.set(st.state, st.msg); this.backoff = 3000; } catch (e) { /* 무시 */ }
      }
    });
    p.stderr.on('data', () => {});
    p.on('close', () => {
      if (this.child === p) this.child = null;
      if (this.stopping || !this.key || gen !== this.gen) return;
      this.set('offline', '채보 엔진이 멈춰서 다시 켜는 중...');
      setTimeout(() => { if (!this.child && !this.stopping && this.key && gen === this.gen) this.spawnWorker(); }, this.backoff);
      this.backoff = Math.min(60000, this.backoff * 2);
    });
  }

  stop() {
    this.stopping = true;
    this.gen++;
    if (this.child) { try { this.child.kill(); } catch (e) { /* 무시 */ } this.child = null; }
  }

  // 예전 링크비트 폴더 → 서버로 옮기기
  async importDir(dir, key) {
    await this.prepare();
    let final = null;
    const r = await run(this.vpy, ['-u', path.join(this.srcDir, 'worker.py'), '--server', this.server, '--key', key, '--import', dir], {
      cwd: this.srcDir,
      timeout: 3600000,
      onLine: (l) => {
        if (!l.startsWith('{')) return;
        try {
          const st = JSON.parse(l);
          if (st.state === 'import') this.emit('import', st);
          if (st.state === 'imported' || st.state === 'error') final = st;
        } catch (e) { /* 무시 */ }
      },
    });
    if (final && final.state === 'imported') return final.msg;
    throw new Error((final && final.msg) || ('옮기기에 실패했어요. ' + r.out.slice(-200)));
  }
}

module.exports = { Engine };
