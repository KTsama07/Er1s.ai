/**
 * LogService — In-memory log ring buffer + SSE broadcaster.
 *
 * Intercepts stdout/stderr writes so every console.log / console.error
 * and morgan line is captured, classified, and pushed to connected SSE
 * clients in real-time.
 */

const MAX_BUFFER = 500; // keep last 500 entries in memory
const logs = [];
const clients = new Set();

/* ─── classify a raw line into a level ─── */
function classify(raw) {
  const s = raw.toLowerCase();
  if (s.includes('error') || s.includes('fatal') || s.includes('✗') || s.includes('fail'))
    return 'error';
  if (s.includes('warn') || s.includes('⚠'))
    return 'warn';
  if (s.includes('✓') || s.includes('success') || s.includes('completed'))
    return 'success';
  if (/\b(get|post|put|delete|patch)\b/.test(s) && /\b\d{3}\b/.test(s))
    return 'http';
  if (s.includes('[queue]') || s.includes('batch') || s.includes('scan'))
    return 'system';
  return 'info';
}

/* ─── push a log entry ─── */
function push(raw, source = 'stdout') {
  // strip ANSI escape codes for clean display
  const clean = raw.replace(
    /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g,
    ''
  ).trim();
  if (!clean) return; // skip blank lines

  const entry = {
    id: Date.now() + '-' + Math.random().toString(36).slice(2, 6),
    ts: new Date().toISOString(),
    level: classify(clean),
    source,
    message: clean,
  };

  logs.push(entry);
  if (logs.length > MAX_BUFFER) logs.shift();

  // broadcast to all SSE clients
  const data = JSON.stringify(entry);
  for (const res of clients) {
    res.write(`data: ${data}\n\n`);
  }
}

/* ─── intercept stdout & stderr ─── */
function install() {
  const origStdout = process.stdout.write.bind(process.stdout);
  const origStderr = process.stderr.write.bind(process.stderr);

  process.stdout.write = function (chunk, encoding, callback) {
    const str = typeof chunk === 'string' ? chunk : chunk.toString();
    // push each line separately
    str.split('\n').forEach(line => push(line, 'stdout'));
    return origStdout(chunk, encoding, callback);
  };

  process.stderr.write = function (chunk, encoding, callback) {
    const str = typeof chunk === 'string' ? chunk : chunk.toString();
    str.split('\n').forEach(line => push(line, 'stderr'));
    return origStderr(chunk, encoding, callback);
  };
}

/* ─── SSE helpers ─── */
function addClient(res) {
  clients.add(res);
  res.on('close', () => clients.delete(res));
}

function getBuffer() {
  return logs;
}

module.exports = { install, push, addClient, getBuffer };
