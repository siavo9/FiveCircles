const express = require('express');
const path = require('path');
const compression = require('compression');
const crypto = require('crypto');

const app = express();

// ── Gzip/Brotli compression for faster page loads (SEO ranking factor) ──
app.use(compression());

// ── JSON middleware for parsing request bodies ──
app.use(express.json());

// ── Security & SEO headers ──
app.use((req, res, next) => {
  // Security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

  // HSTS — tells browsers to always use HTTPS (SEO best practice)
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');

  next();
});

// ── In-memory leaderboard storage: Map<dateString, Array<entry>> ──
const leaderboards = new Map();

// ── Helper: Generate deterministic seed from date string ──
function generateSeedFromDate(dateString) {
  const hash = crypto.createHash('sha256').update(dateString).digest();
  return Math.abs(hash.readInt32BE(0));
}

// ── Helper: Get today's date in UTC as YYYY-MM-DD ──
function getTodayDate() {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const day = String(now.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// ── Helper: Validate date is today ──
function isToday(dateString) {
  return dateString === getTodayDate();
}

// ── Helper: Validate name (1-20 chars, alphanumeric + spaces) ──
function isValidName(name) {
  if (!name || typeof name !== 'string') return false;
  if (name.length < 1 || name.length > 20) return false;
  return /^[a-zA-Z0-9 ]+$/.test(name);
}

// ── Helper: Auto-cleanup entries older than 7 days ──
function cleanupOldEntries() {
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  for (const [dateStr, entries] of leaderboards.entries()) {
    // Parse date and check if older than 7 days
    const [year, month, day] = dateStr.split('-').map(Number);
    const entryDate = new Date(Date.UTC(year, month - 1, day));

    if (entryDate < sevenDaysAgo) {
      leaderboards.delete(dateStr);
    }
  }
}

// ── API: GET /api/daily-seed ──
app.get('/api/daily-seed', (req, res) => {
  const today = getTodayDate();
  const seed = generateSeedFromDate(today);
  res.json({ date: today, seed });
});

// ── API: GET /api/leaderboard/:date ──
app.get('/api/leaderboard/:date', (req, res) => {
  const { date } = req.params;

  // Validate date format (basic check: YYYY-MM-DD)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD.' });
  }

  const entries = leaderboards.get(date) || [];

  // Return top 10, sorted by time ascending
  const topEntries = entries
    .sort((a, b) => a.time - b.time)
    .slice(0, 10)
    .map((entry, index) => ({
      rank: index + 1,
      name: entry.name,
      time: entry.time,
      guesses: entry.guesses,
      timestamp: entry.timestamp
    }));

  res.json({ date, entries: topEntries });
});

// ── API: POST /api/leaderboard ──
app.post('/api/leaderboard', (req, res) => {
  const { date, name, time, guesses } = req.body;
  const today = getTodayDate();

  // Validate date is today
  if (!date || date !== today) {
    return res.status(400).json({
      success: false,
      message: `Date must be today (${today})`
    });
  }

  // Validate name
  if (!isValidName(name)) {
    return res.status(400).json({
      success: false,
      message: 'Name must be 1-20 alphanumeric characters (spaces allowed)'
    });
  }

  // Validate time
  if (typeof time !== 'number' || time <= 0) {
    return res.status(400).json({
      success: false,
      message: 'Time must be a positive number (seconds)'
    });
  }

  // Validate guesses
  if (!Number.isInteger(guesses) || guesses < 1 || guesses > 10) {
    return res.status(400).json({
      success: false,
      message: 'Guesses must be an integer between 1 and 10'
    });
  }

  // Auto-cleanup old entries
  cleanupOldEntries();

  // Get or create leaderboard for today
  if (!leaderboards.has(today)) {
    leaderboards.set(today, []);
  }

  const entries = leaderboards.get(today);

  // Check if entry qualifies for top 10
  const isBetter = entries.length < 10 || entries.some(e => time < e.time);

  if (!isBetter) {
    return res.status(400).json({
      success: false,
      message: 'Time does not qualify for leaderboard'
    });
  }

  // Add new entry
  const newEntry = {
    name,
    time,
    guesses,
    timestamp: new Date().toISOString()
  };
  entries.push(newEntry);

  // Sort by time and keep only top 10
  entries.sort((a, b) => a.time - b.time);
  const topEntries = entries.slice(0, 10);
  leaderboards.set(today, topEntries);

  // Find rank of new entry
  const rank = topEntries.findIndex(e => e.timestamp === newEntry.timestamp) + 1;

  // Return success with rank and current leaderboard
  const responseEntries = topEntries.map((entry, index) => ({
    rank: index + 1,
    name: entry.name,
    time: entry.time,
    guesses: entry.guesses,
    timestamp: entry.timestamp
  }));

  res.json({
    success: true,
    rank,
    entries: responseEntries
  });
});

// ── Static files with aggressive caching for assets ──
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '7d',                // Cache static assets for 7 days
  etag: true,                  // Enable ETag for conditional requests
  lastModified: true,          // Enable Last-Modified header
  setHeaders: (res, filePath) => {
    // HTML should not be cached long-term (so updates deploy instantly)
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
    }
    // Images, fonts, etc. can be cached aggressively
    if (filePath.match(/\.(png|jpg|jpeg|svg|ico|woff2?|ttf)$/)) {
      res.setHeader('Cache-Control', 'public, max-age=2592000, immutable'); // 30 days
    }
  }
}));

// ── SPA fallback: serve index.html for any unmatched route ──
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Four Circles is running on http://localhost:${PORT}`);
});
