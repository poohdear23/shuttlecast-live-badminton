(() => {
  const $ = (selector) => document.querySelector(selector);
  const state = {
    view: 'setup', matchTitle: 'Rally Night • Court 1', sideA: 'ทีมฟ้า', sideB: 'ทีมแดง', teamColorA: '#d3a94f', teamColorB: '#ead7aa', matchGames: 3, targetPoints: 21, capPoints: 30, winByTwo: true,
    scoreA: 0, scoreB: 0, winsA: 0, winsB: 0, game: 1, gameResults: [], history: [],
    stream: { camera: null, canvas: null, recorder: null, sessionId: null, generation: 0, running: false, stopping: false, uploadQueue: Promise.resolve(), micEnabled: true, quality: 'high', switching: false, consecutiveFailures: 0, pendingUploads: 0 },
    destinations: { facebook: null, youtube: null }
  };
  const QUALITY_PROFILES = { high: { label: '1080p • 6 Mbps', width: 1920, height: 1080, bitrate: 6000000 }, medium: { label: '720p • 4.5 Mbps', width: 1280, height: 720, bitrate: 4500000 }, low: { label: '720p • 2.5 Mbps', width: 1280, height: 720, bitrate: 2500000 } };
  const qualityOrder = ['high', 'medium', 'low'];
  const userAgent = navigator.userAgent;
  const isMobile = navigator.userAgentData?.mobile ?? /Android|iPhone|iPad|Mobile/i.test(userAgent);
  const inAppBrowser = /FBAN|FBAV|FB_IAB|Instagram|Line\/|MicroMessenger|HeyTapBrowser|OppoBrowser|; wv\)/i.test(userAgent);
  const audioConstraints = { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 };
  function videoConstraints(deviceId) {
    const size = isMobile ? { width: { ideal: 1280 }, height: { ideal: 720 } } : { width: { ideal: 1920 }, height: { ideal: 1080 } };
    return { ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: 'environment' } }), ...size, aspectRatio: { ideal: 16 / 9 }, frameRate: { ideal: 30, max: 30 } };
  }
  const sponsorLogo = new Image(); sponsorLogo.src = '/the-smokery-logo.png';

  const toast = (message, duration = 2800) => {
    const el = $('#toast'); el.textContent = message; el.classList.add('show');
    window.clearTimeout(toast.timer); toast.timer = window.setTimeout(() => el.classList.remove('show'), duration);
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
    const profile = QUALITY_PROFILES[state.stream.quality] || QUALITY_PROFILES.high; const width = profile.width; const height = profile.height;
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    if (!canvasContext) canvasContext = canvas.getContext('2d', { alpha: false });
    const ctx = canvasContext; drawCover(ctx, video, width, height); drawScoreOverlay(ctx, width, height); drawSponsorOverlay(ctx, width, height);
    const portrait = video.videoHeight > video.videoWidth;
    if (portrait !== lastPortrait) { lastPortrait = portrait; $('#stage').classList.toggle('portrait-frame', portrait); }
  }
  let canvasContext = null; let lastPortrait = null;
  let lastCanvasFrame = 0; let canvasLoopActive = false;
  // Phones like the Reno 14 run at 90/120Hz; the 4ms tolerance keeps a steady 30fps instead of dropping to ~24fps.
  const CANVAS_FRAME_INTERVAL = 1000 / 30 - 4;
  function canvasLoop() {
    if (canvasLoopActive) return; canvasLoopActive = true;
    const tick = (timestamp) => {
      if (!state.stream.camera) { canvasLoopActive = false; return; }
      if (timestamp - lastCanvasFrame >= CANVAS_FRAME_INTERVAL) { updateCanvas(); lastCanvasFrame = timestamp; }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  let wakeLock = null;
  async function requestWakeLock() {
    if (!('wakeLock' in navigator) || wakeLock || document.visibilityState !== 'visible' || !state.stream.camera) return;
    try { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); } catch {}
  }
  function releaseWakeLock() { wakeLock?.release().catch(() => {}); wakeLock = null; }

  function watchTrack(track) { track.addEventListener('ended', () => { if (state.stream.camera && document.visibilityState === 'visible') recoverCamera(); }); }
  async function attachVideoTrack(deviceId) {
    const camera = state.stream.camera;
    camera.getVideoTracks().forEach(track => { camera.removeTrack(track); track.stop(); });
    // Many Android phones cannot open a second lens while the first is active, so the old track is stopped first.
    const fresh = await navigator.mediaDevices.getUserMedia({ video: videoConstraints(deviceId), audio: false });
    const track = fresh.getVideoTracks()[0]; camera.addTrack(track); watchTrack(track);
    state.stream.deviceId = track.getSettings().deviceId || deviceId;
    const video = $('#cameraVideo'); video.srcObject = null; video.srcObject = camera; await video.play().catch(() => {});
    return track;
  }
  async function switchCamera() {
    if (!state.stream.camera || state.stream.switchingCamera) return toast('เปิดกล้องก่อนสลับเลนส์');
    state.stream.switchingCamera = true; const previous = state.stream.deviceId;
    try {
      const cameras = (await navigator.mediaDevices.enumerateDevices()).filter(device => device.kind === 'videoinput');
      if (cameras.length < 2) return toast('อุปกรณ์นี้มีกล้องให้เลือกเพียงตัวเดียว');
      const index = cameras.findIndex(device => device.deviceId === previous); const nextIndex = (index + 1) % cameras.length; const next = cameras[nextIndex];
      await attachVideoTrack(next.deviceId); toast(`ใช้กล้อง: ${next.label || `กล้อง ${nextIndex + 1}`}`);
    } catch {
      await attachVideoTrack(previous).catch(() => {}); toast('สลับกล้องไม่สำเร็จ — กลับไปใช้กล้องเดิม');
    } finally { state.stream.switchingCamera = false; }
  }
  async function recoverCamera() {
    const camera = state.stream.camera; if (!camera || state.stream.recoveringCamera) return;
    state.stream.recoveringCamera = true; let recovered = false;
    try {
      const videoTrack = camera.getVideoTracks()[0];
      if (!videoTrack || videoTrack.readyState === 'ended') { await attachVideoTrack(state.stream.deviceId); recovered = true; }
      const audioTrack = camera.getAudioTracks()[0];
      if (audioTrack && audioTrack.readyState === 'ended') {
        const fresh = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints, video: false });
        const newAudio = fresh.getAudioTracks()[0]; newAudio.enabled = state.stream.micEnabled; watchTrack(newAudio);
        camera.removeTrack(audioTrack); camera.addTrack(newAudio);
        const composed = state.stream.canvas;
        if (composed) { composed.getAudioTracks().forEach(track => composed.removeTrack(track)); composed.addTrack(newAudio); }
        recovered = true;
        if (state.stream.running) await restartCapture(state.stream.quality, 'ไมค์ถูกตัดระหว่างพักแอป — เชื่อมต่อใหม่');
      }
      if (recovered) toast('กู้กล้อง/ไมค์กลับมาแล้ว');
    } catch { toast('กู้กล้องไม่สำเร็จ — กดปิดแล้วเปิดกล้องใหม่', 5000); }
    finally { state.stream.recoveringCamera = false; }
  }
  async function toggleLandscape() {
    try {
      if (document.fullscreenElement) { screen.orientation?.unlock?.(); await document.exitFullscreen(); return; }
      if (!document.documentElement.requestFullscreen) return toast('เบราว์เซอร์นี้ไม่รองรับเต็มจอ — หมุนมือถือเป็นแนวนอนเอง');
      await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
      await screen.orientation?.lock?.('landscape').catch(() => toast('หมุนมือถือเป็นแนวนอนเอง และปิดล็อกการหมุนจอ'));
    } catch { toast('เปิดโหมดเต็มจอไม่ได้ — หมุนมือถือเป็นแนวนอนเอง'); }
  }

  async function openCamera() {
    if (state.stream.camera) return;
    if (!window.isSecureContext) return toast('กล้องต้องใช้ HTTPS — กรุณาเปิดลิงก์ Preview โดยตรงใน Chrome หรือ Safari');
    if (!navigator.mediaDevices?.getUserMedia) return toast('หน้าต่าง Preview นี้ไม่อนุญาตกล้อง — เปิดลิงก์ในเบราว์เซอร์ภายนอกแทน');
    try {
      state.stream.camera = await navigator.mediaDevices.getUserMedia({ video: videoConstraints(), audio: audioConstraints });
      state.stream.camera.getTracks().forEach(track => { if (track.kind === 'audio') track.enabled = state.stream.micEnabled; watchTrack(track); });
      state.stream.deviceId = state.stream.camera.getVideoTracks()[0]?.getSettings().deviceId || null;
      const hasAudio = state.stream.camera.getAudioTracks().some(track => track.readyState === 'live');
      const video = $('#cameraVideo'); video.srcObject = state.stream.camera; await video.play(); requestWakeLock(); $('#stage').classList.add('camera-on'); $('#broadcastCanvas').style.display = 'block'; $('#cameraToggle').textContent = 'ปิดกล้อง'; $('#openCameraButton').textContent = 'กล้องพร้อมแล้ว'; setConnection('ready', hasAudio ? 'กล้องและไมค์พร้อม' : 'ไม่พบไมค์'); canvasLoop(); toast(hasAudio ? 'เปิดกล้องและไมค์แล้ว — พร้อมตรวจ scoreboard ก่อนขึ้นไลฟ์' : 'เปิดกล้องแล้ว แต่ไม่พบไมโครโฟน — Live จะไม่มีเสียง');
    } catch (error) {
      const message = error?.name === 'NotAllowedError' ? 'เบราว์เซอร์ยังไม่อนุญาตกล้อง/ไมค์ — กด Allow หรือเปิดลิงก์ใน Chrome/Safari โดยตรง' : error?.name === 'NotFoundError' ? 'ไม่พบกล้องหรือไมโครโฟนบนอุปกรณ์' : error?.name === 'NotReadableError' ? 'กล้องกำลังถูกใช้งานโดยแอปอื่น' : 'เปิดกล้องไม่ได้ — ตรวจสิทธิ์กล้องและไมโครโฟนในเบราว์เซอร์';
      toast(message); setConnection('', 'ต้องการสิทธิ์กล้อง');
    }
  }
  function closeCamera() { releaseWakeLock(); state.stream.camera?.getTracks().forEach(track => track.stop()); state.stream.camera = null; $('#cameraVideo').srcObject = null; $('#stage').classList.remove('camera-on'); $('#broadcastCanvas').style.display = 'none'; $('#cameraToggle').textContent = 'เปิดกล้อง'; setConnection('ready', 'พร้อมตั้งค่า'); }
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

  const MAX_CHUNK_ATTEMPTS = 4;
  const MAX_PENDING_UPLOADS = 8;
  const wait = ms => new Promise(resolve => window.setTimeout(resolve, ms));
  function streamError(code) { const error = new Error(code); error.code = code; return error; }
  async function uploadChunk(sessionId, blob, generation, seq) {
    let lastError = streamError('chunk_upload_failed');
    for (let attempt = 0; attempt < MAX_CHUNK_ATTEMPTS; attempt += 1) {
      if (generation !== state.stream.generation || !state.stream.running) return;
      const controller = new AbortController(); const timeout = window.setTimeout(() => controller.abort(), 10000);
      try {
        const response = await fetch(`/api/stream/${sessionId}/chunk`, { method: 'POST', body: blob, cache: 'no-store', headers: { 'Content-Type': 'video/webm', 'X-Stream-Generation': String(generation), 'X-Chunk-Seq': String(seq) }, signal: controller.signal });
        if (response.ok) return;
        if (response.status === 409) throw streamError('stale');
        if (response.status === 404) throw streamError('session_not_found');
        if (response.status === 503) throw streamError('relay_failed');
        lastError = streamError(`chunk_http_${response.status}`);
      } catch (error) {
        if (['stale', 'session_not_found', 'relay_failed'].includes(error.code)) throw error;
        lastError = error;
      } finally { window.clearTimeout(timeout); }
      await wait(500 * (attempt + 1));
    }
    throw lastError;
  }
  function chooseInitialQuality() {
    const downlink = Number(navigator.connection?.downlink);
    if (downlink && downlink < 4) return 'low';
    // Phones overheat and throttle when composing + encoding 1080p for a whole match, so they start at 720p.
    if (isMobile || (downlink && downlink < 8)) return 'medium';
    return 'high';
  }
  function nextLowerQuality() { const index = qualityOrder.indexOf(state.stream.quality); return qualityOrder[Math.min(qualityOrder.length - 1, index + 1)]; }
  async function restartCapture(nextQuality, message) {
    if (!state.stream.running || state.stream.switching) return false;
    const sessionId = state.stream.sessionId; state.stream.switching = true; state.stream.generation += 1;
    const oldRecorder = state.stream.recorder;
    if (oldRecorder && oldRecorder.state !== 'inactive') await new Promise(resolve => { oldRecorder.addEventListener('stop', resolve, { once: true }); oldRecorder.stop(); });
    await state.stream.uploadQueue.catch(() => {});
    try {
      const quality = nextQuality || state.stream.quality;
      const response = await fetch(`/api/stream/${sessionId}/restart`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ videoBitrate: QUALITY_PROFILES[quality].bitrate }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) throw new Error(result.error || 'relay_restart_failed');
      state.stream.quality = quality; state.stream.consecutiveFailures = 0; state.stream.pendingUploads = 0; state.stream.uploadQueue = Promise.resolve();
      startRecorder(sessionId, state.stream.canvas); toast(`${message} ใช้ ${QUALITY_PROFILES[state.stream.quality].label}`); return true;
    } catch {
      state.stream.running = false; await fetch(`/api/stream/${sessionId}/stop`, { method: 'POST' }).catch(() => {}); state.stream.sessionId = null; setLiveUi(false); toast('เชื่อมต่อ relay ใหม่ไม่สำเร็จ — กรุณาเริ่มถ่ายทอดสดใหม่'); return false;
    } finally { state.stream.switching = false; }
  }
  function pickRecorderMime() {
    const vp8 = ['video/webm;codecs=vp8,opus', 'video/webm;codecs=vp8', 'video/webm'];
    // Android Chrome encodes H.264 on the hardware encoder (cooler, steadier fps); the server re-encodes to H.264 for RTMP anyway.
    const candidates = isMobile && !state.stream.forceVp8 ? ['video/webm;codecs=h264,opus', 'video/webm;codecs=h264', ...vp8] : vp8;
    return candidates.find(type => MediaRecorder.isTypeSupported(type)) || '';
  }
  function startRecorder(sessionId, composed) {
    const generation = state.stream.generation; const profile = QUALITY_PROFILES[state.stream.quality] || QUALITY_PROFILES.high; const mimeType = pickRecorderMime();
    const options = { videoBitsPerSecond: profile.bitrate, audioBitsPerSecond: 128000 }; if (mimeType) options.mimeType = mimeType;
    const recorder = new MediaRecorder(composed, options); state.stream.recorder = recorder; let seq = 0;
    recorder.ondataavailable = event => {
      if (!event.data.size || generation !== state.stream.generation || !state.stream.running) return;
      const chunk = event.data; const chunkSeq = seq; seq += 1; state.stream.pendingUploads += 1;
      if (state.stream.pendingUploads > MAX_PENDING_UPLOADS && !state.stream.switching) { restartCapture(nextLowerQuality(), 'อัปโหลดไม่ทันสัญญาณ — ลดคุณภาพ'); return; }
      state.stream.uploadQueue = state.stream.uploadQueue.then(async () => {
        if (generation !== state.stream.generation || !state.stream.running) return;
        await uploadChunk(sessionId, chunk, generation, chunkSeq); state.stream.consecutiveFailures = 0;
      }).catch(async error => {
        if (generation !== state.stream.generation || !state.stream.running) return;
        if (error?.code === 'stale' || error?.code === 'relay_failed') return;
        state.stream.consecutiveFailures += 1;
        // A dropped chunk corrupts the WebM stream FFmpeg is reading, so a clean restart is required.
        await restartCapture(nextLowerQuality(), 'เน็ตไม่เสถียร — เชื่อมต่อใหม่และลดคุณภาพ');
      }).finally(() => { if (generation === state.stream.generation) state.stream.pendingUploads = Math.max(0, state.stream.pendingUploads - 1); });
    };
    recorder.onerror = () => { if (generation !== state.stream.generation) return; if (/h264/.test(mimeType)) state.stream.forceVp8 = true; restartCapture(state.stream.quality, 'ตัวบันทึกวิดีโอขัดข้อง — เริ่มใหม่'); };
    recorder.start(1000);
  }
  async function startLive() {
    if (state.stream.running) return stopLive();
    if (!state.stream.camera) await openCamera(); if (!state.stream.camera) return;
    if (!state.destinations.facebook && !state.destinations.youtube) { openDestinations(); return toast('ตั้งค่า Stream Key ก่อนเริ่มถ่ายทอดสด'); }
    const health = await fetch('/api/health', { cache: 'no-store' }).then(response => response.json()).catch(() => null);
    if (!health?.ffmpeg) return toast('เซิร์ฟเวอร์ไม่มี FFmpeg — ต้องรันด้วย Docker/Node server ที่ติดตั้ง FFmpeg (Vercel serverless ส่ง RTMP ไม่ได้)');
    let sessionId;
    try {
      state.stream.quality = chooseInitialQuality(); state.stream.generation = 0;
      const composed = $('#broadcastCanvas').captureStream(30);
      state.stream.camera.getAudioTracks().forEach(track => { if (track.readyState === 'live') composed.addTrack(track); });
      const hasAudio = composed.getAudioTracks().length > 0;
      const response = await fetch('/api/stream/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...state.destinations, hasAudio, videoBitrate: QUALITY_PROFILES[state.stream.quality].bitrate }) });
      const result = await response.json(); if (!response.ok || !result.ok) { composed.getVideoTracks().forEach(track => track.stop()); return toast(result.error || 'เริ่ม relay ไม่สำเร็จ'); }
      sessionId = result.sessionId;
      state.stream.canvas = composed; state.stream.sessionId = sessionId; state.stream.running = true; state.stream.stopping = false; state.stream.uploadQueue = Promise.resolve(); state.stream.consecutiveFailures = 0; state.stream.pendingUploads = 0;
      startRecorder(sessionId, composed); setLiveUi(true); setConnection('live', 'กำลังเชื่อมต่อปลายทาง…');
      toast(`กำลังเชื่อมต่อ ${result.targets} ปลายทาง — ${QUALITY_PROFILES[state.stream.quality].label}${hasAudio ? '' : ' (ไม่มีไมค์ ส่งเสียงเงียบแทน)'}`); pollRelayStatus(sessionId); requestWakeLock();
      navigator.getBattery?.().then(battery => { if (!battery.charging && battery.level < 0.4) window.setTimeout(() => toast(`แบตเหลือ ${Math.round(battery.level * 100)}% — เสียบชาร์จก่อนไลฟ์ยาว`, 5000), 3200); }).catch(() => {});
    } catch (error) {
      if (sessionId) await fetch(`/api/stream/${sessionId}/stop`, { method: 'POST' }).catch(() => {});
      toast('เริ่มถ่ายทอดสดไม่ได้ — ตรวจ HTTPS, กล้อง และ Stream Key');
    }
  }
  async function pollRelayStatus(sessionId) {
    let wasSending = false; let stallWarned = false; let lastBytes = 0; let lastAt = Date.now();
    while (state.stream.sessionId === sessionId && state.stream.running) {
      await wait(2000);
      try {
        const response = await fetch(`/api/stream/${sessionId}/status`, { cache: 'no-store' });
        if (response.status === 404) { toast('Relay ไม่พบเซสชัน — กรุณาเริ่มถ่ายทอดสดใหม่'); return; }
        const status = await response.json();
        if (status.failed) {
          wasSending = false; stallWarned = false;
          const reason = String(status.lastError || '');
          if (/ffmpeg_not_installed/.test(reason)) { toast('เซิร์ฟเวอร์ไม่มี FFmpeg — หยุดถ่ายทอดสด'); await stopLive(); return; }
          if (/401|403|denied|unauthori|forbidden/i.test(reason)) toast('ปลายทางปฏิเสธ Stream Key — ตรวจคีย์ใน Facebook Live Producer');
          const recovered = await restartCapture(state.stream.quality, 'การเชื่อมต่อปลายทางหลุด — กำลังเชื่อมต่อใหม่'); if (!recovered) return; continue;
        }
        const now = Date.now(); const kbps = Math.max(0, Math.round(((status.bytesOut - lastBytes) * 8) / Math.max(1, now - lastAt))); lastBytes = status.bytesOut; lastAt = now;
        if (status.sending) {
          if (!wasSending) toast('ส่งสัญญาณถึงปลายทางแล้ว — ตรวจภาพใน Facebook Live Producer');
          wasSending = true; stallWarned = false; setConnection('live', `กำลังส่ง ${kbps} kbps`);
        } else if (!stallWarned && status.relayAgeSec >= 12) {
          stallWarned = true; wasSending = false; setConnection('live', 'ยังไม่มีข้อมูลออกจาก relay');
          toast(status.lastWarning ? `Relay: ${status.lastWarning.slice(0, 140)}` : 'ยังไม่มีข้อมูลส่งออก — ตรวจเน็ตและ Stream Key');
        }
      } catch {}
    }
  }
  async function stopLive() {
    if (!state.stream.sessionId || state.stream.stopping) return;
    const sessionId = state.stream.sessionId; state.stream.stopping = true; state.stream.running = false; state.stream.generation += 1;
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
  $('#helpButton').addEventListener('click', () => { $('#helpModal').hidden = false; }); $('#closeHelp').addEventListener('click', () => { $('#helpModal').hidden = true; }); $('#helpModal').addEventListener('click', (event) => { if (event.target.id === 'helpModal') event.currentTarget.hidden = true; }); $('#renameButton').addEventListener('click', () => { showView('setup'); toast('แก้ชื่อคู่แข่งที่หน้า setup แล้วสร้างห้องใหม่'); });
  window.addEventListener('keydown', (event) => { if (event.key === 'Escape') { ['helpModal', 'destinationModal'].forEach(id => { const modal = $('#' + id); if (modal) modal.hidden = true; }); } });
  $('#switchCameraButton').addEventListener('click', switchCamera); $('#fullscreenButton').addEventListener('click', toggleLandscape);
  document.addEventListener('fullscreenchange', () => setText('#fullscreenButton', document.fullscreenElement ? 'ออกจากเต็มจอ' : 'เต็มจอแนวนอน'));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { if (state.stream.running) state.stream.hiddenAt = Date.now(); return; }
    requestWakeLock();
    if (state.stream.camera) { $('#cameraVideo').play().catch(() => {}); recoverCamera(); }
    if (state.stream.hiddenAt) { state.stream.hiddenAt = 0; if (state.stream.running) toast('แอปถูกพักระหว่างไลฟ์ — ภาพอาจค้างช่วงนั้น อย่าสลับแอปหรือล็อกจอ', 5000); }
  });
  window.addEventListener('beforeunload', (event) => { if (state.stream.running) { event.preventDefault(); event.returnValue = ''; } });
  window.addEventListener('pagehide', (event) => { if (event.persisted) return; if (state.stream.running) navigator.sendBeacon(`/api/stream/${state.stream.sessionId}/stop`, ''); closeCamera(); });
  if (inAppBrowser) window.setTimeout(() => toast('แนะนำเปิดลิงก์นี้ใน Chrome — เบราว์เซอร์ในแอป (Facebook/LINE/HeyTap) มักใช้กล้องและไลฟ์ไม่เสถียร', 7000), 600);
})();
