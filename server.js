const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');

const PORT = Number(process.env.PORT || 3000);
const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const PUBLIC_DIR = path.join(__dirname, 'public');
const sessions = new Map();
const authSessions = new Map();
const loginFailures = new Map();
const AUTH_COOKIE = 'shuttlecast_session';
const AUTH_TTL_MS = 8 * 60 * 60 * 1000;
const PASSWORD_MIN_LENGTH = 8;
const OWNER_SECRET_CODE = process.env.SHUTTLECAST_ADMIN_SECRET || '';
const AUTH_STATE_FILE = process.env.SHUTTLECAST_AUTH_FILE || path.join(__dirname, '.shuttlecast-auth.json');
const AUDIT_LOG_FILE = process.env.SHUTTLECAST_AUDIT_FILE || path.join(__dirname, '.shuttlecast-audit.jsonl');
const MAX_RECONNECT_ATTEMPTS = 6;
const RECONNECT_BASE_DELAY_MS = 1500;
const MAX_RECONNECT_BUFFER_BYTES = 8 * 1024 * 1024;
let passwordRecord = loadPasswordRecord();

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
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers
  });
  res.end(body);
}

function writeAudit(event, details = {}) {
  const entry = { timestamp: new Date().toISOString(), event, ...details };
  try { fs.appendFileSync(AUDIT_LOG_FILE, `${JSON.stringify(entry)}\n`, { encoding: 'utf8', mode: 0o600 }); } catch (error) { console.error(`[audit] could not write log: ${error.message}`); }
}
function requestFingerprint(req) { return crypto.createHash('sha256').update(req.socket.remoteAddress || 'unknown').digest('hex').slice(0, 12); }
function auditRequest(req, event, details = {}) { writeAudit(event, { ipHash: requestFingerprint(req), ...details }); }
function auditSession(session, event, details = {}) { writeAudit(event, { ipHash: session.ipHash, ...details }); }

function createPasswordRecord(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  return { salt, hash: crypto.scryptSync(password, salt, 64).toString('hex') };
}
function loadPasswordRecord() {
  if (process.env.SHUTTLECAST_ADMIN_PASSWORD) return createPasswordRecord(process.env.SHUTTLECAST_ADMIN_PASSWORD);
  try { const record = JSON.parse(fs.readFileSync(AUTH_STATE_FILE, 'utf8')); if (record?.salt && record?.hash) return record; } catch {}
  return null;
}
function savePasswordRecord() {
  if (process.env.SHUTTLECAST_ADMIN_PASSWORD) return;
  try { fs.writeFileSync(AUTH_STATE_FILE, JSON.stringify(passwordRecord), { encoding: 'utf8', mode: 0o600 }); } catch (error) { console.error(`[auth] could not persist password hash: ${error.message}`); }
}
function verifyPassword(password, record) {
  if (!record || typeof password !== 'string') return false;
  const expected = Buffer.from(record.hash, 'hex');
  const actual = crypto.scryptSync(password, record.salt, expected.length);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}
function verifyOwnerSecret(secret) {
  if (typeof secret !== 'string') return false;
  const expected = Buffer.from(OWNER_SECRET_CODE, 'utf8');
  const actual = Buffer.from(secret, 'utf8');
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}
function validPassword(password) { return typeof password === 'string' && password.length >= PASSWORD_MIN_LENGTH && password.length <= 128; }
function parseCookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').map(part => part.trim().split('=')) .filter(pair => pair.length === 2).map(([key, ...value]) => [key, decodeURIComponent(value.join('='))]));
}
function currentAuthSession(req) {
  const token = parseCookies(req)[AUTH_COOKIE]; const session = token && authSessions.get(token);
  if (!session) return null;
  if (session.expiresAt <= Date.now()) { authSessions.delete(token); return null; }
  return { token, ...session };
}
function setAuthCookie(res, token) { res.setHeader('Set-Cookie', `${AUTH_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=${AUTH_TTL_MS / 1000}`); }
function clearAuthCookie(res) { res.setHeader('Set-Cookie', `${AUTH_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=0`); }
function issueAuthSession(res) { const token = crypto.randomBytes(32).toString('hex'); authSessions.set(token, { createdAt: Date.now(), expiresAt: Date.now() + AUTH_TTL_MS }); setAuthCookie(res, token); }
function loginRateLimited(req) { const ip = req.socket.remoteAddress || 'unknown'; const record = loginFailures.get(ip); if (!record || record.resetAt <= Date.now()) return false; return record.count >= 5; }
function registerLoginFailure(req) { const ip = req.socket.remoteAddress || 'unknown'; const record = loginFailures.get(ip); if (!record || record.resetAt <= Date.now()) loginFailures.set(ip, { count: 1, resetAt: Date.now() + 15 * 60 * 1000 }); else record.count += 1; }
function clearLoginFailures(req) { loginFailures.delete(req.socket.remoteAddress || 'unknown'); }

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

