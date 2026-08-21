#!/usr/bin/env node
/**
 * Dad's Verses — REST API
 *
 * A small, dependency-free HTTP server over a JSON file, exposing the poems,
 * the author's highlights, likes, comments, and the same literary analysis the
 * website runs.
 *
 *   node server.js
 *   PORT=4000 AUTHOR_TOKEN=some-long-secret node server.js
 *
 * Reads are open. Writes that belong to the poet (creating, editing, deleting
 * poems, setting highlights, removing comments) need an author token:
 *
 *   Authorization: Bearer <AUTHOR_TOKEN>
 *
 * If AUTHOR_TOKEN is unset the server generates one at boot and prints it, so
 * it is never accidentally wide open.
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const engine = require('./poetry-engine');

const PORT = Number(process.env.PORT) || 3000;
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data.json');
const AUTHOR_TOKEN = process.env.AUTHOR_TOKEN || crypto.randomBytes(24).toString('hex');
const TOKEN_WAS_GENERATED = !process.env.AUTHOR_TOKEN;
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';
const MAX_BODY = 512 * 1024;

/* ------------------------------------------------------------------ store */

const EMPTY = { site: { name: "Dad's Verses", byline: 'Collected poems' }, poems: [] };

function loadData() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return normalise(parsed);
  } catch (err) {
    if (err.code !== 'ENOENT') console.error('Could not read', DATA_FILE, '-', err.message);
    return normalise(EMPTY);
  }
}

function normalise(input) {
  const site = input.site || {};
  return {
    site: {
      name: site.name || EMPTY.site.name,
      byline: site.byline || EMPTY.site.byline
    },
    poems: (input.poems || []).map(p => ({
      id: p.id || newId(),
      title: p.title || 'Untitled',
      date: p.date || today(),
      tags: Array.isArray(p.tags) ? p.tags : [],
      body: p.body || '',
      style: Object.assign(
        { font: 'mincho', size: 1.22, leading: 1.85, align: 'left', accent: '#3B6FD4' },
        p.style || {}
      ),
      highlights: (Array.isArray(p.highlights) ? p.highlights : [])
        .filter(n => Number.isInteger(n) && n >= 0),
      likedBy: Array.isArray(p.likedBy) ? p.likedBy : [],
      comments: Array.isArray(p.comments) ? p.comments : [],
      sample: !!p.sample
    }))
  };
}

let data = loadData();
let writeQueued = false;

/* Debounced atomic save: write to a temp file, then rename over the real one,
   so an interrupted write can never truncate the poems. */
function save() {
  if (writeQueued) return;
  writeQueued = true;
  setTimeout(() => {
    writeQueued = false;
    const tmp = DATA_FILE + '.tmp';
    try {
      fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
      fs.renameSync(tmp, DATA_FILE);
    } catch (err) {
      console.error('Save failed:', err.message);
    }
  }, 40);
}

function newId() {
  return 'p_' + crypto.randomBytes(8).toString('hex');
}
function today() {
  return new Date().toISOString().slice(0, 10);
}
function findPoem(id) {
  return data.poems.find(p => p.id === id) || null;
}

/* ------------------------------------------------------- representations */

function publicPoem(p) {
  const a = engine.analysisFor(p);
  const words = engine.poemWords(p.body);
  return {
    id: p.id,
    title: p.title,
    date: p.date,
    tags: p.tags.slice(),
    body: p.body,
    form: a.form.form,
    structure: a.form.structure,
    formColor: engine.formColor(a.form.form),
    highlights: p.highlights.slice(),
    highlightedWords: p.highlights.map(i => (words[i] ? words[i].s : null)).filter(Boolean),
    likes: p.likedBy.length,
    comments: p.comments.map(c => ({ id: c.id, name: c.name, text: c.text, createdAt: c.ts })),
    keyWords: a.keys.slice(0, 12).map(k => ({ word: k.word, count: k.count })),
    wordCount: a.wordCount,
    lineCount: a.lineCount,
    stanzaCount: a.stanzaCount,
    style: Object.assign({}, p.style),
    sample: !!p.sample
  };
}

function fullAnalysis(p) {
  const a = engine.analysisFor(p);
  return {
    id: p.id,
    title: p.title,
    form: a.form.form,
    structure: a.form.structure,
    evidence: a.form.evidence,
    lineCount: a.lineCount,
    stanzaCount: a.stanzaCount,
    wordCount: a.wordCount,
    uniqueWords: a.uniqueCount,
    vocabularyRichness: engine.round2(a.richness),
    rhymeDensity: engine.round2(a.form.rhymeDensity),
    rhymeSchemes: a.form.schemes,
    enjambmentRatio: engine.round2(a.enjambRatio),
    avgWordsPerLine: engine.round2(a.avgWordsPerLine),
    avgSentenceLength: engine.round2(a.avgSent),
    keyWords: a.keys.slice(0, 20).map(k => ({ word: k.word, count: k.count })),
    imageFields: a.fields.filter(f => f.count > 0)
      .map(f => ({ field: f.name, count: f.count, examples: f.examples })),
    alliteration: a.allit.map(x => ({ sound: x.sound, words: x.words, line: x.line })),
    assonance: a.assonance.map(x => ({ vowel: x.vowel, words: x.words, line: x.line })),
    repeatedPhrases: a.repeatedPhrases,
    similes: a.similes,
    punctuation: a.punct
  };
}

