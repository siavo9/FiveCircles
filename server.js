const express = require('express');
const path = require('path');
const fs = require('fs');
const compression = require('compression');
const crypto = require('crypto');

const app = express();

// ── Gzip/Brotli compression for faster page loads (SEO ranking factor) ──
app.use(compression());

// ── JSON middleware for parsing request bodies ──
app.use(express.json());

// ── Security & SEO headers ──
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

// ─────────────────────────────────────────────────────────────────────────
//  First-Solver Leaderboard (Eastern Time)
//  In-memory store keyed by EST date string. The puzzle day rolls over at
//  midnight in America/New_York. A best-effort JSON file backup keeps data
//  across restarts on environments with a writable filesystem.
// ─────────────────────────────────────────────────────────────────────────

const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'first-solvers.json');

/** @type {Map<string, {name: string|null, time: number, guesses: number, solvedAt: string, claimToken: string}>} */
const firstSolvers = new Map();

function loadFromDisk() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      for (const [date, entry] of Object.entries(parsed)) {
        firstSolvers.set(date, entry);
      }
    }
  } catch (err) {
    console.warn('Could not load first-solvers from disk:', err.message);
  }
}

function saveToDisk() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    const obj = Object.fromEntries(firstSolvers.entries());
    fs.writeFileSync(DATA_FILE, JSON.stringify(obj, null, 2));
  } catch (err) {
    // Filesystem may be read-only (e.g. some serverless platforms). Skip silently.
  }
}

loadFromDisk();

// ── Get current date in America/New_York as YYYY-MM-DD ──
function getEstDateString(d = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit'
  });
  const parts = fmt.formatToParts(d);
  const get = (t) => parts.find(p => p.type === t).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

// ── Get current time in America/New_York as HH:MM:SS (24h) ──
function getEstTimeString(d = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  });
  const parts = fmt.formatToParts(d);
  const get = (t) => parts.find(p => p.type === t).value;
  return `${get('hour')}:${get('minute')}:${get('second')}`;
}

function generateSeedFromDate(dateString) {
  const hash = crypto.createHash('sha256').update(dateString).digest();
  return Math.abs(hash.readInt32BE(0));
}

function isValidName(name) {
  if (!name || typeof name !== 'string') return false;
  if (name.length < 1 || name.length > 7) return false;
  return /^[a-zA-Z0-9]+$/.test(name);
}

// Trim store to most recent 30 days so it doesn't grow forever.
function pruneOld() {
  const keys = [...firstSolvers.keys()].sort();
  const keep = 30;
  if (keys.length > keep) {
    for (const k of keys.slice(0, keys.length - keep)) firstSolvers.delete(k);
  }
}

// ── API: GET /api/daily-seed (EST-aligned) ──
app.get('/api/daily-seed', (req, res) => {
  const today = getEstDateString();
  const seed = generateSeedFromDate(today);
  res.json({ date: today, seed });
});

// ── API: GET /api/first-solvers (last 10 days, newest first) ──
app.get('/api/first-solvers', (req, res) => {
  pruneOld();
  const sorted = [...firstSolvers.keys()].sort().reverse().slice(0, 10);
  const entries = sorted.map(date => {
    const e = firstSolvers.get(date);
    return {
      date,
      name: e.name,
      time: e.time,
      guesses: e.guesses,
      solvedAt: e.solvedAt,
      solvedAtEst: getEstTimeString(new Date(e.solvedAt))
    };
  });
  res.json({ entries });
});

// ── API: GET /api/first-solver/today ──
app.get('/api/first-solver/today', (req, res) => {
  const today = getEstDateString();
  const e = firstSolvers.get(today);
  if (!e) return res.json({ date: today, claimed: false });
  res.json({
    date: today,
    claimed: true,
    entry: {
      name: e.name,
      time: e.time,
      guesses: e.guesses,
      solvedAt: e.solvedAt,
      solvedAtEst: getEstTimeString(new Date(e.solvedAt))
    }
  });
});

// ── API: POST /api/first-solver/claim ──
//  Body: { time: number, guesses: number }
//  Atomically claims today's first-solver slot and returns a token used to
//  later set the player's name. If already claimed, returns 409 with the
//  current entry.
app.post('/api/first-solver/claim', (req, res) => {
  const { time, guesses } = req.body || {};
  const today = getEstDateString();

  if (typeof time !== 'number' || time <= 0 || time > 86400) {
    return res.status(400).json({ success: false, message: 'Invalid time' });
  }
  if (!Number.isInteger(guesses) || guesses < 1 || guesses > 10) {
    return res.status(400).json({ success: false, message: 'Invalid guesses' });
  }

  if (firstSolvers.has(today)) {
    const e = firstSolvers.get(today);
    return res.status(409).json({
      success: false,
      message: 'Already claimed for today',
      entry: {
        name: e.name,
        time: e.time,
        guesses: e.guesses,
        solvedAt: e.solvedAt,
        solvedAtEst: getEstTimeString(new Date(e.solvedAt))
      }
    });
  }

  const claimToken = crypto.randomBytes(16).toString('hex');
  const entry = {
    name: null,
    time,
    guesses,
    solvedAt: new Date().toISOString(),
    claimToken
  };
  firstSolvers.set(today, entry);
  pruneOld();
  saveToDisk();

  res.json({
    success: true,
    date: today,
    claimToken,
    solvedAtEst: getEstTimeString(new Date(entry.solvedAt))
  });
});

// ── API: POST /api/first-solver/name ──
//  Body: { name: string, claimToken: string }
//  Sets the display name for today's claimed slot. Only the holder of the
//  matching claimToken can set or update the name.
app.post('/api/first-solver/name', (req, res) => {
  const { name, claimToken } = req.body || {};
  const today = getEstDateString();

  if (!isValidName(name)) {
    return res.status(400).json({
      success: false,
      message: 'Name must be 1-7 alphanumeric characters'
    });
  }
  if (!claimToken || typeof claimToken !== 'string') {
    return res.status(400).json({ success: false, message: 'Missing claim token' });
  }

  const e = firstSolvers.get(today);
  if (!e) {
    return res.status(404).json({ success: false, message: 'No claim for today yet' });
  }
  if (e.claimToken !== claimToken) {
    return res.status(403).json({ success: false, message: 'Invalid claim token' });
  }

  e.name = name.toUpperCase();
  firstSolvers.set(today, e);
  saveToDisk();

  res.json({
    success: true,
    date: today,
    entry: {
      name: e.name,
      time: e.time,
      guesses: e.guesses,
      solvedAt: e.solvedAt,
      solvedAtEst: getEstTimeString(new Date(e.solvedAt))
    }
  });
});

// ── Static files with aggressive caching for assets ──
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '7d',
  etag: true,
  lastModified: true,
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
    }
    if (filePath.match(/\.(png|jpg|jpeg|svg|ico|woff2?|ttf)$/)) {
      res.setHeader('Cache-Control', 'public, max-age=2592000, immutable');
    }
  }
}));

// ── SPA fallback ──
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Four Circles is running on http://localhost:${PORT}`);
});
