import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

// Explicit route aliases for HTML pages
app.get(['/payment', '/payment.html', '/Payment', '/Payment.html'], (req, res) => {
  res.sendFile(path.join(__dirname, 'Payment.html'));
});

app.get(['/order', '/order.html', '/Order', '/Order.html'], (req, res) => {
  res.sendFile(path.join(__dirname, 'order.html'));
});

app.get(['/admin', '/admin.html', '/Admin', '/Admin.html'], (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

app.get(['/', '/index.html'], (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Serve static assets
app.use(express.static(__dirname));

// Fallback to index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Artisan Oven server running on http://0.0.0.0:${PORT}`);
});