function collectionSummary() {
  const poems = data.poems.slice().sort((a, b) => a.date.localeCompare(b.date));
  const vocab = Object.create(null);
  let totalWords = 0;
  const formTally = Object.create(null);
  const tagTally = Object.create(null);

  poems.forEach(p => {
    const a = engine.analysisFor(p);
    totalWords += a.wordCount;
    engine.tokenize(p.body).forEach(w => { vocab[w] = 1; });
    formTally[a.form.form] = (formTally[a.form.form] || 0) + 1;
    p.tags.forEach(t => { tagTally[t] = (tagTally[t] || 0) + 1; });
  });

  return {
    poems: poems.length,
    totalWords,
    distinctWords: Object.keys(vocab).length,
    averageWords: poems.length ? Math.round(totalWords / poems.length) : 0,
    firstPoem: poems.length ? poems[0].date : null,
    latestPoem: poems.length ? poems[poems.length - 1].date : null,
    forms: Object.keys(formTally)
      .map(f => ({ form: f, count: formTally[f], color: engine.formColor(f) }))
      .sort((a, b) => b.count - a.count),
    tags: Object.keys(tagTally).sort().map(t => ({ tag: t, count: tagTally[t] })),
    trends: poems.map(p => {
      const a = engine.analysisFor(p);
      let imagery = 0;
      a.fields.forEach(f => { imagery += f.count; });
      return {
        id: p.id,
        title: p.title,
        date: p.date,
        words: a.wordCount,
        richness: engine.round2(a.richness),
        rhyme: engine.round2(a.form.rhymeDensity),
        imagery: a.wordCount ? engine.round2(imagery / a.wordCount) : 0
      };
    })
  };
}

/* --------------------------------------------------------------- helpers */

class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function isAuthor(req) {
  const header = req.headers.authorization || '';
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) return false;
  const given = Buffer.from(match[1]);
  const want = Buffer.from(AUTHOR_TOKEN);
  return given.length === want.length && crypto.timingSafeEqual(given, want);
}

function requireAuthor(req) {
  if (!isAuthor(req)) {
    throw new ApiError(401, 'unauthorized', 'This needs the author token: Authorization: Bearer <AUTHOR_TOKEN>');
  }
}

function send(res, status, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new ApiError(413, 'payload_too_large', 'Request body is too large.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) return resolve(null);
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(new ApiError(400, 'invalid_json', 'Body must be valid JSON.'));
      }
    });
    req.on('error', reject);
  });
}

/* Accepts {indices:[...]}, {words:[...]}, a bare array of either, and resolves
   it to a clean, sorted, de-duplicated list of word positions in this poem. */
function resolveHighlights(poem, input) {
  let out;
  if (Array.isArray(input)) {
    out = input.every(v => typeof v === 'number')
      ? input.slice()
      : engine.indicesForWords(poem.body, input);
  } else if (input && Array.isArray(input.indices)) {
    out = input.indices.slice();
  } else if (input && Array.isArray(input.words)) {
    out = engine.indicesForWords(poem.body, input.words);
  } else {
    throw new ApiError(400, 'bad_request', 'Send {"indices":[…]} or {"words":[…]}.');
  }
  const max = engine.poemWords(poem.body).length;
  return out
    .filter(i => Number.isInteger(i) && i >= 0 && i < max)
    .filter((v, i, arr) => arr.indexOf(v) === i)
    .sort((a, b) => a - b);
}

function visitorFrom(body, req) {
  return (body && body.visitorId) || req.headers['x-visitor-id'] || 'anonymous';
}

/* ---------------------------------------------------------------- routes */

