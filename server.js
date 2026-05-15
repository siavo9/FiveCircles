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
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

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

function generateSeedFromDate(dateString) {
  const hash = crypto.createHash('sha256').update(dateString).digest();
  return Math.abs(hash.readInt32BE(0));
}

// ── API: GET /api/daily-seed (EST-aligned) ──
app.get('/api/daily-seed', (req, res) => {
  const today = getEstDateString();
  const seed = generateSeedFromDate(today);
  res.json({ date: today, seed });
});

// ── Clean URL for /privacy → privacy.html (matches Vercel's cleanUrls) ──
app.get('/privacy', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'privacy.html'));
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
