(() => {
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}${Math.random().toString(36).slice(2)}`).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);
  const roomName = () => (new URLSearchParams(location.search).get('room') || 'main').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40) || 'main';

  function connect({ role, onMessage }) {
    const id = newId(); const room = roomName(); let closed = false;
    const post = (path, body) => fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store' });
    const join = async () => { const response = await post('/api/signal/join', { room, id, role }); const result = await response.json(); if (!response.ok || !result.ok) throw new Error(result.error || 'join_failed'); return result.peers || []; };
    async function loop() {
      let fails = 0;
      while (!closed) {
        try {
          const response = await fetch(`/api/signal/poll?room=${encodeURIComponent(room)}&id=${id}`, { cache: 'no-store' });
          if (response.status === 404) { const peers = await join(); onMessage({ type: 'rejoined', data: { peers } }); continue; }
          const result = await response.json(); fails = 0;
          for (const message of result.messages || []) onMessage(message);
        } catch { fails += 1; await sleep(Math.min(5000, 500 * fails)); }
      }
    }
    return {
      id, room,
      async start() { let peers; for (let attempt = 0; ; attempt += 1) { try { peers = await join(); break; } catch (error) { if (attempt >= 3) throw error; await sleep(800); } } loop(); return peers; },
      send(to, type, data) { return post('/api/signal/send', { room, id, to, type, data }).catch(() => {}); },
      leave() { closed = true; try { navigator.sendBeacon('/api/signal/leave', JSON.stringify({ room, id })); } catch {} }
    };
  }
  async function iceServers() { try { const response = await fetch('/api/ice', { cache: 'no-store' }); const result = await response.json(); return result.iceServers || []; } catch { return [{ urls: 'stun:stun.l.google.com:19302' }]; } }
  window.ShuttleSignal = { connect, iceServers, roomName };
})();
