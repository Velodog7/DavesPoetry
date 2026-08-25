#!/usr/bin/env node
/**
 * Local development server.
 *
 * Serves the same handler Vercel invokes, plus index.html at the root, so what
 * you see locally is what you get when deployed.
 *
 *   AUTHOR_TOKEN=dev-token node server.js
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const api = require('./lib/api');

const PORT = Number(process.env.PORT) || 3000;
const ROOT = __dirname;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.wav': 'audio/wav'
};

/* Vercel serves static files with range support; the local server has to be
   taught. Without it an <audio> element can play from the start but cannot be
   dragged, which is exactly the thing a follow-along needs to survive. */
function serveRange(req, res, file, size, type) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (!m) return null;
  let start = m[1] === '' ? null : Number(m[1]);
  let end = m[2] === '' ? null : Number(m[2]);
  if (start === null && end === null) return null;
  if (start === null) { start = Math.max(0, size - end); end = size - 1; }
  if (end === null || end >= size) end = size - 1;
  if (start > end || start >= size) {
    res.statusCode = 416;
    res.setHeader('Content-Range', `bytes */${size}`);
    res.end();
    return true;
  }
  res.statusCode = 206;
  res.setHeader('Content-Type', type);
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
  res.setHeader('Content-Length', end - start + 1);
  fs.createReadStream(file, { start, end }).pipe(res);
  return true;
}

const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;

  if (pathname === '/api' || pathname.startsWith('/api/')) {
    return api(req, res);
  }

  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT)) {
    res.statusCode = 403;
    return res.end('Forbidden');
  }

  const type = TYPES[path.extname(file)] || 'application/octet-stream';
  fs.stat(file, (statErr, stat) => {
    if (!statErr && stat.isFile() && serveRange(req, res, file, stat.size, type)) return;
    fs.readFile(file, (err, buf) => {
      if (err) {
        res.statusCode = 404;
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        return res.end('Not found');
      }
      res.setHeader('Content-Type', type);
      res.setHeader('Accept-Ranges', 'bytes');
      res.end(buf);
    });
  });
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`Site   http://localhost:${PORT}`);
    console.log(`API    http://localhost:${PORT}/api/health`);
    console.log(`Store  ${api.store.kind} (${api.store.detail})`);
    if (!process.env.AUTHOR_TOKEN) {
      console.log('\nAUTHOR_TOKEN is not set, so writes are disabled.');
      console.log('Start with:  AUTHOR_TOKEN=dev-token node server.js\n');
    }
  });
}

module.exports = server;
