const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, 'public');
const POLL_HOLD_MS = 20000;
const CLIENT_TIMEOUT_MS = 45000;
const MAX_ROOMS = 20;
const MAX_CLIENTS_PER_ROOM = 12;
const rooms = new Map();

// ---------- Monthly live-hours counter (estimate of TURN usage; counts every live phone, even on Wi-Fi) ----------
const USAGE_FILE = process.env.USAGE_FILE || path.join(__dirname, 'usage.json');
const USAGE_LIMIT_HOURS = Number(process.env.USAGE_LIMIT_HOURS || 650);
const monthKey = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
let usage = { month: monthKey(), seconds: 0 };
try { const saved = JSON.parse(fs.readFileSync(USAGE_FILE, 'utf8')); if (saved.month === usage.month && Number.isFinite(saved.seconds)) usage = saved; } catch {}
const liveClients = new Set();
let lastTick = Date.now();
function saveUsage() { try { fs.writeFileSync(USAGE_FILE, JSON.stringify(usage)); } catch {} }
function usageSnapshot() { const hours = usage.seconds / 3600; return { month: usage.month, hours: Math.round(hours * 100) / 100, limitHours: USAGE_LIMIT_HOURS, exceeded: hours >= USAGE_LIMIT_HOURS, live: liveClients.size }; }
setInterval(() => {
  const now = Date.now(); const elapsed = (now - lastTick) / 1000; lastTick = now;
  if (usage.month !== monthKey()) usage = { month: monthKey(), seconds: 0 };
  if (liveClients.size) { usage.seconds += elapsed * liveClients.size; saveUsage(); }
}, 10000).unref();

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

function sendJson(res, status, data, headers = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(body);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', chunk => {
      raw += chunk;
      if (raw.length > 100000) req.destroy(new Error('payload_too_large'));
    });
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(new Error('invalid_json')); }
    });
    req.on('error', reject);
  });
}

