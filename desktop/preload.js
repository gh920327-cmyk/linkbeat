// 게임 화면에 실행기 기능 몇 가지만 열어 줌 (호스트 키 저장, 채보 엔진 상태, 예전 데이터 옮기기)
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('lbDesktop', {
  isDesktop: true,
  setHostKey: (k) => ipcRenderer.invoke('lb:setHostKey', String(k || '')),
  importLocal: () => ipcRenderer.invoke('lb:import'),
  onEngine: (cb) => {
    ipcRenderer.on('lb:engine', (_e, st) => { try { cb(st); } catch (e) { /* 무시 */ } });
    ipcRenderer.send('lb:hello');
  },
});
