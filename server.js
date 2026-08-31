import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import compression from 'compression';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

// Enable gzip/deflate compression for all text/json/asset responses
app.use(compression());

// Performance and standard security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
});

// Explicit route aliases for HTML pages
app.get(['/payment', '/payment.html', '/Payment', '/Payment.html'], (req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(__dirname, 'Payment.html'));
});

app.get(['/order', '/order.html', '/Order', '/Order.html'], (req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(__dirname, 'order.html'));
});

app.get(['/admin', '/admin.html', '/Admin', '/Admin.html'], (req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(__dirname, 'admin.html'));
});

app.get(['/events', '/events.html', '/Events', '/Events.html'], (req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(__dirname, 'events.html'));
});

app.get(['/event-order', '/event-order.html', '/Event-Order', '/Event-Order.html'], (req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(__dirname, 'event-order.html'));
});

app.get(['/', '/index.html'], (req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Serve static assets with caching headers for non-HTML files
app.use(express.static(__dirname, {
  maxAge: '1h',
  etag: true,
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache');
    } else if (filePath.endsWith('.ttf') || filePath.endsWith('.woff2') || filePath.endsWith('.woff')) {
      res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
    } else {
      res.setHeader('Cache-Control', 'public, max-age=3600');
    }
  }
}));

// Fallback to index.html
app.get('*', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Artisan Oven server running on http://0.0.0.0:${PORT}`);
});

