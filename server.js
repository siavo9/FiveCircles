const express = require('express');
const path = require('path');
const compression = require('compression');

const app = express();

// ── Gzip/Brotli compression for faster page loads (SEO ranking factor) ──
app.use(compression());

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
