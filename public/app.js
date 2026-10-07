(() => {
  const $ = (selector) => document.querySelector(selector);
  const state = {
    view: 'setup', matchTitle: 'Rally Night • Court 1', sideA: 'ทีมฟ้า', sideB: 'ทีมแดง', teamColorA: '#d3a94f', teamColorB: '#ead7aa', matchGames: 3, targetPoints: 21, capPoints: 30, winByTwo: true,
    scoreA: 0, scoreB: 0, winsA: 0, winsB: 0, game: 1, gameResults: [], history: [],
    stream: { camera: null, canvas: null, recorder: null, sessionId: null, running: false, stopping: false, uploadQueue: Promise.resolve(), micEnabled: true, quality: 'high', switching: false, consecutiveFailures: 0, successfulUploads: 0 },
    destinations: { facebook: null, youtube: null }
  };
  const QUALITY_PROFILES = { high: { label: '1080p • 6 Mbps', width: 1920, height: 1080, bitrate: 6000000 }, medium: { label: '720p • 4.5 Mbps', width: 1280, height: 720, bitrate: 4500000 }, low: { label: '720p • 2.5 Mbps', width: 1280, height: 720, bitrate: 2500000 } };
  const qualityOrder = ['high', 'medium', 'low'];
  const sponsorLogo = new Image(); sponsorLogo.src = '/the-smokery-logo.png';

  const toast = (message) => {
    const el = $('#toast'); el.textContent = message; el.classList.add('show');
    window.clearTimeout(toast.timer); toast.timer = window.setTimeout(() => el.classList.remove('show'), 2800);
  };
  async function authRequest(path, body) {
    const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(body) });
    const data = await response.json().catch(() => ({})); if (!response.ok) throw new Error(data.error || 'ดำเนินการไม่สำเร็จ'); return data;
  }
  function showAppAfterAuth() { $('#authGate').hidden = true; $('#appShell').hidden = false; document.body.classList.remove('auth-locked'); }
  function showAuthMode(setupRequired) { $('#authTitle').textContent = setupRequired ? 'ตั้งรหัสผ่านเริ่มต้น' : 'เข้าสู่ ShuttleCast'; $('#authCopy').textContent = setupRequired ? 'กำหนดรหัสผ่านผู้ควบคุมอย่างน้อย 8 ตัวอักษรเพื่อเริ่มใช้งาน' : 'ใส่รหัสผ่านเพื่อเข้าใช้งานห้องควบคุมไลฟ์'; $('.auth-confirm-label').hidden = !setupRequired; $('.auth-confirm-input').hidden = !setupRequired; $('#authSubmit').textContent = setupRequired ? 'ตั้งรหัสผ่านและเข้าใช้งาน' : 'เข้าสู่ระบบ'; $('#authPassword').value = ''; $('#authPasswordConfirm').value = ''; $('#authError').textContent = ''; $('#authForm').dataset.setupRequired = String(setupRequired); }
  async function checkAuth() { try { const response = await fetch('/api/auth/status', { credentials: 'same-origin' }); const data = await response.json(); if (data.authenticated) showAppAfterAuth(); else showAuthMode(data.setupRequired); } catch { showAuthMode(false); $('#authError').textContent = 'เชื่อมต่อระบบรักษาความปลอดภัยไม่ได้ กรุณาลองใหม่'; } }
  async function submitAuth(event) { event.preventDefault(); const setupRequired = $('#authForm').dataset.setupRequired === 'true'; const password = $('#authPassword').value; const confirm = $('#authPasswordConfirm').value; if (setupRequired && password !== confirm) return $('#authError').textContent = 'รหัสผ่านและการยืนยันไม่ตรงกัน'; try { await authRequest(setupRequired ? '/api/auth/setup' : '/api/auth/login', { password }); showAppAfterAuth(); } catch (error) { $('#authError').textContent = error.message; } }
  async function changePassword(event) { event.preventDefault(); const ownerSecret = $('#ownerSecret').value; const currentPassword = $('#currentPassword').value; const newPassword = $('#newPassword').value; if (newPassword !== $('#confirmPassword').value) return $('#changePasswordError').textContent = 'รหัสผ่านใหม่และการยืนยันไม่ตรงกัน'; try { await authRequest('/api/auth/change-password', { ownerSecret, currentPassword, newPassword }); $('#securityModal').hidden = true; $('#changePasswordForm').reset(); toast('เปลี่ยนรหัสผ่านแล้ว — Session ของผู้ใช้ทุกคนถูกออกจากระบบ'); } catch (error) { $('#changePasswordError').textContent = error.message; } }
  async function logout() { await authRequest('/api/auth/logout', {}).catch(() => {}); window.location.reload(); }
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
    updateCanvas();
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

  function drawCover(ctx, video, width, height) {
    const sourceRatio = video.videoWidth / video.videoHeight || 16 / 9; const targetRatio = width / height;
    let sx = 0, sy = 0, sw = video.videoWidth, sh = video.videoHeight;
    if (sourceRatio > targetRatio) { sw = video.videoHeight * targetRatio; sx = (video.videoWidth - sw) / 2; }
    else { sh = video.videoWidth / targetRatio; sy = (video.videoHeight - sh) / 2; }
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, width, height);
  }
  function roundedRect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.closePath(); }
  function drawScoreOverlay(ctx, width, height) {
    const scale = width / 1280; const pad = 18 * scale; const previousGames = state.gameResults.slice().reverse(); const boxW = Math.min(490 * scale, width - pad * 2); const boxH = (140 + (previousGames.length ? 28 + previousGames.length * 25 : 0)) * scale; const x = width - boxW - pad; const y = pad + 8 * scale;
    ctx.fillStyle = 'rgba(5, 10, 17, .86)'; roundedRect(ctx, x, y, boxW, boxH, 14 * scale); ctx.fill();
    ctx.strokeStyle = 'rgba(100, 241, 210, .35)'; ctx.lineWidth = 2 * scale; roundedRect(ctx, x, y, boxW, boxH, 14 * scale); ctx.stroke();
    ctx.font = `800 ${13 * scale}px system-ui`; ctx.fillStyle = '#d3a94f'; ctx.fillText('SHUTTLECAST  •  LIVE', x + 18 * scale, y + 25 * scale);
    ctx.fillStyle = state.teamColorA; ctx.beginPath(); ctx.arc(x + 22 * scale, y + 53 * scale, 5 * scale, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = state.teamColorB; ctx.beginPath(); ctx.arc(x + 22 * scale, y + 87 * scale, 5 * scale, 0, Math.PI * 2); ctx.fill();
    ctx.font = `700 ${18 * scale}px system-ui`; ctx.fillStyle = '#f5f8ff'; ctx.fillText(state.sideA, x + 36 * scale, y + 57 * scale); ctx.fillText(state.sideB, x + 36 * scale, y + 91 * scale);
    ctx.font = `800 ${31 * scale}px monospace`; ctx.fillStyle = '#fff'; ctx.fillText(String(state.scoreA).padStart(2, '0'), x + boxW - 118 * scale, y + 61 * scale); ctx.fillStyle = '#fff'; ctx.fillText(String(state.scoreB).padStart(2, '0'), x + boxW - 118 * scale, y + 95 * scale);
    const historyTop = y + 123 * scale; ctx.font = `800 ${10 * scale}px monospace`; ctx.fillStyle = 'rgba(255,255,255,.78)'; ctx.fillText(`GAME ${state.game} / ${state.matchGames}  •  ${state.winsA}-${state.winsB}`, x + 18 * scale, historyTop);
    previousGames.forEach((result, index) => { const rowY = historyTop + (20 + index * 25) * scale; ctx.font = `700 ${13 * scale}px system-ui`; ctx.fillStyle = 'rgba(255,255,255,.62)'; ctx.fillText(`GAME ${result.game}`, x + 18 * scale, rowY); ctx.font = `800 ${17 * scale}px monospace`; ctx.fillStyle = result.winner === 'A' ? '#ff7f67' : '#fff'; ctx.fillText(String(result.scoreA).padStart(2, '0'), x + boxW - 118 * scale, rowY); ctx.fillStyle = result.winner === 'B' ? '#ff7f67' : '#fff'; ctx.fillText(String(result.scoreB).padStart(2, '0'), x + boxW - 69 * scale, rowY); });
  }
  function drawSponsorOverlay(ctx, width, height) {
    if (!sponsorLogo.complete || !sponsorLogo.naturalWidth) return;
    const scale = width / 1280; const panelW = 125 * scale; const panelH = 117.5 * scale; const x = width - panelW - 18 * scale; const y = height - panelH - 18 * scale;
    ctx.fillStyle = 'rgba(0, 0, 0, .5)'; roundedRect(ctx, x, y, panelW, panelH, 6 * scale); ctx.fill();
    ctx.textAlign = 'center'; ctx.font = `600 ${6.5 * scale}px system-ui`; ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.fillText('sponsored by', x + panelW / 2, y + 11 * scale);
    const maxW = panelW - 10 * scale; const maxH = panelH - 17 * scale; const ratio = sponsorLogo.naturalWidth / sponsorLogo.naturalHeight; const logoW = Math.min(maxW, maxH * ratio); const logoH = logoW / ratio;
    ctx.drawImage(sponsorLogo, x + (panelW - logoW) / 2, y + 14.5 * scale, logoW, logoH); ctx.textAlign = 'start';
  }
  function updateCanvas() {
    const canvas = $('#broadcastCanvas'); const video = $('#cameraVideo'); if (!canvas || !video.videoWidth) return;
    const profile = QUALITY_PROFILES[state.stream.quality] || QUALITY_PROFILES.high; const width = profile.width; const height = profile.height; canvas.width = width; canvas.height = height; const ctx = canvas.getContext('2d'); drawCover(ctx, video, width, height); drawScoreOverlay(ctx, width, height); drawSponsorOverlay(ctx, width, height);
  }
  function canvasLoop() { updateCanvas(); if (state.stream.camera) requestAnimationFrame(canvasLoop); }

  async function openCamera() {
    if (state.stream.camera) return;
    if (!window.isSecureContext) return toast('กล้องต้องใช้ HTTPS — กรุณาเปิดลิงก์ Preview โดยตรงใน Chrome หรือ Safari');
    if (!navigator.mediaDevices?.getUserMedia) return toast('หน้าต่าง Preview นี้ไม่อนุญาตกล้อง — เปิดลิงก์ในเบราว์เซอร์ภายนอกแทน');
    try {
      state.stream.camera = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30, max: 30 } }, audio: true });
      const video = $('#cameraVideo'); video.srcObject = state.stream.camera; await video.play(); $('#stage').classList.add('camera-on'); $('#broadcastCanvas').style.display = 'block'; $('#cameraToggle').textContent = 'ปิดกล้อง'; $('#openCameraButton').textContent = 'กล้องพร้อมแล้ว'; setConnection('ready', 'กล้องพร้อม'); canvasLoop(); toast('เปิดกล้องแล้ว — พร้อมตรวจ scoreboard ก่อนขึ้นไลฟ์');
    } catch (error) {
      const message = error?.name === 'NotAllowedError' ? 'เบราว์เซอร์ยังไม่อนุญาตกล้อง/ไมค์ — กด Allow หรือเปิดลิงก์ใน Chrome/Safari โดยตรง' : error?.name === 'NotFoundError' ? 'ไม่พบกล้องหรือไมโครโฟนบนอุปกรณ์' : error?.name === 'NotReadableError' ? 'กล้องกำลังถูกใช้งานโดยแอปอื่น' : 'เปิดกล้องไม่ได้ — ตรวจสิทธิ์กล้องและไมโครโฟนในเบราว์เซอร์';
      toast(message); setConnection('', 'ต้องการสิทธิ์กล้อง');
    }
  }
  function closeCamera() { state.stream.camera?.getTracks().forEach(track => track.stop()); state.stream.camera = null; $('#cameraVideo').srcObject = null; $('#stage').classList.remove('camera-on'); $('#broadcastCanvas').style.display = 'none'; $('#cameraToggle').textContent = 'เปิดกล้อง'; setConnection('ready', 'พร้อมตั้งค่า'); }
  function toggleMic() { state.stream.micEnabled = !state.stream.micEnabled; state.stream.camera?.getAudioTracks().forEach(track => { track.enabled = state.stream.micEnabled; }); $('#micToggle').textContent = `ไมค์: ${state.stream.micEnabled ? 'เปิด' : 'ปิด'}`; }

  function destinationPayload() {
    const facebook = $('#facebookEnabled').checked && $('#facebookKey').value.trim() ? `${$('#facebookUrl').value.trim()}${$('#facebookKey').value.trim()}` : '';
    const youtube = $('#youtubeEnabled').checked && $('#youtubeKey').value.trim() ? `${$('#youtubeUrl').value.trim()}${$('#youtubeKey').value.trim()}` : '';
    return { facebook, youtube };
  }
  function persistDestinations() { localStorage.setItem('rallycast.destinations', JSON.stringify({ facebookEnabled: $('#facebookEnabled').checked, facebookUrl: $('#facebookUrl').value.trim(), facebookKey: $('#facebookKey').value.trim(), youtubeEnabled: $('#youtubeEnabled').checked, youtubeUrl: $('#youtubeUrl').value.trim(), youtubeKey: $('#youtubeKey').value.trim() })); }
  function loadDestinations() { try { const saved = JSON.parse(localStorage.getItem('rallycast.destinations')); if (!saved) return; if (saved.facebookUrl) $('#facebookUrl').value = saved.facebookUrl; if (saved.facebookKey) $('#facebookKey').value = saved.facebookKey; if (saved.youtubeUrl) $('#youtubeUrl').value = saved.youtubeUrl; if (saved.youtubeKey) $('#youtubeKey').value = saved.youtubeKey; if (typeof saved.facebookEnabled === 'boolean') $('#facebookEnabled').checked = saved.facebookEnabled; if (typeof saved.youtubeEnabled === 'boolean') $('#youtubeEnabled').checked = saved.youtubeEnabled; state.destinations = destinationPayload(); refreshDestinationUI(); } catch {} }
  function refreshDestinationUI() {
    const fb = Boolean(state.destinations.facebook); const yt = Boolean(state.destinations.youtube);
    setText('#facebookState', fb ? 'พร้อมส่งสัญญาณ' : 'ยังไม่ตั้งค่า'); setText('#youtubeState', yt ? 'พร้อมส่งสัญญาณ' : 'ยังไม่ตั้งค่า');
    $('#facebookLight').classList.toggle('live', fb); $('#youtubeLight').classList.toggle('live', yt);
  }
  function clearSecretFields() { $('#facebookKey').value = ''; $('#youtubeKey').value = ''; }
  function openDestinations() { $('#destinationModal').hidden = false; }
  function closeDestinations() { $('#destinationModal').hidden = true; }
  function saveDestinations() {
    const payload = destinationPayload(); if (!payload.facebook && !payload.youtube) return toast('กรุณาใส่ Stream Key อย่างน้อยหนึ่งปลายทาง');
    state.destinations = payload; persistDestinations(); refreshDestinationUI(); closeDestinations(); toast('บันทึกปลายทางไว้ในอุปกรณ์นี้แล้ว');
  }

  async function uploadChunk(sessionId, blob) { const controller = new AbortController(); const timeout = window.setTimeout(() => controller.abort(), 5000); try { const response = await fetch(`/api/stream/${sessionId}/chunk`, { method: 'POST', body: blob, headers: { 'Content-Type': 'video/webm' }, signal: controller.signal }); if (!response.ok) throw new Error('chunk_upload_failed'); } finally { window.clearTimeout(timeout); } }
  function chooseInitialQuality() { const downlink = Number(navigator.connection?.downlink); return downlink && downlink < 2.5 ? 'low' : downlink && downlink < 5 ? 'medium' : 'high'; }
  function nextLowerQuality() { const index = qualityOrder.indexOf(state.stream.quality); return qualityOrder[Math.min(qualityOrder.length - 1, index + 1)]; }
  function nextHigherQuality() { const index = qualityOrder.indexOf(state.stream.quality); return qualityOrder[Math.max(0, index - 1)]; }
  async function switchQuality(next, message) { if (!next || next === state.stream.quality || state.stream.switching || !state.stream.running) return; state.stream.switching = true; const oldRecorder = state.stream.recorder; if (oldRecorder && oldRecorder.state !== 'inactive') await new Promise(resolve => { oldRecorder.addEventListener('stop', resolve, { once: true }); oldRecorder.stop(); }); state.stream.quality = next; state.stream.consecutiveFailures = 0; state.stream.successfulUploads = 0; startRecorder(state.stream.sessionId, state.stream.canvas); toast(`${message} ปรับเป็น ${QUALITY_PROFILES[next].label}`); state.stream.switching = false; }
  function startRecorder(sessionId, composed) { const profile = QUALITY_PROFILES[state.stream.quality] || QUALITY_PROFILES.high; const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus') ? 'video/webm;codecs=vp8,opus' : 'video/webm'; const recorder = new MediaRecorder(composed, { mimeType, videoBitsPerSecond: profile.bitrate, audioBitsPerSecond: 160000 }); state.stream.recorder = recorder; recorder.ondataavailable = event => { if (!event.data.size) return; state.stream.uploadQueue = state.stream.uploadQueue.then(async () => { await uploadChunk(sessionId, event.data); state.stream.consecutiveFailures = 0; state.stream.successfulUploads += 1; if (state.stream.successfulUploads >= 15) { state.stream.successfulUploads = 0; await switchQuality(nextHigherQuality(), 'สัญญาณกลับมาปกติ'); } }).catch(async () => { state.stream.successfulUploads = 0; state.stream.consecutiveFailures += 1; if (state.stream.consecutiveFailures === 1) toast('เน็ตเริ่มช้าลง — กำลังตรวจและปรับคุณภาพ'); if (state.stream.consecutiveFailures >= 2) await switchQuality(nextLowerQuality(), 'สัญญาณไม่เสถียร'); }); }; recorder.onerror = () => toast('ตัวบันทึกวิดีโอขัดข้อง — กำลังพยายามส่งต่อ'); recorder.start(1000); }
  async function startLive() {
    if (state.stream.running) return stopLive();
    if (!state.stream.camera) await openCamera(); if (!state.stream.camera) return;
    if (!state.destinations.facebook && !state.destinations.youtube) { openDestinations(); return toast('ตั้งค่า Stream Key ก่อนเริ่มถ่ายทอดสด'); }
    let sessionId;
    try {
      const response = await fetch('/api/stream/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(state.destinations) });
      const result = await response.json(); if (!response.ok || !result.ok) return toast(result.error || 'เริ่ม relay ไม่สำเร็จ');
      sessionId = result.sessionId;
      state.stream.quality = chooseInitialQuality(); const canvas = $('#broadcastCanvas'); const composed = canvas.captureStream(30); state.stream.camera.getAudioTracks().forEach(track => { if (state.stream.micEnabled) composed.addTrack(track); });
      state.stream.canvas = composed; state.stream.sessionId = sessionId; state.stream.running = true; state.stream.stopping = false; state.stream.uploadQueue = Promise.resolve(); state.stream.consecutiveFailures = 0; state.stream.successfulUploads = 0; startRecorder(sessionId, composed); setLiveUi(true); toast(`กำลังเชื่อมต่อ ${result.targets} ปลายทาง — คุณภาพเริ่มต้น ${QUALITY_PROFILES[state.stream.quality].label}`); pollRelayStatus(sessionId);
    } catch (error) {
      if (sessionId) await fetch(`/api/stream/${sessionId}/stop`, { method: 'POST' }).catch(() => {});
      toast('เริ่มถ่ายทอดสดไม่ได้ — ตรวจ HTTPS, กล้อง และ Stream Key');
    }
  }
  async function pollRelayStatus(sessionId) {
    for (let attempt = 0; attempt < 12 && state.stream.sessionId === sessionId && state.stream.running; attempt += 1) {
      await new Promise(resolve => window.setTimeout(resolve, 1500));
      try {
        const response = await fetch(`/api/stream/${sessionId}/status`); const status = await response.json();
        if (status.lastError) { toast(`ปลายทางไม่รับสัญญาณ: ${status.lastError}`); return; }
        if (!status.running) { toast('Relay หยุดทำงาน — ตรวจ Stream Key และ Live Producer'); return; }
      } catch {}
    }
  }
  async function stopLive() {
    if (!state.stream.sessionId || state.stream.stopping) return;
    const sessionId = state.stream.sessionId; state.stream.stopping = true; state.stream.running = false;
    const recorder = state.stream.recorder;
    if (recorder && recorder.state !== 'inactive') await new Promise(resolve => { recorder.addEventListener('stop', resolve, { once: true }); recorder.stop(); });
    await state.stream.uploadQueue.catch(() => {});
    state.stream.canvas?.getTracks().forEach(track => track.stop()); state.stream.recorder = null; state.stream.canvas = null;
    await fetch(`/api/stream/${sessionId}/stop`, { method: 'POST' }).catch(() => {}); state.stream.sessionId = null; state.stream.stopping = false; setLiveUi(false); refreshDestinationUI(); toast('หยุดถ่ายทอดสดแล้ว — ค่า Stream Key ยังถูกจำไว้');
  }
  function setLiveUi(isLive) { $('#liveChip').classList.toggle('live', isLive); if ($('#onAirLabel')) $('#onAirLabel').textContent = isLive ? 'ON AIR' : 'PREVIEW'; setText('#liveChip', isLive ? '● LIVE' : '○ OFFLINE'); $('#startLiveButton').classList.toggle('active', isLive); setText('#startLiveLabel', isLive ? 'หยุดถ่ายทอดสด' : 'เริ่มถ่ายทอดสด'); setConnection(isLive ? 'live' : 'ready', isLive ? 'กำลังถ่ายทอดสด' : 'กล้องพร้อม'); }

  loadMatch(); loadDestinations(); $('#matchTitle').value = state.matchTitle || 'Rally Night • Court 1'; $('#sideA').value = state.sideA || 'ทีมฟ้า'; $('#sideB').value = state.sideB || 'ทีมแดง'; $('#teamColorA').value = state.teamColorA || '#d3a94f'; $('#teamColorB').value = state.teamColorB || '#ead7aa'; $('#matchGames').value = String(state.matchGames || 3); $('#targetPoints').value = String(state.targetPoints || 21); $('#capPoints').value = String(state.capPoints || 30); $('#winByTwo').checked = state.winByTwo !== false; updateSetupPreview();
  const syncCapRule = () => { const target = Math.max(1, Math.min(30, Number($('#targetPoints').value) || 21)); const cap = Math.max(target, Math.min(99, Number($('#capPoints').value) || 30)); $('#targetPoints').value = target; $('#capPoints').value = cap; };
  syncCapRule(); $('#targetPoints').addEventListener('change', syncCapRule); $('#capPoints').addEventListener('change', syncCapRule);
  $('#sideA').addEventListener('input', updateSetupPreview); $('#sideB').addEventListener('input', updateSetupPreview); $('#teamColorA').addEventListener('input', updateTeamColors); $('#teamColorB').addEventListener('input', updateTeamColors);
  $('#setupForm').addEventListener('submit', (event) => { event.preventDefault(); applySetupValues(); showView('studio'); setConnection('ready', 'พร้อมถ่ายทอด'); });
  $('#openCameraButton').addEventListener('click', openCamera); $('#cameraToggle').addEventListener('click', () => state.stream.running ? toast('หยุดไลฟ์ก่อนปิดกล้อง') : (state.stream.camera ? closeCamera() : openCamera())); $('#micToggle').addEventListener('click', toggleMic);
  $('#addA').addEventListener('click', () => addPoint('A')); $('#addB').addEventListener('click', () => addPoint('B')); $('#minusA').addEventListener('click', () => subtractPoint('A')); $('#minusB').addEventListener('click', () => subtractPoint('B')); $('#undoButton').addEventListener('click', undo); $('#resetButton').addEventListener('click', resetGame); $('#nextGameButton').addEventListener('click', nextGame);
  $('#destinationButton').addEventListener('click', openDestinations); $('#closeModal').addEventListener('click', closeDestinations); $('#cancelModal').addEventListener('click', closeDestinations); $('#saveDestinations').addEventListener('click', saveDestinations); $('#startLiveButton').addEventListener('click', startLive); $('#backToSetup').addEventListener('click', () => { if (state.stream.running) return toast('หยุดไลฟ์ก่อนกลับไปแก้ค่าการแข่ง'); showView('setup'); });
  $('#helpButton').addEventListener('click', () => toast('ตั้งค่าคู่แข่ง → เปิดกล้อง → ใส่ Stream Key → เริ่มถ่ายทอดสด')); $('#renameButton').addEventListener('click', () => { showView('setup'); toast('แก้ชื่อคู่แข่งที่หน้า setup แล้วสร้างห้องใหม่'); });
  $('#authForm').addEventListener('submit', submitAuth); $('#securityButton').addEventListener('click', () => { $('#changePasswordError').textContent = ''; $('#securityModal').hidden = false; }); $('#closeSecurity').addEventListener('click', () => { $('#securityModal').hidden = true; }); $('#logoutButton').addEventListener('click', logout); $('#changePasswordForm').addEventListener('submit', changePassword);
  window.addEventListener('beforeunload', () => { if (state.stream.running) navigator.sendBeacon(`/api/stream/${state.stream.sessionId}/stop`, ''); closeCamera(); });
  checkAuth();
})();