// ---------- ICE servers ----------
// STUN always. TURN (needed when the phone is on mobile data) from either:
//  - Cloudflare Realtime TURN: TURN_KEY_ID + TURN_KEY_API_TOKEN (short-lived credentials generated here)
//  - any static TURN server: TURN_URL (comma separated) + TURN_USER + TURN_PASS
let cfCache = { at: 0, servers: null };
async function cloudflareIce() {
  const id = process.env.TURN_KEY_ID, token = process.env.TURN_KEY_API_TOKEN;
  if (!id || !token) return null;
  if (cfCache.servers && Date.now() - cfCache.at < 3600 * 1000) return cfCache.servers;
  try {
    const response = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(id)}/credentials/generate-ice-servers`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ ttl: 86400 }), signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) throw new Error(`cloudflare_turn_${response.status}`);
    const data = await response.json();
    const servers = (data.iceServers || []).map(server => ({ ...server, urls: [].concat(server.urls).filter(url => !/:53(\?|$)/.test(url)) }));
    cfCache = { at: Date.now(), servers };
    return servers;
  } catch (error) { console.error('[ice] Cloudflare TURN failed:', error.message); return cfCache.servers; }
}
async function iceServers() {
  const cf = await cloudflareIce();
  if (cf?.length) return cf;
  const servers = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
  const turn = (process.env.TURN_URL || '').split(',').map(entry => entry.trim()).filter(Boolean);
  if (turn.length) servers.push({ urls: turn, username: process.env.TURN_USER || '', credential: process.env.TURN_PASS || '' });
  return servers;
}

// ---------- Signaling (long polling, no extra dependencies) ----------
const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{6,64}$/.test(value);
const validRoom = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(value);

function deliver(client, message) {
  client.queue.push(message);
  flush(client);
}

function flush(client) {
  if (!client.waiter || !client.queue.length) return;
  const res = client.waiter;
  client.waiter = null;
  clearTimeout(client.waitTimer);
  const messages = client.queue.splice(0, client.queue.length);
  sendJson(res, 200, { ok: true, messages });
}

function removeClient(roomName, id) {
  const room = rooms.get(roomName);
  const client = room?.get(id);
  if (!client) return;
  room.delete(id);
  liveClients.delete(`${roomName}:${id}`);
  clearTimeout(client.waitTimer);
  if (client.waiter) sendJson(client.waiter, 200, { ok: true, messages: [] });
  for (const other of room.values()) deliver(other, { type: 'peer-left', from: id, data: { role: client.role } });
  if (!room.size) rooms.delete(roomName);
}

setInterval(() => {
  const now = Date.now();
  for (const [roomName, room] of rooms) {
    for (const [id, client] of room) if (now - client.lastSeen > CLIENT_TIMEOUT_MS) removeClient(roomName, id);
  }
}, 10000).unref();

async function signalJoin(req, res) {
  const body = await readJson(req);
  const { room: roomName, id, role } = body;
  if (!validRoom(roomName) || !validId(id) || !['phone', 'viewer'].includes(role)) return sendJson(res, 400, { ok: false, error: 'invalid_join' });
  let room = rooms.get(roomName);
  if (!room) {
    if (rooms.size >= MAX_ROOMS) return sendJson(res, 429, { ok: false, error: 'too_many_rooms' });
    room = new Map();
    rooms.set(roomName, room);
  }
  let client = room.get(id);
  if (!client) {
    if (room.size >= MAX_CLIENTS_PER_ROOM) return sendJson(res, 429, { ok: false, error: 'room_full' });
    client = { id, role, queue: [], waiter: null, waitTimer: null, lastSeen: Date.now() };
    const peers = [...room.values()].map(c => ({ id: c.id, role: c.role }));
    room.set(id, client);
    for (const other of room.values()) if (other.id !== id) deliver(other, { type: 'peer-joined', from: id, data: { role } });
    return sendJson(res, 200, { ok: true, peers });
  }
  client.lastSeen = Date.now();
  const peers = [...room.values()].filter(c => c.id !== id).map(c => ({ id: c.id, role: c.role }));
  return sendJson(res, 200, { ok: true, peers });
}

function signalPoll(req, res, url) {
  const roomName = url.searchParams.get('room');
  const id = url.searchParams.get('id');
  const client = validRoom(roomName) && validId(id) ? rooms.get(roomName)?.get(id) : null;
  if (!client) return sendJson(res, 404, { ok: false, error: 'not_joined' });
  client.lastSeen = Date.now();
  if (client.waiter) sendJson(client.waiter, 200, { ok: true, messages: [] });
  clearTimeout(client.waitTimer);
  client.waiter = res;
  res.on('close', () => { if (client.waiter === res) { client.waiter = null; clearTimeout(client.waitTimer); } });
  if (client.queue.length) return flush(client);
  client.waitTimer = setTimeout(() => {
    if (client.waiter !== res) return;
    client.waiter = null;
    client.lastSeen = Date.now();
    sendJson(res, 200, { ok: true, messages: [] });
  }, POLL_HOLD_MS);
}

async function signalSend(req, res) {
  const body = await readJson(req);
  const { room: roomName, id, to, type, data } = body;
  if (!validRoom(roomName) || !validId(id) || !validId(to) || typeof type !== 'string' || type.length > 30) return sendJson(res, 400, { ok: false, error: 'invalid_send' });
  const room = rooms.get(roomName);
  const sender = room?.get(id);
  if (!sender) return sendJson(res, 404, { ok: false, error: 'not_joined' });
  sender.lastSeen = Date.now();
  const target = room.get(to);
  if (!target) return sendJson(res, 404, { ok: false, error: 'peer_not_found' });
  if (sender.role === 'phone') { if (type === 'offer') liveClients.add(`${roomName}:${id}`); else if (type === 'live-stop') liveClients.delete(`${roomName}:${id}`); }
  deliver(target, { type, from: id, data });
  return sendJson(res, 200, { ok: true });
}

async function signalLeave(req, res) {
  const body = await readJson(req).catch(() => ({}));
  if (validRoom(body.room) && validId(body.id)) removeClient(body.room, body.id);
  return sendJson(res, 200, { ok: true });
}

function routeApi(req, res, url) {
  const fail = error => sendJson(res, 400, { ok: false, error: error.message || 'bad_request' });
  if (req.method === 'GET' && url.pathname === '/api/health') return sendJson(res, 200, { ok: true, service: 'shuttlecast-signal', rooms: rooms.size, turn: Boolean((process.env.TURN_KEY_ID && process.env.TURN_KEY_API_TOKEN) || process.env.TURN_URL) });
  if (req.method === 'GET' && url.pathname === '/api/ice') return iceServers().then(servers => sendJson(res, 200, { ok: true, iceServers: servers }));
  if (req.method === 'GET' && url.pathname === '/api/usage') return sendJson(res, 200, { ok: true, ...usageSnapshot() });
  if (req.method === 'POST' && url.pathname === '/api/signal/join') return signalJoin(req, res).catch(fail);
  if (req.method === 'GET' && url.pathname === '/api/signal/poll') return signalPoll(req, res, url);
  if (req.method === 'POST' && url.pathname === '/api/signal/send') return signalSend(req, res).catch(fail);
  if (req.method === 'POST' && url.pathname === '/api/signal/leave') return signalLeave(req, res);
  return false;
}

function serveStatic(req, res, url) {
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/') pathname = '/index.html';
  if (pathname === '/live') pathname = '/live.html';
  const filePath = path.normalize(path.join(PUBLIC_DIR, pathname));
  if (!filePath.startsWith(PUBLIC_DIR)) return sendJson(res, 403, { error: 'forbidden' });
  fs.readFile(filePath, (error, data) => {
    if (error) {
      if (pathname !== '/index.html') return serveStatic(req, res, new URL('/index.html', 'http://local'));
      return sendJson(res, 404, { error: 'not_found' });
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': mime[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' || ext === '.js' ? 'no-cache' : 'public, max-age=3600',
      'Permissions-Policy': 'camera=(self), microphone=(self)'
    });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname.startsWith('/api/')) {
    const handled = routeApi(req, res, url);
    if (handled !== false) return;
    return sendJson(res, 404, { ok: false, error: 'not_found' });
  }
  serveStatic(req, res, url);
});

server.listen(PORT, '0.0.0.0', () => console.log(`ShuttleCast listening on 0.0.0.0:${PORT}`));

process.on('SIGTERM', () => { saveUsage(); server.close(() => process.exit(0)); });
