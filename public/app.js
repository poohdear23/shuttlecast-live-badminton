(() => {
  const $ = (selector) => document.querySelector(selector);
  const state = {
    view: 'setup', matchTitle: 'Rally Night • Court 1', sideA: 'ทีมฟ้า', sideB: 'ทีมแดง', teamColorA: '#d3a94f', teamColorB: '#ead7aa', matchGames: 3, targetPoints: 21, capPoints: 30, winByTwo: true,
    scoreA: 0, scoreB: 0, winsA: 0, winsB: 0, game: 1, gameResults: [], history: [],
    stream: { camera: null, running: false, micEnabled: true, signal: null, ice: [], viewers: new Map() }
  };
  const PREVIEW_W = 960, PREVIEW_H = 540;
  const MAX_VIDEO_BITRATE = 3000000;

  const toast = (message) => {
    const el = $('#toast'); el.textContent = message; el.classList.add('show');
    window.clearTimeout(toast.timer); toast.timer = window.setTimeout(() => el.classList.remove('show'), 2800);
  };
  const setConnection = (kind, label) => { $('#connectionDot').className = `connection-dot ${kind || ''}`; $('#connectionLabel').textContent = label; };
  const setText = (id, value) => { const el = $(id); if (el) el.textContent = value; };
  const persistMatch = () => localStorage.setItem('rallycast.match', JSON.stringify({ matchTitle: state.matchTitle, sideA: state.sideA, sideB: state.sideB, teamColorA: state.teamColorA, teamColorB: state.teamColorB, matchGames: state.matchGames, targetPoints: state.targetPoints, capPoints: state.capPoints, winByTwo: state.winByTwo }));
  const loadMatch = () => { try { const saved = JSON.parse(localStorage.getItem('rallycast.match')); if (saved) Object.assign(state, saved); } catch {} };

  function updateSetupPreview() { setText('#previewA', $('#sideA').value || 'ฝั่ง A'); setText('#previewB', $('#sideB').value || 'ฝั่ง B'); updateTeamColors(); }
  function updateTeamColors() { const a = $('#teamColorA').value; const b = $('#teamColorB').value; $('#previewColorA').style.background = a; $('#previewColorB').style.background = b; $('#scoreColorA').style.background = a; $('#scoreColorB').style.background = b; }
  function applySetupValues() {
    state.matchTitle = $('#matchTitle').value.trim() || 'Rally Night • Court 1';
    state.sideA = $('#sideA').value.trim() || 'ฝั่ง A'; state.sideB = $('#sideB').value.trim() || 'ฝั่ง B'; state.teamColorA = $('#teamColorA').value; state.teamColorB = $('#teamColorB').value; persistMatch();
    state.matchGames = Number($('#matchGames').value); state.targetPoints = Math.max(1, Math.min(30, Number($('#targetPoints').value) || 21)); state.capPoints = Math.max(state.targetPoints, Math.min(99, Number($('#capPoints').value) || 30)); $('#targetPoints').value = state.targetPoints; $('#capPoints').value = state.capPoints; state.winByTwo = $('#winByTwo').checked; persistMatch();
    setText('#scoreNameAText', state.sideA); setText('#scoreNameBText', state.sideB); setText('#studioTitle', state.matchTitle); updateTeamColors(); renderScore();
  }
  function showView(view) { state.view = view; $('#setupView').classList.toggle('active', view === 'setup'); $('#studioView').classList.toggle('active', view === 'studio'); window.scrollTo({ top: 0, behavior: 'smooth' }); }

  function renderScore() {
    setText('#scoreA', state.scoreA); setText('#scoreB', state.scoreB); setText('#gameWinsA', state.winsA); setText('#gameWinsB', state.winsB); setText('#gameNumber', state.game); setText('#scoreTitle', `GAME ${state.game} / ${state.matchGames === 1 ? 'SINGLE GAME' : `BEST OF ${state.matchGames}`}`); setText('#ruleSummary', `${state.targetPoints} แต้ม • ${state.winByTwo ? 'นำ 2' : 'แต้มถึงก่อน'} • สูงสุด ${state.capPoints}`); setText('#nextGameButton', state.matchGames === 1 ? 'จบเกม →' : 'เกมถัดไป →');
    renderGameHistory();
    updateCanvas(); broadcastScore();
  }
  function escapeHtml(value) { return String(value).replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character])); }
  function renderGameHistory() {
    const root = $('#gameHistory'); if (!root) return;
    if (!state.gameResults.length) { root.hidden = true; root.innerHTML = ''; return; }
    root.hidden = false;
    root.innerHTML = `<div class="history-heading">ผลเกมที่ผ่านมา</div>${state.gameResults.slice().reverse().map(result => `<div class="history-row"><span class="history-game">เกม ${result.game}</span><span class="history-name history-name-a">${escapeHtml(state.sideA)}</span><strong class="history-score ${result.winner === 'A' ? 'winner-score' : ''}">${result.scoreA}</strong><span class="history-sep">—</span><strong class="history-score ${result.winner === 'B' ? 'winner-score' : ''}">${result.scoreB}</strong><span class="history-name history-name-b">${escapeHtml(state.sideB)}</span></div>`).join('')}`;
  }
  function snapshot() { state.history.push({ scoreA: state.scoreA, scoreB: state.scoreB, winsA: state.winsA, winsB: state.winsB, game: state.game, gameResults: state.gameResults.map(result => ({ ...result })) }); if (state.history.length > 30) state.history.shift(); }
  function addPoint(side) { snapshot(); if (side === 'A') state.scoreA = Math.min(state.capPoints, state.scoreA + 1); else state.scoreB = Math.min(state.capPoints, state.scoreB + 1); renderScore(); }
  function subtractPoint(side) { snapshot(); if (side === 'A') state.scoreA = Math.max(0, state.scoreA - 1); else state.scoreB = Math.max(0, state.scoreB - 1); renderScore(); }
  function undo() { const last = state.history.pop(); if (!last) return toast('ยังไม่มีแต้มให้ย้อนกลับ'); Object.assign(state, last); renderScore(); toast('ย้อนแต้มล่าสุดแล้ว'); }
  function resetGame() { snapshot(); state.scoreA = 0; state.scoreB = 0; renderScore(); toast('รีเซ็ตคะแนนเกมนี้แล้ว'); }
  function nextGame() {
    const reachedTarget = state.scoreA >= state.targetPoints || state.scoreB >= state.targetPoints;
    const atCap = state.scoreA >= state.capPoints || state.scoreB >= state.capPoints;
    const complete = reachedTarget && (!state.winByTwo || Math.abs(state.scoreA - state.scoreB) >= 2) || atCap;
    if (!complete) return toast(`เกมยังไม่จบ: ต้องถึง ${state.targetPoints} แต้มและนำ ${state.winByTwo ? '2 แต้ม' : 'ไม่ต้องนำ'}`);
    if (state.matchGames !== 1 && (state.game >= state.matchGames || state.winsA >= Math.ceil(state.matchGames / 2) || state.winsB >= Math.ceil(state.matchGames / 2))) return toast('แมตช์นี้ครบตามจำนวนเกมที่ตั้งไว้แล้ว');
    const winner = state.scoreA > state.scoreB ? 'A' : state.scoreB > state.scoreA ? 'B' : null;
    if (!winner) return toast('คะแนนเท่ากัน ยังบันทึกผู้ชนะไม่ได้');
    snapshot(); state.gameResults.push({ game: state.game, scoreA: state.scoreA, scoreB: state.scoreB, winner }); if (winner === 'A') state.winsA += 1; if (winner === 'B') state.winsB += 1;
    if (state.matchGames === 1) { renderScore(); return toast(`บันทึกผลการแข่งขัน: ${winner === 'A' ? state.sideA : state.sideB} ชนะ`); }
    const previousGame = state.game; state.scoreA = 0; state.scoreB = 0; state.game = Math.min(state.matchGames, state.game + 1); renderScore(); toast(winner ? `บันทึกผู้ชนะเกม ${previousGame} แล้ว` : 'เริ่มเกมถัดไปแล้ว');
  }

  function scoreSnapshot() { return { sideA: state.sideA, sideB: state.sideB, teamColorA: state.teamColorA, teamColorB: state.teamColorB, scoreA: state.scoreA, scoreB: state.scoreB, winsA: state.winsA, winsB: state.winsB, game: state.game, matchGames: state.matchGames, gameResults: state.gameResults.map(result => ({ ...result })) }; }
  function sendScore(channel) { if (channel?.readyState === 'open') { try { channel.send(JSON.stringify({ t: 'score', s: scoreSnapshot() })); } catch {} } }
  function broadcastScore() { state.stream.viewers.forEach(viewer => sendScore(viewer.channel)); }

  function updateCanvas() {
    const canvas = $('#broadcastCanvas'); const video = $('#cameraVideo'); if (!canvas || !video.videoWidth) return;
    if (canvas.width !== PREVIEW_W || canvas.height !== PREVIEW_H) { canvas.width = PREVIEW_W; canvas.height = PREVIEW_H; }
    ShuttleOverlay.drawFrame(canvas.getContext('2d'), video, PREVIEW_W, PREVIEW_H, scoreSnapshot());
  }
  let lastCanvasFrame = 0;
  function canvasLoop(timestamp = 0) { if (!state.stream.camera) return; if (timestamp - lastCanvasFrame >= 1000 / 15) { updateCanvas(); lastCanvasFrame = timestamp; } requestAnimationFrame(canvasLoop); }

  async function openCamera() {
    if (state.stream.camera) return;
    if (!window.isSecureContext) return toast('กล้องต้องใช้ HTTPS — กรุณาเปิดลิงก์ Preview โดยตรงใน Chrome หรือ Safari');
    if (!navigator.mediaDevices?.getUserMedia) return toast('หน้าต่าง Preview นี้ไม่อนุญาตกล้อง — เปิดลิงก์ในเบราว์เซอร์ภายนอกแทน');
    try {
      state.stream.camera = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 } }, audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
      state.stream.camera.getAudioTracks().forEach(track => { track.enabled = state.stream.micEnabled; });
      const hasAudio = state.stream.camera.getAudioTracks().some(track => track.readyState === 'live');
      const video = $('#cameraVideo'); video.srcObject = state.stream.camera; await video.play(); $('#stage').classList.add('camera-on'); $('#broadcastCanvas').style.display = 'block'; $('#cameraToggle').textContent = 'ปิดกล้อง'; $('#openCameraButton').textContent = 'กล้องพร้อมแล้ว'; setConnection('ready', hasAudio ? 'กล้องและไมค์พร้อม' : 'ไม่พบไมค์'); canvasLoop(); toast(hasAudio ? 'เปิดกล้องและไมค์แล้ว — พร้อมตรวจ scoreboard ก่อนขึ้นไลฟ์' : 'เปิดกล้องแล้ว แต่ไม่พบไมโครโฟน — Live จะไม่มีเสียง');
    } catch (error) {
      const message = error?.name === 'NotAllowedError' ? 'เบราว์เซอร์ยังไม่อนุญาตกล้อง/ไมค์ — กด Allow หรือเปิดลิงก์ใน Chrome/Safari โดยตรง' : error?.name === 'NotFoundError' ? 'ไม่พบกล้องหรือไมโครโฟนบนอุปกรณ์' : error?.name === 'NotReadableError' ? 'กล้องกำลังถูกใช้งานโดยแอปอื่น' : 'เปิดกล้องไม่ได้ — ตรวจสิทธิ์กล้องและไมโครโฟนในเบราว์เซอร์';
      toast(message); setConnection('', 'ต้องการสิทธิ์กล้อง');
    }
  }
  function closeCamera() { state.stream.camera?.getTracks().forEach(track => track.stop()); state.stream.camera = null; $('#cameraVideo').srcObject = null; $('#stage').classList.remove('camera-on'); $('#broadcastCanvas').style.display = 'none'; $('#cameraToggle').textContent = 'เปิดกล้อง'; setConnection('ready', 'พร้อมตั้งค่า'); }
  function toggleMic() { state.stream.micEnabled = !state.stream.micEnabled; state.stream.camera?.getAudioTracks().forEach(track => { track.enabled = state.stream.micEnabled; }); $('#micToggle').textContent = `ไมค์: ${state.stream.micEnabled ? 'เปิด' : 'ปิด'}`; }

  // ---------- OBS viewer link / status ----------
  function obsViewerUrl() { const room = ShuttleSignal.roomName(); return `http://localhost:${location.port && location.hostname === 'localhost' ? location.port : '3000'}/live${room === 'main' ? '' : `?room=${room}`}`; }
  function refreshViewerUI() {
    const viewers = [...state.stream.viewers.values()]; const connected = viewers.filter(viewer => viewer.pc?.connectionState === 'connected').length;
    setText('#viewerState', !viewers.length ? 'ยังไม่พบหน้า Viewer บนโน้ตบุ๊ก' : state.stream.running ? (connected ? `กำลังส่งภาพ (${connected}/${viewers.length} หน้า)` : 'กำลังเชื่อมต่อโน้ตบุ๊ก…') : `พบ Viewer ${viewers.length} หน้า — พร้อมส่ง`);
    $('#viewerLight').classList.toggle('live', viewers.length > 0 && (!state.stream.running || connected > 0));
    if (state.stream.running) setConnection(connected ? 'live' : 'ready', connected ? 'กำลังส่งภาพเข้าโน้ตบุ๊ก' : 'รอโน้ตบุ๊กเชื่อมต่อ');
  }
  let usageWarned = false;
  async function refreshUsage() { try { const u = await (await fetch('/api/usage', { cache: 'no-store' })).json(); const note = $('#usageNote'); if (!note || !u.ok) return; if (u.exceeded) { note.textContent = `⚠ ใช้ไลฟ์เดือนนี้ ${u.hours.toFixed(1)} ชม. ถึงเพดาน ${u.limitHours} ชม. แล้ว — เสี่ยงเกินโควตาฟรี TURN ตรวจยอดใน Cloudflare`; note.style.color = '#ff7f67'; if (!usageWarned) { usageWarned = true; toast(`ถึงเพดาน ${u.limitHours} ชม. ต่อเดือนแล้ว — ตรวจยอดใช้ TURN ใน Cloudflare`); } } else { note.textContent = `ใช้ไลฟ์เดือนนี้ ~${u.hours.toFixed(1)} / ${u.limitHours} ชม. • แอปไม่เก็บ Stream Key ใส่ Key ใน OBS เท่านั้น`; note.style.color = ''; } } catch {} }
  setInterval(refreshUsage, 60000); refreshUsage();
  function openObsInfo() { $('#obsUrl').value = obsViewerUrl(); $('#destinationModal').hidden = false; }
  function closeObsInfo() { $('#destinationModal').hidden = true; }
  async function copyObsUrl() { const url = obsViewerUrl(); try { await navigator.clipboard.writeText(url); toast('คัดลอกลิงก์สำหรับ OBS แล้ว'); } catch { $('#obsUrl').select(); toast('แตะค้างที่ช่องลิงก์แล้วเลือก คัดลอก'); } }

  // ---------- WebRTC phone -> laptop ----------
  function closeViewerConnection(viewer) { if (!viewer) return; clearTimeout(viewer.retryTimer); const { pc } = viewer; if (pc) { pc.onconnectionstatechange = null; pc.onicecandidate = null; try { viewer.channel?.close(); } catch {} try { pc.close(); } catch {} } viewer.pc = null; viewer.channel = null; viewer.remoteSet = false; viewer.pendingIce = []; }
  async function applySenderLimits(pc) { for (const sender of pc.getSenders()) { if (sender.track?.kind !== 'video') continue; try { const params = sender.getParameters(); if (!params.encodings?.length) params.encodings = [{}]; params.encodings[0].maxBitrate = MAX_VIDEO_BITRATE; params.degradationPreference = 'maintain-framerate'; await sender.setParameters(params); } catch {} } }
  async function connectViewer(id) {
    const viewer = state.stream.viewers.get(id); if (!viewer || !state.stream.running || !state.stream.camera) return;
    closeViewerConnection(viewer);
    const pc = new RTCPeerConnection({ iceServers: state.stream.ice }); viewer.pc = pc; viewer.remoteSet = false; viewer.pendingIce = [];
    state.stream.camera.getTracks().forEach(track => pc.addTrack(track, state.stream.camera));
    const channel = pc.createDataChannel('score'); viewer.channel = channel; channel.onopen = () => sendScore(channel);
    pc.onicecandidate = event => { if (event.candidate && viewer.pc === pc) state.stream.signal.send(id, 'ice', event.candidate.toJSON()); };
    pc.onconnectionstatechange = () => {
      if (viewer.pc !== pc) return;
      if (pc.connectionState === 'connected') { applySenderLimits(pc); clearTimeout(viewer.retryTimer); }
      if (['failed', 'disconnected'].includes(pc.connectionState)) { clearTimeout(viewer.retryTimer); viewer.retryTimer = setTimeout(() => { if (state.stream.running && state.stream.viewers.has(id) && viewer.pc === pc && pc.connectionState !== 'connected') { toast('สัญญาณไปโน้ตบุ๊กหลุด — กำลังเชื่อมต่อใหม่ (ถ้าใช้เน็ตมือถือแล้วไม่ติด ต้องตั้ง TURN ที่โน้ตบุ๊ก)'); connectViewer(id); } }, pc.connectionState === 'failed' ? 500 : 4000); }
      refreshViewerUI();
    };
    try { const offer = await pc.createOffer(); await pc.setLocalDescription(offer); state.stream.signal.send(id, 'offer', { sdp: offer.sdp }); } catch { toast('สร้างการเชื่อมต่อไปโน้ตบุ๊กไม่สำเร็จ'); }
    refreshViewerUI();
  }
  function addViewer(id) { if (!state.stream.viewers.has(id)) state.stream.viewers.set(id, { pc: null, channel: null, remoteSet: false, pendingIce: [], retryTimer: 0 }); if (state.stream.running) connectViewer(id); refreshViewerUI(); }
  function removeViewer(id) { closeViewerConnection(state.stream.viewers.get(id)); state.stream.viewers.delete(id); refreshViewerUI(); }
  async function handleSignal(message) {
    const { type, from, data } = message;
    try {
      if (type === 'peer-joined' && data?.role === 'viewer') addViewer(from);
      else if (type === 'peer-left' && data?.role === 'viewer') removeViewer(from);
      else if (type === 'rejoined') { const ids = new Set((data.peers || []).filter(peer => peer.role === 'viewer').map(peer => peer.id)); [...state.stream.viewers.keys()].forEach(id => { if (!ids.has(id)) removeViewer(id); }); ids.forEach(addViewer); }
      else if (type === 'answer') { const viewer = state.stream.viewers.get(from); if (viewer?.pc && !viewer.remoteSet) { await viewer.pc.setRemoteDescription({ type: 'answer', sdp: data.sdp }); viewer.remoteSet = true; for (const candidate of viewer.pendingIce.splice(0)) await viewer.pc.addIceCandidate(candidate).catch(() => {}); } }
      else if (type === 'ice') { const viewer = state.stream.viewers.get(from); if (viewer?.pc) { if (viewer.remoteSet) await viewer.pc.addIceCandidate(data).catch(() => {}); else viewer.pendingIce.push(data); } }
    } catch (error) { console.error('[phone]', error); }
  }
  async function ensureSignal() {
    if (state.stream.signal) return true;
    try {
      state.stream.ice = await ShuttleSignal.iceServers();
      const signal = ShuttleSignal.connect({ role: 'phone', onMessage: handleSignal }); const peers = await signal.start(); state.stream.signal = signal;
      peers.filter(peer => peer.role === 'viewer').forEach(peer => addViewer(peer.id)); return true;
    } catch { toast('ติดต่อ server ไม่ได้ — ตรวจว่าโน้ตบุ๊กยังเปิด node server.js และ tunnel อยู่'); return false; }
  }

  async function startLive() {
    if (state.stream.running) return stopLive();
    if (!state.stream.camera) await openCamera(); if (!state.stream.camera) return;
    if (!await ensureSignal()) return;
    state.stream.running = true; setLiveUi(true); refreshUsage();
    if (!state.stream.viewers.size) toast('ยังไม่พบหน้า Viewer — เปิด OBS แล้วใส่ลิงก์ของ Viewer ก่อน (กดปุ่ม ต่อ OBS)');
    else toast('กำลังส่งภาพเข้าโน้ตบุ๊ก — กด Start Streaming ใน OBS เพื่อไลฟ์ขึ้น Facebook');
    [...state.stream.viewers.keys()].forEach(connectViewer);
  }
  async function stopLive() {
    if (!state.stream.running) return;
    state.stream.running = false;
    state.stream.viewers.forEach((viewer, id) => { state.stream.signal?.send(id, 'live-stop', {}); closeViewerConnection(viewer); });
    setLiveUi(false); refreshViewerUI(); toast('หยุดส่งภาพแล้ว — อย่าลืมกด Stop Streaming ใน OBS');
  }
  function setLiveUi(isLive) { $('#liveChip').classList.toggle('live', isLive); if ($('#onAirLabel')) $('#onAirLabel').textContent = isLive ? 'ON AIR' : 'PREVIEW'; setText('#liveChip', isLive ? '● LIVE' : '○ OFFLINE'); $('#startLiveButton').classList.toggle('active', isLive); setText('#startLiveLabel', isLive ? 'หยุดถ่ายทอดสด' : 'เริ่มถ่ายทอดสด'); setConnection(isLive ? 'live' : 'ready', isLive ? 'กำลังส่งภาพเข้าโน้ตบุ๊ก' : 'กล้องพร้อม'); }

  try { localStorage.removeItem('rallycast.destinations'); } catch {}
  loadMatch(); $('#matchTitle').value = state.matchTitle || 'Rally Night • Court 1'; $('#sideA').value = state.sideA || 'ทีมฟ้า'; $('#sideB').value = state.sideB || 'ทีมแดง'; $('#teamColorA').value = state.teamColorA || '#d3a94f'; $('#teamColorB').value = state.teamColorB || '#ead7aa'; $('#matchGames').value = String(state.matchGames || 3); $('#targetPoints').value = String(state.targetPoints || 21); $('#capPoints').value = String(state.capPoints || 30); $('#winByTwo').checked = state.winByTwo !== false; updateSetupPreview();
  const syncCapRule = () => { const target = Math.max(1, Math.min(30, Number($('#targetPoints').value) || 21)); const cap = Math.max(target, Math.min(99, Number($('#capPoints').value) || 30)); $('#targetPoints').value = target; $('#capPoints').value = cap; };
  syncCapRule(); $('#targetPoints').addEventListener('change', syncCapRule); $('#capPoints').addEventListener('change', syncCapRule);
  $('#sideA').addEventListener('input', updateSetupPreview); $('#sideB').addEventListener('input', updateSetupPreview); $('#teamColorA').addEventListener('input', updateTeamColors); $('#teamColorB').addEventListener('input', updateTeamColors);
  $('#setupForm').addEventListener('submit', (event) => { event.preventDefault(); applySetupValues(); showView('studio'); setConnection('ready', 'พร้อมถ่ายทอด'); ensureSignal(); });
  $('#openCameraButton').addEventListener('click', openCamera); $('#cameraToggle').addEventListener('click', () => state.stream.running ? toast('หยุดไลฟ์ก่อนปิดกล้อง') : (state.stream.camera ? closeCamera() : openCamera())); $('#micToggle').addEventListener('click', toggleMic);
  $('#addA').addEventListener('click', () => addPoint('A')); $('#addB').addEventListener('click', () => addPoint('B')); $('#minusA').addEventListener('click', () => subtractPoint('A')); $('#minusB').addEventListener('click', () => subtractPoint('B')); $('#undoButton').addEventListener('click', undo); $('#resetButton').addEventListener('click', resetGame); $('#nextGameButton').addEventListener('click', nextGame);
  $('#destinationButton').addEventListener('click', openObsInfo); $('#closeModal').addEventListener('click', closeObsInfo); $('#cancelModal').addEventListener('click', closeObsInfo); $('#saveDestinations').addEventListener('click', copyObsUrl); $('#startLiveButton').addEventListener('click', startLive); $('#backToSetup').addEventListener('click', () => { if (state.stream.running) return toast('หยุดไลฟ์ก่อนกลับไปแก้ค่าการแข่ง'); showView('setup'); });
  $('#helpButton').addEventListener('click', () => { $('#helpModal').hidden = false; }); $('#closeHelp').addEventListener('click', () => { $('#helpModal').hidden = true; }); $('#helpModal').addEventListener('click', (event) => { if (event.target.id === 'helpModal') event.currentTarget.hidden = true; }); $('#renameButton').addEventListener('click', () => { showView('setup'); toast('แก้ชื่อคู่แข่งที่หน้า setup แล้วสร้างห้องใหม่'); });
  window.addEventListener('keydown', (event) => { if (event.key === 'Escape') { ['helpModal', 'destinationModal'].forEach(id => { const modal = $('#' + id); if (modal) modal.hidden = true; }); } }); window.addEventListener('beforeunload', () => { state.stream.signal?.leave(); closeCamera(); });
})();