async function route(req, res, url) {
  const segments = url.pathname.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
  const q = url.searchParams;
  const method = req.method.toUpperCase();

  if (segments[0] !== 'api') throw new ApiError(404, 'not_found', 'All routes live under /api.');
  const parts = segments.slice(1);
  const [resource, id, sub, subId] = parts;

  /* --- service --- */
  if (!resource || resource === 'health') {
    return send(res, 200, {
      status: 'ok',
      service: "Dad's Verses API",
      version: '1.1.0',
      poems: data.poems.length,
      authRequiredForWrites: true
    });
  }

  if (resource === 'collection' && method === 'GET') return send(res, 200, collectionSummary());

  if (resource === 'forms' && method === 'GET') return send(res, 200, collectionSummary().forms);

  if (resource === 'tags' && method === 'GET') return send(res, 200, collectionSummary().tags);

  if (resource === 'export' && method === 'GET') {
    requireAuthor(req);
    return send(res, 200, data);
  }

  if (resource === 'import' && method === 'POST') {
    requireAuthor(req);
    const body = await readBody(req);
    if (!body || !Array.isArray(body.poems)) {
      throw new ApiError(400, 'bad_request', 'Expected {"poems":[…]}.');
    }
    const incoming = normalise(body);
    if (q.get('merge') === 'true') {
      const seen = new Set(data.poems.map(p => p.id));
      incoming.poems.forEach(p => { if (!seen.has(p.id)) data.poems.push(p); });
    } else {
      data = incoming;
    }
    engine.clearCache();
    save();
    return send(res, 200, { imported: incoming.poems.length, total: data.poems.length });
  }

  if (resource !== 'poems') throw new ApiError(404, 'not_found', `Unknown resource "${resource}".`);

  /* --- /api/poems --- */
  if (!id) {
    if (method === 'GET') {
      let list = data.poems.slice();
      const search = (q.get('search') || '').toLowerCase();
      if (search) {
        list = list.filter(p =>
          p.title.toLowerCase().includes(search) ||
          p.body.toLowerCase().includes(search) ||
          p.tags.some(t => t.toLowerCase().includes(search)) ||
          engine.formOf(p).toLowerCase().includes(search));
      }
      const form = q.get('form');
      if (form) list = list.filter(p => engine.formOf(p).toLowerCase() === form.toLowerCase());
      const tag = q.get('tag');
      if (tag) list = list.filter(p => p.tags.some(t => t.toLowerCase() === tag.toLowerCase()));
      if (q.get('highlighted') === 'true') list = list.filter(p => p.highlights.length > 0);

      const sort = q.get('sort') || 'newest';
      if (sort === 'oldest') list.sort((a, b) => a.date.localeCompare(b.date));
      else if (sort === 'title') list.sort((a, b) => a.title.localeCompare(b.title));
      else if (sort === 'likes') list.sort((a, b) => b.likedBy.length - a.likedBy.length);
      else list.sort((a, b) => b.date.localeCompare(a.date));

      const total = list.length;
      const offset = Math.max(0, Number(q.get('offset')) || 0);
      const limit = Math.max(0, Number(q.get('limit')) || 0);
      if (offset) list = list.slice(offset);
      if (limit) list = list.slice(0, limit);

      return send(res, 200, { total, count: list.length, offset, poems: list.map(publicPoem) });
    }

    if (method === 'POST') {
      requireAuthor(req);
      const body = await readBody(req);
      if (!body || !body.title || !body.body) {
        throw new ApiError(400, 'bad_request', 'title and body are required.');
      }
      const poem = normalise({ poems: [Object.assign({ id: newId() }, body)] }).poems[0];
      if (body.highlights) poem.highlights = resolveHighlights(poem, body.highlights);
      data.poems.push(poem);
      engine.clearCache();
      save();
      return send(res, 201, publicPoem(poem));
    }

    throw new ApiError(405, 'method_not_allowed', 'Use GET or POST on /api/poems.');
  }

  const poem = findPoem(id);
  if (!poem) throw new ApiError(404, 'not_found', `No poem with id "${id}".`);

  /* --- /api/poems/:id --- */
  if (!sub) {
    if (method === 'GET') return send(res, 200, publicPoem(poem));

    if (method === 'PATCH' || method === 'PUT') {
      requireAuthor(req);
      const body = (await readBody(req)) || {};
      if (typeof body.body === 'string' && body.body !== poem.body) {
        poem.highlights = engine.remapHighlights(poem.body, body.body, poem.highlights);
        poem.body = body.body;
      }
      if (typeof body.title === 'string') poem.title = body.title.trim();
      if (typeof body.date === 'string') poem.date = body.date;
      if (Array.isArray(body.tags)) poem.tags = body.tags.slice();
      if (body.style) poem.style = Object.assign(poem.style, body.style);
      if (body.highlights) poem.highlights = resolveHighlights(poem, body.highlights);
      poem.sample = false;
      engine.clearCache();
      save();
      return send(res, 200, publicPoem(poem));
    }

    if (method === 'DELETE') {
      requireAuthor(req);
      data.poems = data.poems.filter(p => p.id !== id);
      engine.clearCache();
      save();
      return send(res, 200, { deleted: true, id });
    }

    throw new ApiError(405, 'method_not_allowed', 'Use GET, PATCH or DELETE.');
  }

  /* --- /api/poems/:id/highlights --- */
  if (sub === 'highlights') {
    const words = engine.poemWords(poem.body);
    const shape = () => ({
      id: poem.id,
      count: poem.highlights.length,
      highlights: poem.highlights.map(i => ({ index: i, word: words[i] ? words[i].s : null }))
    });

    if (method === 'GET') return send(res, 200, shape());

    requireAuthor(req);

    if (method === 'PUT') {
      poem.highlights = resolveHighlights(poem, await readBody(req));
      save();
      return send(res, 200, shape());
    }
    if (method === 'POST') {
      const extra = resolveHighlights(poem, await readBody(req));
      poem.highlights = poem.highlights.concat(extra)
        .filter((v, i, arr) => arr.indexOf(v) === i)
        .sort((a, b) => a - b);
      save();
      return send(res, 200, shape());
    }
    if (method === 'DELETE') {
      poem.highlights = [];
      save();
      return send(res, 200, shape());
    }
    throw new ApiError(405, 'method_not_allowed', 'Use GET, PUT, POST or DELETE.');
  }

  /* --- /api/poems/:id/suggestions --- */
  if (sub === 'suggestions' && method === 'GET') {
    const n = Number(q.get('limit')) || 6;
    return send(res, 200, engine.keyWords(poem.body, n).map(k => ({
      word: k.word,
      count: k.count,
      indices: engine.indicesForWords(poem.body, [k.word])
    })));
  }

  /* --- /api/poems/:id/analysis --- */
  if (sub === 'analysis' && method === 'GET') return send(res, 200, fullAnalysis(poem));

  /* --- /api/poems/:id/likes --- */
  if (sub === 'likes') {
    if (method === 'GET') return send(res, 200, { id: poem.id, likes: poem.likedBy.length });
    const body = await readBody(req);
    const visitor = visitorFrom(body, req);
    if (method === 'POST') {
      if (!poem.likedBy.includes(visitor)) poem.likedBy.push(visitor);
      save();
      return send(res, 200, { id: poem.id, likes: poem.likedBy.length, liked: true });
    }
    if (method === 'DELETE') {
      poem.likedBy = poem.likedBy.filter(v => v !== visitor);
      save();
      return send(res, 200, { id: poem.id, likes: poem.likedBy.length, liked: false });
    }
    throw new ApiError(405, 'method_not_allowed', 'Use GET, POST or DELETE.');
  }

  /* --- /api/poems/:id/comments --- */
  if (sub === 'comments') {
    if (method === 'GET') {
      return send(res, 200, poem.comments.map(c => ({
        id: c.id, name: c.name, text: c.text, createdAt: c.ts
      })));
    }
    if (method === 'POST') {
      const body = await readBody(req);
      const name = body && String(body.name || '').trim().slice(0, 40);
      const text = body && String(body.text || '').trim().slice(0, 600);
      if (!name || !text) throw new ApiError(400, 'bad_request', 'name and text are required.');
      const comment = { id: newId(), name, text, ts: new Date().toISOString() };
      poem.comments.push(comment);
      save();
      return send(res, 201, { id: comment.id, name, text, createdAt: comment.ts });
    }
    if (method === 'DELETE' && subId) {
      requireAuthor(req);
      const before = poem.comments.length;
      poem.comments = poem.comments.filter(c => c.id !== subId);
      if (poem.comments.length === before) {
        throw new ApiError(404, 'not_found', `No comment with id "${subId}".`);
      }
      save();
      return send(res, 200, { deleted: true, id: subId });
    }
    throw new ApiError(405, 'method_not_allowed', 'Use GET, POST, or DELETE /:commentId.');
  }

  throw new ApiError(404, 'not_found', `Unknown path ${url.pathname}.`);
}

/* ---------------------------------------------------------------- server */

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', CORS_ORIGIN);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Visitor-Id');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  try {
    await route(req, res, url);
  } catch (err) {
    if (err instanceof ApiError) {
      return send(res, err.status, { error: err.code, message: err.message });
    }
    console.error(err);
    return send(res, 500, { error: 'internal_error', message: 'Something went wrong on the server.' });
  }
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`Dad's Verses API listening on http://localhost:${PORT}`);
    console.log(`Data file: ${DATA_FILE}  (${data.poems.length} poems)`);
    if (TOKEN_WAS_GENERATED) {
      console.log('\nNo AUTHOR_TOKEN was set, so one was generated for this run:');
      console.log(`  ${AUTHOR_TOKEN}`);
      console.log('Set AUTHOR_TOKEN in the environment to keep it stable between restarts.\n');
    }
  });
}

module.exports = { server, route, publicPoem, collectionSummary };
