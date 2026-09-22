import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import compression from 'compression';
import fs from 'fs/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

// Remove Express fingerprinting header
app.disable('x-powered-by');

// Enable gzip/deflate compression for all text/json/asset responses
app.use(compression());

// Performance and standard security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// Guard: Prevent static exposure of server-side code, secrets, configurations, and repository docs
const FORBIDDEN_FILE_PATTERNS = [
  /^\./, // Hidden files (.env, .git, .clasp.json, etc.)
  /\.(gs|ts|env|bak|config|lock|log|md)$/i, // Backend scripts, config, logs, markdown
  /^(server\.js|package\.json|package-lock\.json|metadata\.json|apps-script\.js)$/i, // Specific backend files
];

app.use((req, res, next) => {
  const normalizedPath = path.normalize(req.path).replace(/^(\.\.[\/\\])+/, '');
  const basename = path.basename(normalizedPath);

  if (
    normalizedPath.startsWith('/apps-script') ||
    FORBIDDEN_FILE_PATTERNS.some((pattern) => pattern.test(basename))
  ) {
    return res.status(404).end();
  }
  next();
});

// Health check endpoint for container lifecycle
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// --- High-Speed In-Memory Status Cache & Proxy ---
const UPSTREAM_API_URL = process.env.ORDER_API_URL || "https://script.google.com/macros/s/AKfycbwIZ9GTLcelcZUdXuprJBRJlB2mnlXYC36jJdFoNdzbAeALf66Y__Wf1fMFKpVQmocQoA/exec";

let statusCache = {
  data: null,
  timestamp: 0
};
let pendingFetchPromise = null;

async function fetchUpstreamStatus() {
  if (pendingFetchPromise) {
    return pendingFetchPromise;
  }

  if (!UPSTREAM_API_URL || UPSTREAM_API_URL.indexOf('http') !== 0) {
    return statusCache.data;
  }

  pendingFetchPromise = (async () => {
    try {
      const url = new URL(UPSTREAM_API_URL);
      url.searchParams.set("action", "getStatus");
      url.searchParams.set("_t", Date.now().toString());

      const controller = new AbortController();
      const timeout = setTimeout(() => {
        try { controller.abort(); } catch (e) {}
      }, 8000); // Shorter timeout for faster failover

      const res = await fetch(url.toString(), {
        signal: controller.signal,
        headers: { "Accept": "application/json" }
      });
      clearTimeout(timeout);

      if (res.ok) {
        const data = await res.json();
        if (data && data.success) {
          statusCache.data = data;
          statusCache.timestamp = Date.now();
          return data;
        }
      }
    } catch (err) {
      // Log errors but don't crash
      console.warn('[Status Proxy] Upstream note:', err.message);
    } finally {
      pendingFetchPromise = null;
    }
    return statusCache.data;
  })();

  return pendingFetchPromise;
}

// Warm up cache immediately on server launch
fetchUpstreamStatus();

// API route to provide instant live status
app.get('/api/status', async (req, res) => {
  const force = req.query.force === 'true' || req.query.clear === 'true';
  const now = Date.now();
  const CACHE_FRESH_MS = 10 * 1000; // Fresh for 10 seconds

  if (req.query.clear === 'true') {
    statusCache.data = null;
    statusCache.timestamp = 0;
  }

  // SWR Logic: return immediately if we have any data at all, refresh in background
  if (statusCache.data) {
    if (force || (now - statusCache.timestamp > CACHE_FRESH_MS)) {
      fetchUpstreamStatus();
    }
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    return res.json(statusCache.data);
  }

  // If no data, start fetch but don't wait too long
  const fetchTask = fetchUpstreamStatus();
  
  if (force) {
    await fetchTask;
  } else {
    // Race between fetch and a very short timeout to ensure the app stays "snappy"
    await Promise.race([
      fetchTask,
      new Promise(resolve => setTimeout(resolve, 800))
    ]);
  }

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

  if (statusCache.data) {
    return res.json(statusCache.data);
  }

  // Return a neutral response that keeps the UI in a "thinking" state if still loading
  return res.json({
    success: true,
    isOptimistic: true,
    orderingOpen: true,
    currentPizzas: 0,
    maxPizzas: 0, 
    remainingPizzas: 0,
    serviceTitle: "Connecting...",
    message: "Refreshing live data..."
  });
});

// API route to provide public configuration and preloaded status to the client
app.get('/config.js', (req, res) => {
  const config = {
    ORDER_API_URL: UPSTREAM_API_URL,
    STATUS_API_URL: "/api/status"
  };
  res.setHeader('Content-Type', 'application/javascript');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  let js = `window.ORDER_API_URL = ${JSON.stringify(config.ORDER_API_URL)};\nwindow.STATUS_API_URL = ${JSON.stringify(config.STATUS_API_URL)};`;
  if (statusCache.data) {
    js += `\nwindow.INITIAL_STATUS = ${JSON.stringify(statusCache.data)};`;
  }
  res.send(js);
});

// Explicit route aliases for HTML pages

// Helper to inject config and status into HTML
async function serveOptimizedHtml(req, res, filename) {
  try {
    let html = await fs.readFile(path.join(__dirname, filename), 'utf8');
    const configScript = `
    <script>
      window.ORDER_API_URL = ${JSON.stringify(UPSTREAM_API_URL)};
      window.STATUS_API_URL = "/api/status";
      window.INITIAL_STATUS = ${JSON.stringify(statusCache.data || null)};
    </script>`;
    
    // Inject before first script or at end of head
    if (html.includes('<script src="/config.js"></script>')) {
      html = html.replace('<script src="/config.js"></script>', configScript);
    } else {
      html = html.replace('</head>', `${configScript}\n</head>`);
    }

    res.setHeader('Content-Type', 'text/html');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.send(html);
  } catch (err) {
    res.sendFile(path.join(__dirname, filename));
  }
}

app.get(['/payment', '/payment.html', '/Payment', '/Payment.html'], (req, res) => {
  serveOptimizedHtml(req, res, 'Payment.html');
});

app.get(['/order', '/order.html', '/Order', '/Order.html'], (req, res) => {
  serveOptimizedHtml(req, res, 'order.html');
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

app.get(['/kitchen', '/kitchen.html', '/Kitchen', '/Kitchen.html'], (req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(__dirname, 'kitchen.html'));
});

app.get(['/parent-order', '/parent-order.html', '/Parent-Order', '/Parent-Order.html'], (req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(__dirname, 'parent-order.html'));
});

app.get(['/terms', '/terms.html', '/Terms', '/Terms.html'], (req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(__dirname, 'terms.html'));
});

app.get(['/', '/index.html'], (req, res) => {
  serveOptimizedHtml(req, res, 'index.html');
});

// Serve static assets with caching headers for non-HTML files
app.use(express.static(__dirname, {
  dotfiles: 'ignore',
  maxAge: '1h',
  etag: true,
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html') || filePath.endsWith('-sw.js') || filePath.endsWith('-manifest.json')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    } else if (filePath.endsWith('.ttf') || filePath.endsWith('.woff2') || filePath.endsWith('.woff')) {
      res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
    } else {
      res.setHeader('Cache-Control', 'public, max-age=3600');
    }
  }
}));

// Fallback to index.html for unknown extensionless routes, 404 for missing static files
app.get('*', (req, res) => {
  if (path.extname(req.path)) {
    return res.status(404).end();
  }
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Artisan Oven server running on http://0.0.0.0:${PORT}`);
});

