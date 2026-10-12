(() => {
  const W = 1280, H = 720;
  const canvas = document.getElementById('out'); const ctx = canvas.getContext('2d');
  const video = document.getElementById('rx'); const hud = document.getElementById('hud'); const audioBtn = document.getElementById('audioBtn');
  if (new URLSearchParams(location.search).get('clean') === '1') document.body.classList.add('clean');

  let score = null, pc = null, phoneId = null, remoteReady = false, pendingIce = [], hudTimer = 0, ice = [];
  const signal = ShuttleSignal.connect({ role: 'viewer', onMessage: handleMessage });

  function setHud(text, ok) { hud.textContent = text; hud.classList.toggle('ok', Boolean(ok)); hud.classList.remove('hide'); clearTimeout(hudTimer); if (ok) hudTimer = setTimeout(() => hud.classList.add('hide'), 3000); }

  function closePc(message) {
    if (pc) { pc.onconnectionstatechange = null; pc.ontrack = null; pc.ondatachannel = null; pc.onicecandidate = null; try { pc.close(); } catch {} }
    pc = null; phoneId = null; remoteReady = false; pendingIce = []; score = null; video.srcObject = null; audioBtn.style.display = 'none';
    setHud(message || 'รอสัญญาณจากมือถือ…', false);
  }

  async function tryUnmute() { try { video.muted = false; await video.play(); audioBtn.style.display = 'none'; } catch { video.muted = true; try { await video.play(); } catch {} audioBtn.style.display = 'block'; } }
  audioBtn.addEventListener('click', tryUnmute);

  function createPc(from) {
    closePc('กำลังเชื่อมต่อกับมือถือ…');
    phoneId = from; pc = new RTCPeerConnection({ iceServers: ice });
    const current = pc;
    pc.onicecandidate = event => { if (event.candidate && pc === current) signal.send(from, 'ice', event.candidate.toJSON()); };
    pc.ontrack = event => { video.srcObject = event.streams[0] || new MediaStream([event.track]); tryUnmute(); };
    pc.ondatachannel = event => { event.channel.onmessage = message => { try { const data = JSON.parse(message.data); if (data.t === 'score') score = data.s; } catch {} }; };
    pc.onconnectionstatechange = () => {
      if (pc !== current) return;
      if (pc.connectionState === 'connected') setHud('เชื่อมต่อมือถือแล้ว', true);
      else if (pc.connectionState === 'connecting') setHud('กำลังเชื่อมต่อกับมือถือ…', false);
      else if (['failed', 'disconnected'].includes(pc.connectionState)) { setHud('สัญญาณมือถือหลุด — รอเชื่อมต่อใหม่…', false); if (pc.connectionState === 'failed') closePc('สัญญาณมือถือหลุด — รอเชื่อมต่อใหม่…'); }
      else if (pc.connectionState === 'closed') setHud('รอสัญญาณจากมือถือ…', false);
    };
    return pc;
  }

  async function handleMessage(message) {
    const { type, from, data } = message;
    try {
      if (type === 'offer') {
        const connection = createPc(from);
        await connection.setRemoteDescription({ type: 'offer', sdp: data.sdp }); remoteReady = true;
        for (const candidate of pendingIce.splice(0)) await connection.addIceCandidate(candidate).catch(() => {});
        const answer = await connection.createAnswer(); await connection.setLocalDescription(answer);
        signal.send(from, 'answer', { sdp: answer.sdp });
      } else if (type === 'ice' && from === phoneId) {
        if (pc && remoteReady) await pc.addIceCandidate(data).catch(() => {}); else pendingIce.push(data);
      } else if ((type === 'live-stop' || type === 'peer-left') && from === phoneId) {
        closePc('รอสัญญาณจากมือถือ…');
      }
    } catch (error) { console.error('[viewer]', error); }
  }

  let last = 0;
  function loop(timestamp) { if (timestamp - last >= 1000 / 30) { last = timestamp; ShuttleOverlay.drawFrame(ctx, video, W, H, score); } requestAnimationFrame(loop); }
  requestAnimationFrame(loop);

  (async () => {
    ice = await ShuttleSignal.iceServers();
    try { await signal.start(); setHud('รอสัญญาณจากมือถือ…', false); } catch { setHud('ติดต่อ server ไม่ได้ — ตรวจว่า node server.js ยังเปิดอยู่', false); }
  })();
  window.addEventListener('beforeunload', () => signal.leave());
})();
