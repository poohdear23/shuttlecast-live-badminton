const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');

const PORT = Number(process.env.PORT || 3000);
const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const PUBLIC_DIR = path.join(__dirname, 'public');
const sessions = new Map();

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*'
  });
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
    '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency',
    '-pix_fmt', 'yuv420p', '-g', '60', '-keyint_min', '60',
    '-c:a', 'aac', '-ar', '44100', '-b:a', '128k'
  ];
  if (targets.length === 1) args.push('-flvflags', 'no_duration_filesize', '-rtmp_live', 'live', '-f', 'flv', targets[0]);
  else args.push('-f', 'tee', makeTeeOutput(targets));
  return spawn(FFMPEG, args, { stdio: ['pipe', 'ignore', 'pipe'] });
}

function stopSession(session) {
  if (!session) return;
  session.closed = true;
  try { session.input.end(); } catch {}
  const killTimer = setTimeout(() => {
    try { session.process.kill('SIGKILL'); } catch {}
  }, 2500);
  session.process.once('close', () => clearTimeout(killTimer));
  sessions.delete(session.id);
}

function routeApi(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/api/health') {
    const ffmpeg = spawnSync(FFMPEG, ['-version'], { stdio: 'ignore' }).status === 0;
    return sendJson(res, ffmpeg ? 200 : 503, { ok: ffmpeg, service: 'rallycast-relay', ffmpeg });
  }

  if (req.method === 'POST' && url.pathname === '/api/stream/start') {
    return readJson(req).then(body => {
      const targets = [body.facebook, body.youtube].map(safeRtmpUrl).filter(Boolean);
      if (!targets.length) return sendJson(res, 400, { ok: false, error: 'ต้องมี RTMP URL อย่างน้อยหนึ่งปลายทาง' });
      if (targets.length > 2) return sendJson(res, 400, { ok: false, error: 'รองรับสูงสุดสองปลายทาง' });
      const process = startRelay(targets);
      const id = crypto.randomUUID();
      const session = { id, process, input: process.stdin, targets: targets.length, closed: false, startedAt: Date.now() };
      process.on('error', error => { session.error = error.code || 'ffmpeg_error'; session.closed = true; sessions.delete(id); });
      process.stdin.on('error', () => { session.closed = true; sessions.delete(id); });
      process.stderr.on('data', chunk => {
        const text = String(chunk).replace(/rtmps?:\/\/[^\s]+/gi, 'RTMP_TARGET').trim();
        if (/error|failed|unable|reject|denied/i.test(text)) { session.lastError = text.slice(-500); console.error(`[relay ${id}] ${text}`); }
      });
      process.on('close', () => { session.closed = true; sessions.delete(id); });
      sessions.set(id, session);
      return sendJson(res, 200, { ok: true, sessionId: id, targets: targets.length, status: 'relay_ready' });
    }).catch(error => sendJson(res, 400, { ok: false, error: error.message || 'start_failed' }));
  }

  const statusMatch = url.pathname.match(/^\/api\/stream\/([^/]+)\/status$/);
  if (req.method === 'GET' && statusMatch) {
    const session = sessions.get(statusMatch[1]);
    if (!session) return sendJson(res, 404, { ok: false, error: 'session_not_found' });
    return sendJson(res, 200, { ok: true, running: !session.closed, targets: session.targets, lastError: session.lastError || null });
  }

  const chunkMatch = url.pathname.match(/^\/api\/stream\/([^/]+)\/chunk$/);
  if (req.method === 'POST' && chunkMatch) {
    const session = sessions.get(chunkMatch[1]);
    if (!session || session.closed || !session.input.writable) return sendJson(res, 404, { ok: false, error: 'session_not_found' });
    req.on('data', chunk => { if (!session.closed) session.input.write(chunk); });
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

server.listen(PORT, '0.0.0.0', () => console.log(`RallyCast listening on 0.0.0.0:${PORT}`));

process.on('SIGTERM', () => {
  for (const session of sessions.values()) stopSession(session);
  server.close(() => process.exit(0));
});