function safeRtmpUrl(value) {
  if (typeof value !== 'string') return '';
  const url = value.trim();
  if (!/^rtmps?:\/\//i.test(url)) return '';
  if (url.length > 600 || /[\r\n]/.test(url)) return '';
  return url;
}

function makeTeeOutput(targets) {
  return targets.map(url => `[f=flv:onfail=ignore]${url}`).join('|');
}

function startRelay(targets) {
  const args = [
    '-hide_banner', '-loglevel', 'warning',
    '-f', 'webm', '-i', 'pipe:0',
    '-map', '0:v:0', '-map', '0:a:0?',
    '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency', '-b:v', '6000k', '-maxrate', '6000k', '-bufsize', '12000k',
    '-profile:v', 'high', '-level:v', '4.1', '-pix_fmt', 'yuv420p', '-r', '30', '-g', '60', '-keyint_min', '60',
    '-c:a', 'aac', '-ar', '44100', '-b:a', '160k'
  ];
  if (targets.length === 1) args.push('-flvflags', 'no_duration_filesize', '-rtmp_live', 'live', '-f', 'flv', targets[0]);
  else args.push('-f', 'tee', makeTeeOutput(targets));
  return spawn(FFMPEG, args, { stdio: ['pipe', 'ignore', 'pipe'] });
}

function flushRelayBuffer(session) {
  while (session.pendingChunks.length && session.process?.stdin?.writable) {
    const chunk = session.pendingChunks.shift();
    session.pendingBytes -= chunk.length;
    session.process.stdin.write(chunk);
  }
}

function scheduleRelayReconnect(session, reason) {
  if (session.closed || session.reconnectTimer || session.failed) return;
  if (session.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    session.failed = true;
    session.reconnecting = false;
    session.lastError = 'FFmpeg relay reconnect attempts exhausted';
    auditSession(session, 'stream_reconnect_exhausted', { sessionId: session.id, attempts: session.reconnectAttempts });
    return;
  }
  const attempt = session.reconnectAttempts + 1;
  const delay = Math.min(30000, RECONNECT_BASE_DELAY_MS * (2 ** (attempt - 1)));
  session.reconnectAttempts = attempt;
  session.reconnecting = true;
  session.lastError = reason;
  auditSession(session, 'stream_reconnect_scheduled', { sessionId: session.id, attempt, delayMs: delay, reason });
  session.reconnectTimer = setTimeout(() => {
    session.reconnectTimer = null;
    if (!session.closed) launchRelay(session, true);
  }, delay);
}

function launchRelay(session, isReconnect = false) {
  if (session.closed) return;
  const relay = startRelay(session.targetUrls);
  session.process = relay;
  session.input = relay.stdin;
  session.reconnecting = false;
  session.failed = false;
  let handledExit = false;
  const handleRelayFailure = (reason) => {
    if (handledExit || session.closed) return;
    handledExit = true;
    session.lastError = reason;
    scheduleRelayReconnect(session, reason);
  };
  relay.on('error', error => handleRelayFailure(error.code || 'ffmpeg_error'));
  relay.stdin.on('error', error => handleRelayFailure(error.code || 'relay_input_error'));
  relay.stderr.on('data', chunk => {
    const text = String(chunk).replace(/rtmps?:\/\/[^\s]+/gi, 'RTMP_TARGET').trim();
    if (/error|failed|unable|reject|denied/i.test(text)) { session.lastError = text.slice(-500); console.error(`[relay ${session.id}] ${text}`); }
  });
  relay.on('close', (code, signal) => {
    if (session.closed) return;
    const reason = session.lastError || `ffmpeg_exit_${code ?? 'unknown'}${signal ? `_${signal}` : ''}`;
    handleRelayFailure(reason);
  });
  if (isReconnect) auditSession(session, 'stream_reconnect_started', { sessionId: session.id, attempt: session.reconnectAttempts });
  clearTimeout(session.stableTimer);
  session.stableTimer = setTimeout(() => { session.reconnectAttempts = 0; }, 10000);
  flushRelayBuffer(session);
}

function stopSession(session) {
  if (!session) return;
  session.closed = true;
  session.reconnecting = false;
  clearTimeout(session.reconnectTimer);
  clearTimeout(session.stableTimer);
  try { session.input.end(); } catch {}
  const killTimer = setTimeout(() => {
    try { session.process.kill('SIGKILL'); } catch {}
  }, 2500);
  session.process?.once('close', () => clearTimeout(killTimer));
  sessions.delete(session.id);
  auditSession(session, 'stream_stopped', { sessionId: session.id });
}

function writeRelayChunk(session, chunk) {
  if (session.process?.stdin?.writable && !session.reconnecting) return session.process.stdin.write(chunk);
  const buffered = Buffer.from(chunk);
  session.pendingChunks.push(buffered);
  session.pendingBytes += buffered.length;
  while (session.pendingBytes > MAX_RECONNECT_BUFFER_BYTES && session.pendingChunks.length) {
    session.pendingBytes -= session.pendingChunks.shift().length;
    session.bufferDrops = (session.bufferDrops || 0) + 1;
  }
  return true;
}


function routeApi(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/api/auth/status') {
    return sendJson(res, 200, { ok: true, setupRequired: !passwordRecord, authenticated: Boolean(currentAuthSession(req)) });
  }
  if (req.method === 'POST' && url.pathname === '/api/auth/setup') {
    return readJson(req).then(body => {
      if (passwordRecord) return sendJson(res, 409, { ok: false, error: 'ตั้งรหัสผ่านแล้ว กรุณาเข้าสู่ระบบ' });
      if (!validPassword(body.password)) return sendJson(res, 400, { ok: false, error: `รหัสผ่านต้องมี ${PASSWORD_MIN_LENGTH}-${128} ตัวอักษร` });
      passwordRecord = createPasswordRecord(body.password); savePasswordRecord(); issueAuthSession(res); auditRequest(req, 'auth_setup_completed'); return sendJson(res, 200, { ok: true, authenticated: true });
    }).catch(error => sendJson(res, 400, { ok: false, error: error.message || 'setup_failed' }));
  }
  if (req.method === 'POST' && url.pathname === '/api/auth/login') {
    return readJson(req).then(body => {
      if (loginRateLimited(req)) { auditRequest(req, 'auth_login_rate_limited'); return sendJson(res, 429, { ok: false, error: 'ลองรหัสผ่านผิดหลายครั้ง กรุณารอ 15 นาที' }); }
      if (!passwordRecord || !verifyPassword(body.password, passwordRecord)) { registerLoginFailure(req); auditRequest(req, 'auth_login_failed'); return sendJson(res, 401, { ok: false, error: 'รหัสผ่านไม่ถูกต้อง' }); }
      clearLoginFailures(req); issueAuthSession(res); auditRequest(req, 'auth_login_succeeded'); return sendJson(res, 200, { ok: true, authenticated: true });
    }).catch(error => sendJson(res, 400, { ok: false, error: error.message || 'login_failed' }));
  }
  if (req.method === 'POST' && url.pathname === '/api/auth/logout') {
    const token = currentAuthSession(req)?.token; if (token) authSessions.delete(token); clearAuthCookie(res); auditRequest(req, 'auth_logout'); return sendJson(res, 200, { ok: true });
  }
  if (req.method === 'POST' && url.pathname === '/api/auth/change-password') {
    if (!currentAuthSession(req)) return sendJson(res, 401, { ok: false, error: 'ต้องเข้าสู่ระบบก่อน' });
    return readJson(req).then(body => {
      if (!verifyOwnerSecret(body.ownerSecret)) { auditRequest(req, 'auth_password_change_secret_failed'); return sendJson(res, 403, { ok: false, error: 'Secret Code ยืนยันความเป็นเจ้าของไม่ถูกต้อง' }); }
      if (!validPassword(body.newPassword)) return sendJson(res, 400, { ok: false, error: `รหัสผ่านใหม่ต้องมี ${PASSWORD_MIN_LENGTH}-${128} ตัวอักษร` });
      passwordRecord = createPasswordRecord(body.newPassword); savePasswordRecord(); authSessions.clear(); issueAuthSession(res); auditRequest(req, 'auth_password_changed'); return sendJson(res, 200, { ok: true, authenticated: true });
    }).catch(error => sendJson(res, 400, { ok: false, error: error.message || 'change_password_failed' }));
  }
  if (req.method === 'POST' && url.pathname === '/api/auth/reset-password') {
    return readJson(req).then(body => {
      if (!verifyOwnerSecret(body.ownerSecret)) { auditRequest(req, 'auth_password_reset_secret_failed'); return sendJson(res, 403, { ok: false, error: 'Secret Code ผู้ดูแลระบบไม่ถูกต้อง' }); }
      if (!validPassword(body.newPassword)) return sendJson(res, 400, { ok: false, error: `รหัสผ่านใหม่ต้องมี ${PASSWORD_MIN_LENGTH}-${128} ตัวอักษร` });
      passwordRecord = createPasswordRecord(body.newPassword); savePasswordRecord(); authSessions.clear(); issueAuthSession(res); auditRequest(req, 'auth_password_reset'); return sendJson(res, 200, { ok: true, authenticated: true });
    }).catch(error => sendJson(res, 400, { ok: false, error: error.message || 'reset_password_failed' }));
  }
  if (req.method === 'GET' && url.pathname === '/api/health') {
    const ffmpeg = spawnSync(FFMPEG, ['-version'], { stdio: 'ignore' }).status === 0;
    return sendJson(res, ffmpeg ? 200 : 503, { ok: ffmpeg, service: 'shuttlecast-relay', ffmpeg });
  }

  if (url.pathname.startsWith('/api/stream/') && !currentAuthSession(req)) return sendJson(res, 401, { ok: false, error: 'ต้องเข้าสู่ระบบก่อนใช้งานสตรีม' });

  if (req.method === 'POST' && url.pathname === '/api/stream/start') {
    return readJson(req).then(body => {
      const targets = [body.facebook, body.youtube].map(safeRtmpUrl).filter(Boolean);
      if (!targets.length) return sendJson(res, 400, { ok: false, error: 'ต้องมี RTMP URL อย่างน้อยหนึ่งปลายทาง' });
      if (targets.length > 2) return sendJson(res, 400, { ok: false, error: 'รองรับสูงสุดสองปลายทาง' });
      const id = crypto.randomUUID();
      const session = { id, targetUrls: targets, targets: targets.length, closed: false, failed: false, reconnecting: false, reconnectAttempts: 0, pendingChunks: [], pendingBytes: 0, startedAt: Date.now(), ipHash: requestFingerprint(req) };
      launchRelay(session);
      sessions.set(id, session);
      auditRequest(req, 'stream_started', { sessionId: id, targets: targets.length });
      return sendJson(res, 200, { ok: true, sessionId: id, targets: targets.length, status: 'relay_ready' });
    }).catch(error => sendJson(res, 400, { ok: false, error: error.message || 'start_failed' }));
  }

  const statusMatch = url.pathname.match(/^\/api\/stream\/([^/]+)\/status$/);
  if (req.method === 'GET' && statusMatch) {
    const session = sessions.get(statusMatch[1]);
    if (!session) return sendJson(res, 404, { ok: false, error: 'session_not_found' });
    return sendJson(res, 200, { ok: true, running: !session.closed && !session.failed && !session.reconnecting, reconnecting: session.reconnecting, failed: session.failed, reconnectAttempts: session.reconnectAttempts, bufferedBytes: session.pendingBytes, bufferDrops: session.bufferDrops || 0, targets: session.targets, lastError: session.failed ? session.lastError || null : null });
  }

  const chunkMatch = url.pathname.match(/^\/api\/stream\/([^/]+)\/chunk$/);
  if (req.method === 'POST' && chunkMatch) {
    const session = sessions.get(chunkMatch[1]);
    if (!session || session.closed) return sendJson(res, 404, { ok: false, error: 'session_not_found' });
    if (session.failed) return sendJson(res, 503, { ok: false, error: 'relay_reconnect_failed' });
    req.on('data', chunk => { if (!session.closed) writeRelayChunk(session, chunk); });
    req.on('end', () => sendJson(res, 200, { ok: true }));
    req.on('error', () => { stopSession(session); });
    return;
  }

  const stopMatch = url.pathname.match(/^\/api\/stream\/([^/]+)\/stop$/);
  if (req.method === 'POST' && stopMatch) {
    const session = sessions.get(stopMatch[1]);
    if (session) stopSession(session);
    return sendJson(res, 200, { ok: true });
  }

  return false;
}

function serveStatic(req, res, url) {
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/') pathname = '/index.html';
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
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600',
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
  }
  serveStatic(req, res, url);
});

server.listen(PORT, '0.0.0.0', () => console.log(`ShuttleCast listening on 0.0.0.0:${PORT}`));

process.on('SIGTERM', () => {
  for (const session of sessions.values()) stopSession(session);
  server.close(() => process.exit(0));
});
