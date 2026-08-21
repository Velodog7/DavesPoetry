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
  '.ico': 'image/x-icon'
};

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

  fs.readFile(file, (err, buf) => {
    if (err) {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      return res.end('Not found');
    }
    res.setHeader('Content-Type', TYPES[path.extname(file)] || 'application/octet-stream');
    res.end(buf);
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
