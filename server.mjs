import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { collect } from './lib/collect.mjs';

const PORT = Number(process.env.PORT || 3450);
const PUBLIC_DIR = path.join(import.meta.dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

let cache = null;

function sendJson(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(body));
}

function serveStatic(req, res) {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  let filePath = path.normalize(path.join(PUBLIC_DIR, urlPath === '/' ? 'index.html' : urlPath));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(PUBLIC_DIR, 'index.html');
  }
  const ext = path.extname(filePath);
  res.writeHead(200, {
    'Content-Type': MIME[ext] ?? 'application/octet-stream',
    'Cache-Control': 'no-cache',
  });
  fs.createReadStream(filePath).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (url.pathname === '/api/usage') {
    try {
      if (!cache || url.searchParams.get('refresh') === '1') {
        cache = collect();
      }
      sendJson(res, 200, cache);
    } catch (err) {
      sendJson(res, 500, { error: String(err?.message || err) });
    }
    return;
  }

  if (url.pathname === '/api/health') {
    sendJson(res, 200, { ok: true });
    return;
  }

  serveStatic(req, res);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`GLM Tracker → http://localhost:${PORT}`);
});
