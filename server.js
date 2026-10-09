const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');

const PORT = Number(process.env.PORT || 3000);
const FFMPEG = resolveFfmpeg();

function resolveFfmpeg() {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  if (spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0) return 'ffmpeg';
  try {
    const bundled = require('ffmpeg-static');
    if (bundled && fs.existsSync(bundled)) return bundled;
  } catch {}
  return 'ffmpeg';
}
const PUBLIC_DIR = path.join(__dirname, 'public');
const sessions = new Map();
const AUDIT_LOG_FILE = process.env.SHUTTLECAST_AUDIT_FILE || path.join(__dirname, '.shuttlecast-audit.jsonl');
const MAX_RECONNECT_ATTEMPTS = 6;
const RECONNECT_BASE_DELAY_MS = 1500;
const MAX_RECONNECT_BUFFER_BYTES = 8 * 1024 * 1024;
const MAX_CHUNK_BYTES = 16 * 1024 * 1024;
const DEFAULT_VIDEO_KBPS = 4500;

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
  return targets.map(url => `[f=flv:flvflags=no_duration_filesize:onfail=ignore]${url}`).join('|');
}

function sanitizeRelayLog(text) {
  return String(text)
    .replace(/rtmps?:\/\/[^\s'"]*facebook[^\s'"]*/gi, 'FACEBOOK_TARGET')
    .replace(/rtmps?:\/\/[^\s'"]*youtube[^\s'"]*/gi, 'YOUTUBE_TARGET')
    .replace(/rtmps?:\/\/[^\s'"]+/gi, 'RTMP_TARGET')
    .trim();
}

function clampKbps(value) {
  const kbps = Math.round(Number(value) / 1000);
  if (!Number.isFinite(kbps) || kbps <= 0) return DEFAULT_VIDEO_KBPS;
  return Math.max(1000, Math.min(6000, kbps));
}

function startRelay(session) {
  const targets = session.targetUrls;
  const kbps = session.videoKbps;
  const args = [
    '-hide_banner', '-loglevel', 'warning', '-nostats', '-progress', 'pipe:1', '-stats_period', '1',
    '-thread_queue_size', '1024', '-fflags', '+genpts', '-f', 'webm', '-i', 'pipe:0'
  ];
  // Facebook Live rejects video-only streams, so inject silence when the browser has no mic track.
  if (!session.hasAudio) args.push('-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100');
  args.push(
    '-map', '0:v:0', '-map', session.hasAudio ? '0:a:0' : '1:a:0',
    '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency',
    '-b:v', `${kbps}k`, '-maxrate', `${kbps}k`, '-bufsize', `${kbps * 2}k`,
    '-profile:v', 'high', '-level:v', '4.1', '-pix_fmt', 'yuv420p',
    '-fps_mode', 'cfr', '-r', '30', '-g', '60', '-keyint_min', '60', '-sc_threshold', '0',
    '-force_key_frames', 'expr:gte(t,n_forced*2)',
    '-c:a', 'aac', '-ar', '44100', '-ac', '2', '-b:a', '128k',
    // Required for the tee muxer: FLV outputs need H.264/AAC extradata in the stream header.
    '-flags', '+global_header', '-max_muxing_queue_size', '1024'
  );
  if (!session.hasAudio) args.push('-shortest');
  if (targets.length === 1) args.push('-f', 'flv', '-flvflags', 'no_duration_filesize', targets[0]);
  else args.push('-f', 'tee', makeTeeOutput(targets));
  return spawn(FFMPEG, args, { stdio: ['pipe', 'pipe', 'pipe'] });
}

function flushRelayBuffer(session) {
  while (session.pendingChunks.length && session.process?.stdin?.writable) {
    const chunk = session.pendingChunks.shift();
    session.pendingBytes -= chunk.length;
    session.process.stdin.write(chunk);
  }
}

function scheduleRelayReconnect(session, reason) {
  if (session.closed || session.restarting || session.failed) return;
  session.failed = true;
  session.reconnecting = false;
  session.lastError = reason;
  auditSession(session, 'stream_relay_failed', { sessionId: session.id, reason });
}

function launchRelay(session, isReconnect = false) {
  if (session.closed) return;
  const relay = startRelay(session);
  session.process = relay;
  session.input = relay.stdin;
  session.reconnecting = false;
  session.failed = false;
  session.relayStartedAt = Date.now();
  session.lastProgressAt = 0;
  session.outTimeSec = 0;
  let handledExit = false;
  const handleRelayFailure = (reason) => {
    if (handledExit || session.closed || session.restarting) return;
    handledExit = true;
    session.lastError = reason;
    scheduleRelayReconnect(session, reason);
  };
  relay.on('error', error => handleRelayFailure(error.code === 'ENOENT' ? 'ffmpeg_not_installed' : error.code || 'ffmpeg_error'));
  relay.stdin.on('error', error => handleRelayFailure(error.code || 'relay_input_error'));
  let progressBuffer = '';
  relay.stdout.setEncoding('utf8');
  relay.stdout.on('data', text => {
    progressBuffer += text;
    const lines = progressBuffer.split('\n');
    progressBuffer = lines.pop();
    for (const line of lines) {
      const [key, value] = line.trim().split('=');
      if (key === 'total_size') { const size = Number(value); if (Number.isFinite(size)) session.bytesOut = size; }
      if (key === 'out_time_us' || key === 'out_time_ms') {
        const seconds = Number(value) / 1e6;
        if (Number.isFinite(seconds) && seconds > session.outTimeSec) { session.outTimeSec = seconds; session.lastProgressAt = Date.now(); }
      }
    }
  });
  relay.stderr.on('data', chunk => {
    const text = sanitizeRelayLog(chunk);
    if (!text) return;
    session.logTail = `${session.logTail || ''}\n${text}`.slice(-800);
    if (/error|failed|unable|reject|denied|refused|timed out|broken pipe|i\/o error/i.test(text)) { session.lastWarning = text.slice(-400); console.error(`[relay ${session.id}] ${text}`); }
  });
  relay.on('close', (code, signal) => {
    if (session.closed) return;
    const reason = session.lastWarning || `ffmpeg_exit_${code ?? 'unknown'}${signal ? `_${signal}` : ''}`;
    handleRelayFailure(reason);
  });
  if (isReconnect) auditSession(session, 'stream_reconnect_started', { sessionId: session.id, attempt: session.restartAttempts });
  clearTimeout(session.stableTimer);
  session.stableTimer = setTimeout(() => { session.reconnectAttempts = 0; session.restartAttempts = 0; }, 30000);
  flushRelayBuffer(session);
}

function restartRelay(session, videoBitrate) {
  return new Promise(resolve => {
    if (!session || session.closed || session.restarting || session.restartAttempts >= MAX_RECONNECT_ATTEMPTS) return resolve(false);
    session.restarting = true;
    session.restartAttempts += 1;
    session.reconnecting = true;
    session.failed = false;
    session.lastError = null;
    session.lastWarning = null;
    session.generation += 1;
    session.lastSeq = -1;
    if (videoBitrate) session.videoKbps = clampKbps(videoBitrate);
    session.pendingChunks = [];
    session.pendingBytes = 0;
    const previous = session.process;
    let started = false;
    const start = () => {
      if (started || session.closed) return;
      started = true;
      session.restarting = false;
      session.reconnecting = false;
      launchRelay(session, true);
      resolve(true);
    };
    if (!previous || previous.exitCode !== null) return start();
    previous.once('close', start);
    try { previous.stdin.destroy(); } catch {}
    try { previous.kill('SIGTERM'); } catch {}
    setTimeout(start, 700);
  });
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
  if (req.method === 'GET' && url.pathname === '/api/health') {
    const ffmpeg = spawnSync(FFMPEG, ['-version'], { stdio: 'ignore' }).status === 0;
    return sendJson(res, ffmpeg ? 200 : 503, { ok: ffmpeg, service: 'shuttlecast-relay', ffmpeg });
  }

  if (req.method === 'POST' && url.pathname === '/api/stream/start') {
    return readJson(req).then(body => {
      const targets = [body.facebook, body.youtube].map(safeRtmpUrl).filter(Boolean);
      if (!targets.length) return sendJson(res, 400, { ok: false, error: 'ต้องมี RTMP URL อย่างน้อยหนึ่งปลายทาง' });
      if (targets.length > 2) return sendJson(res, 400, { ok: false, error: 'รองรับสูงสุดสองปลายทาง' });
      const id = crypto.randomUUID();
      const session = { id, targetUrls: targets, targets: targets.length, hasAudio: body.hasAudio !== false, videoKbps: clampKbps(body.videoBitrate), lastSeq: -1, bytesOut: 0, outTimeSec: 0, lastProgressAt: 0, closed: false, failed: false, restarting: false, reconnecting: false, reconnectAttempts: 0, restartAttempts: 0, generation: 0, pendingChunks: [], pendingBytes: 0, startedAt: Date.now(), ipHash: requestFingerprint(req) };
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
    const now = Date.now();
    return sendJson(res, 200, { ok: true, running: !session.closed && !session.failed && !session.reconnecting, sending: Boolean(session.lastProgressAt) && now - session.lastProgressAt < 5000, bytesOut: session.bytesOut || 0, outTimeSec: Math.round(session.outTimeSec || 0), relayAgeSec: Math.round((now - (session.relayStartedAt || now)) / 1000), reconnecting: session.reconnecting, failed: session.failed, reconnectAttempts: session.restartAttempts, bufferedBytes: session.pendingBytes, bufferDrops: session.bufferDrops || 0, targets: session.targets, hasAudio: session.hasAudio, videoKbps: session.videoKbps, lastError: session.failed ? session.lastError || null : null, lastWarning: session.lastWarning || null });
  }

  const restartMatch = url.pathname.match(/^\/api\/stream\/([^/]+)\/restart$/);
  if (req.method === 'POST' && restartMatch) {
    const session = sessions.get(restartMatch[1]);
    if (!session || session.closed) return sendJson(res, 404, { ok: false, error: 'session_not_found' });
    return readJson(req).catch(() => ({})).then(body => restartRelay(session, body.videoBitrate)).then(ok => sendJson(res, ok ? 200 : 409, { ok, generation: session.generation, error: ok ? undefined : 'relay_restart_limit' }));
  }

  const chunkMatch = url.pathname.match(/^\/api\/stream\/([^/]+)\/chunk$/);
  if (req.method === 'POST' && chunkMatch) {
    const session = sessions.get(chunkMatch[1]);
    if (!session || session.closed) return sendJson(res, 404, { ok: false, error: 'session_not_found' });
    if (session.failed) return sendJson(res, 503, { ok: false, error: 'relay_reconnect_failed' });
    const generation = Number(req.headers['x-stream-generation'] ?? 0);
    if (!Number.isInteger(generation) || generation !== session.generation) {
      req.on('data', () => {});
      req.on('end', () => sendJson(res, 409, { ok: false, error: 'stale_stream_chunk' }));
      return;
    }
    const seq = Number(req.headers['x-chunk-seq']);
    const parts = [];
    let size = 0;
    let tooLarge = false;
    req.on('data', chunk => { size += chunk.length; if (size > MAX_CHUNK_BYTES) { tooLarge = true; return; } parts.push(chunk); });
    req.on('error', () => {});
    req.on('end', () => {
      if (tooLarge) return sendJson(res, 413, { ok: false, error: 'chunk_too_large' });
      if (session.closed) return sendJson(res, 404, { ok: false, error: 'session_not_found' });
      if (generation !== session.generation) return sendJson(res, 409, { ok: false, error: 'stale_stream_chunk' });
      // Retried uploads reuse the same sequence number; never write the same bytes twice into the WebM stream.
      if (Number.isInteger(seq) && seq <= session.lastSeq) return sendJson(res, 200, { ok: true, duplicate: true });
      if (Number.isInteger(seq)) session.lastSeq = seq;
      const flushed = writeRelayChunk(session, Buffer.concat(parts));
      const stdin = session.process?.stdin;
      if (flushed !== false || !stdin) return sendJson(res, 200, { ok: true });
      let replied = false;
      const reply = () => { if (replied) return; replied = true; sendJson(res, 200, { ok: true, backpressure: true }); };
      stdin.once('drain', reply);
      setTimeout(reply, 3000);
    });
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
