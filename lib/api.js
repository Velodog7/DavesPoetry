/**
 * api.js — every route, in one place, independent of how it is being served.
 *
 * Exports a handler with the Node signature (req, res), which is exactly what
 * both a plain http.createServer and a Vercel serverless function want. All
 * storage goes through the injected store, so the same routes work against a
 * file on disk or a KV store in the cloud.
 */
'use strict';

const crypto = require('crypto');
const engine = require('./poetry-engine');
const auth = require('./auth');
const readings = require('./readings');
const { createStore, envReport, readSeed } = require('./store');

const store = createStore();

const AUTHOR_TOKEN = process.env.AUTHOR_TOKEN || '';
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';
const MAX_BODY = 512 * 1024;

/* ------------------------------------------------------------ shaping --- */

const DEFAULT_STYLE = { font: 'serif', size: 1.22, leading: 1.85, align: 'left', accent: '#3B6FD4' };
const FONT_ALIASES = { mincho: 'serif', display: 'serif', hand: 'serif', gothic: 'sans' };

function newId() {
  return 'p_' + crypto.randomBytes(8).toString('hex');
}
function today() {
  return new Date().toISOString().slice(0, 10);
}

function normalise(input) {
  const site = (input && input.site) || {};
  return {
    site: {
      name: site.name || 'Poems',
      byline: site.byline || 'Collected poems'
    },
    /* Carried through untouched. The account belongs to the store, not to any
       payload that arrives over the wire — import never assigns this. */
    auth: (input && input.auth) || null,
    poems: ((input && input.poems) || []).map(p => {
      const style = Object.assign({}, DEFAULT_STYLE, p.style || {});
      style.font = FONT_ALIASES[style.font] || (style.font === 'sans' ? 'sans' : 'serif');
      return {
        id: p.id || newId(),
        title: p.title || 'Untitled',
        date: p.date || today(),
        tags: Array.isArray(p.tags) ? p.tags : [],
        body: p.body || '',
        blurb: typeof p.blurb === 'string' ? p.blurb : '',
        style,
        highlights: (Array.isArray(p.highlights) ? p.highlights : [])
          .filter(n => Number.isInteger(n) && n >= 0),
        likedBy: Array.isArray(p.likedBy) ? p.likedBy : [],
        comments: Array.isArray(p.comments) ? p.comments : [],
        sample: !!p.sample
      };
    })
  };
}

function publicPoem(p, visitor) {
  const a = engine.analysisFor(p);
  const words = engine.poemWords(p.body);
  return {
    id: p.id,
    title: p.title,
    date: p.date,
    tags: p.tags.slice(),
    body: p.body,
    blurb: p.blurb || '',
    form: a.form.form,
    structure: a.form.structure,
    formColor: engine.formColor(a.form.form),
    highlights: p.highlights.slice(),
    highlightedWords: p.highlights.map(i => (words[i] ? words[i].s : null)).filter(Boolean),
    likes: p.likedBy.length,
    likedByMe: visitor ? p.likedBy.includes(visitor) : false,
    comments: p.comments.map(c => ({ id: c.id, name: c.name, text: c.text, createdAt: c.ts })),
    keyWords: a.keys.slice(0, 12).map(k => ({ word: k.word, count: k.count })),
    wordCount: a.wordCount,
    lineCount: a.lineCount,
    stanzaCount: a.stanzaCount,
    style: Object.assign({}, p.style),
    reading: readings.readingFor(p),
    sample: !!p.sample
  };
}

function fullAnalysis(p) {
  const a = engine.analysisFor(p);
  return {
    id: p.id,
    title: p.title,
    reading: readings.readingFor(p),
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

function collectionSummary(data) {
  const poems = data.poems.slice().sort((a, b) => a.date.localeCompare(b.date));
  const vocab = Object.create(null);
  const formTally = Object.create(null);
  const tagTally = Object.create(null);
  let totalWords = 0;

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

/* ------------------------------------------------------------ plumbing --- */

class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function bearer(req) {
  const match = /^Bearer\s+(.+)$/i.exec((req.headers.authorization || '').trim());
  return match ? match[1] : '';
}

/* The master token — the environment secret, held by whoever owns the deploy.
   It sets up the account and can always get back in. */
function isMaster(req) {
  if (!AUTHOR_TOKEN) return false;
  const given = Buffer.from(bearer(req));
  const want = Buffer.from(AUTHOR_TOKEN);
  return given.length === want.length && crypto.timingSafeEqual(given, want);
}

/* Day to day the author is a session, opened with his own PIN. Either proof
   is enough to write. */
function isAuthor(req, data) {
  if (isMaster(req)) return true;
  return !!(data && auth.validSession(data, bearer(req)));
}

function requireAuthor(req, data) {
  if (!AUTHOR_TOKEN && !(data && auth.isConfigured(data))) {
    throw new ApiError(503, 'no_author_token',
      'AUTHOR_TOKEN is not set on the server, so no one can make changes. Add it in your environment variables.');
  }
  if (!isAuthor(req, data)) {
    throw new ApiError(401, 'unauthorized',
      'This needs the author: sign in for a session token, or send the master AUTHOR_TOKEN.');
  }
}

/* Until the site has an owner, it belongs to the deploy — its name and its
   example poems both. Otherwise whatever the store happened to be seeded with
   on its very first boot is frozen forever, and a redeployed change is quietly
   ignored: the page paints the new thing, the API replaces it with the old.
   Once an account exists this stops entirely; from then on it is his. */
function applyDeployDefaults(data) {
  if (auth.isConfigured(data)) return data;
  const seed = readSeed();

  if (seed && seed.site && seed.site.name) {
    data.site.name = seed.site.name;
    if (seed.site.byline) data.site.byline = seed.site.byline;
  }

  /* Example poems are placeholders, not anyone's writing, so the deploy says
     which exist. Ship none and none are served — immediately, not whenever
     somebody gets round to signing up. Anything the poet has actually edited
     lost its sample flag when he saved it, and is left alone. */
  const samples = ((seed && seed.poems) || []).filter(p => p.sample);
  if (data.poems.some(p => p.sample) || samples.length) {
    data.poems = data.poems.filter(p => !p.sample)
      .concat(normalise({ poems: samples }).poems);
  }
  return data;
}

function requireWritable() {
  if (!store.writable) {
    throw new ApiError(503, 'read_only',
      `Storage is read-only here (${store.detail}). Connect a KV store to save changes.`);
  }
}

function send(res, status, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(body);
}

function readBody(req) {
  /* Vercel may have parsed the body already; a plain Node server has not. */
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === 'string') {
      if (!req.body.trim()) return Promise.resolve(null);
      try { return Promise.resolve(JSON.parse(req.body)); }
      catch (err) { return Promise.reject(new ApiError(400, 'invalid_json', 'Body must be valid JSON.')); }
    }
    return Promise.resolve(req.body);
  }
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
      try { resolve(JSON.parse(raw)); }
      catch (err) { reject(new ApiError(400, 'invalid_json', 'Body must be valid JSON.')); }
    });
    req.on('error', reject);
  });
}

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

/* -------------------------------------------------------------- routes --- */

async function route(req, res, url) {
  const method = (req.method || 'GET').toUpperCase();
  const q = url.searchParams;
  const segments = url.pathname.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);

  /* Tolerate being mounted at /api or at the root. */
  const parts = segments[0] === 'api' ? segments.slice(1) : segments;
  const [resource, id, sub, subId] = parts;

  if (!resource || resource === 'health') {
    return send(res, 200, {
      status: 'ok',
      service: "Dad's Verses API",
      version: '1.3.0',
      storage: { kind: store.kind, writable: store.writable, detail: store.detail },
      authorTokenConfigured: !!AUTHOR_TOKEN,
      authorAccountConfigured: auth.isConfigured(normalise(await store.read())),
      /* What a visitor would actually see, not what the store happens to hold.
         A count that disagrees with the page is worse than no count. */
      poems: applyDeployDefaults(normalise(await store.read())).poems.length,
      /* Names only — never values. Lets you see what the deploy can actually read. */
      environmentSeen: envReport(),
      nextStep: store.writable
        ? (AUTHOR_TOKEN ? null : 'Add AUTHOR_TOKEN in Settings → Environment Variables, then redeploy.')
        : 'Connect a database: Vercel → Storage → Upstash → Redis, then redeploy.'
    });
  }

  const raw = await store.read();
  const data = normalise(raw);

  /* Until the site has an owner, its name belongs to the deploy, not to
     whatever was seeded into the store the first time it ran. Otherwise the
     store's copy is frozen at the first boot and a retitled deploy is quietly
     ignored — the page renders the new name, then the API replaces it with the
     old one. Once an account exists this stops: the name is the author's, and
     only /api/site changes it. */
  applyDeployDefaults(data);

  async function commit() {
    requireWritable();
    engine.clearCache();
    await store.write(data);
  }

  /* --- /auth --- the author's own account ------------------------------- */
  if (resource === 'auth') {
    /* Segments here read /auth/<action>; the generic names are poem-shaped. */
    const action = id;

    if (!action && method === 'GET') {
      return send(res, 200, auth.publicState(data, !!AUTHOR_TOKEN));
    }

    /* Creating or resetting the PIN is gated by the master token. Without
       that gate, a public page's author account belongs to whoever finds it
       first. */
    if (action === 'setup' && method === 'POST') {
      if (!AUTHOR_TOKEN) {
        throw new ApiError(503, 'no_author_token',
          'AUTHOR_TOKEN is not set on the server, so the author account cannot be created yet.');
      }
      if (!isMaster(req)) {
        throw new ApiError(401, 'unauthorized',
          'Setting up the author account needs the setup key (the AUTHOR_TOKEN from the site’s environment).');
      }
      const body = (await readBody(req)) || {};
      const already = auth.isConfigured(data);
      if (already && body.reset !== true) {
        throw new ApiError(409, 'already_configured',
          'An author account already exists. Send {"reset":true} to replace its PIN.');
      }
      const result = auth.setPin(data, body.pin, body.name);
      if (!result.ok) throw new ApiError(400, 'weak_pin', result.message);

      /* The site ships with example poems so it is not a blank rectangle while
         nobody owns it. The moment someone does, they are in the way — so the
         first account creation clears them. Only ever the untouched ones:
         editing a poem drops its sample flag, so anything he has already put
         his hand to survives. A later reset never clears anything. */
      let cleared = 0;
      if (!already) {
        const before = data.poems.length;
        data.poems = data.poems.filter(p => !p.sample);
        cleared = before - data.poems.length;
        /* The site name is already the deploy's, applied on the way in above.
           Committing here is what freezes it as his. */
      }

      const session = auth.issueSession(data, body.device);
      await commit();
      return send(res, already ? 200 : 201, {
        configured: true,
        reset: already,
        clearedSamples: cleared,
        name: data.auth.name || null,
        token: session.token,
        expiresAt: session.expiresAt
      });
    }

    if (action === 'session') {
      if (method === 'GET') {
        const token = bearer(req);
        return send(res, 200, {
          valid: isMaster(req) || auth.validSession(data, token),
          master: isMaster(req),
          name: data.auth && data.auth.name ? data.auth.name : null
        });
      }

      if (method === 'POST') {
        const body = (await readBody(req)) || {};
        const verdict = auth.checkPin(data, body.pin);
        if (!verdict.ok) {
          /* The attempt counter only deters if it survives the request. */
          if (store.writable) await store.write(data);
          const status = verdict.code === 'locked' ? 429
            : verdict.code === 'not_configured' ? 409 : 401;
          if (verdict.retryAfter) res.setHeader('Retry-After', String(verdict.retryAfter));
          return send(res, status, {
            error: verdict.code,
            message: verdict.message,
            retryAfter: verdict.retryAfter || null,
            attemptsRemaining: verdict.attemptsRemaining
          });
        }
        const session = auth.issueSession(data, body.device);
        await commit();
        return send(res, 200, {
          token: session.token,
          expiresAt: session.expiresAt,
          name: data.auth.name || null
        });
      }

      if (method === 'DELETE') {
        const token = bearer(req);
        const all = q.get('all') === 'true';
        if (all) {
          requireAuthor(req, data);
          auth.revokeAll(data);
        } else {
          auth.revokeSession(data, token);
        }
        await commit();
        return send(res, 200, { signedOut: true, everywhere: all });
      }

      throw new ApiError(405, 'method_not_allowed', 'Use GET, POST or DELETE on /api/auth/session.');
    }

    /* Changing the PIN from inside: prove the current one, so a borrowed
       unlocked browser cannot quietly take the account over. */
    if (action === 'pin' && method === 'POST') {
      requireAuthor(req, data);
      const body = (await readBody(req)) || {};
      if (!isMaster(req)) {
        const verdict = auth.checkPin(data, body.currentPin);
        if (!verdict.ok) {
          if (store.writable) await store.write(data);
          throw new ApiError(401, verdict.code, verdict.message);
        }
      }
      const result = auth.setPin(data, body.pin, body.name);
      if (!result.ok) throw new ApiError(400, 'weak_pin', result.message);
      const session = auth.issueSession(data, body.device);
      await commit();
      return send(res, 200, {
        changed: true,
        name: data.auth.name || null,
        token: session.token,
        expiresAt: session.expiresAt
      });
    }

    throw new ApiError(404, 'not_found', `Unknown path ${url.pathname}.`);
  }

  if (resource === 'collection' && method === 'GET') return send(res, 200, collectionSummary(data));
  if (resource === 'forms' && method === 'GET') return send(res, 200, collectionSummary(data).forms);
  if (resource === 'tags' && method === 'GET') return send(res, 200, collectionSummary(data).tags);
  if (resource === 'site' && method === 'GET') return send(res, 200, data.site);

  if (resource === 'site' && (method === 'PATCH' || method === 'PUT')) {
    requireAuthor(req, data);
    const body = (await readBody(req)) || {};
    if (typeof body.name === 'string') data.site.name = body.name.trim().slice(0, 60);
    if (typeof body.byline === 'string') data.site.byline = body.byline.trim().slice(0, 80);
    await commit();
    return send(res, 200, data.site);
  }

  if (resource === 'export' && method === 'GET') {
    requireAuthor(req, data);
    /* A backup is poems. It does not carry the account's hash, salt or open
       sessions off the server with it. */
    return send(res, 200, auth.withoutAuth(data));
  }

  if (resource === 'import' && method === 'POST') {
    requireAuthor(req, data);
    const body = await readBody(req);
    if (!body || !Array.isArray(body.poems)) {
      throw new ApiError(400, 'bad_request', 'Expected {"poems":[…]}.');
    }
    const incoming = normalise(body);
    if (q.get('merge') === 'true') {
      const seen = new Set(data.poems.map(p => p.id));
      incoming.poems.forEach(p => { if (!seen.has(p.id)) data.poems.push(p); });
    } else {
      data.site = incoming.site;
      data.poems = incoming.poems;
    }
    await commit();
    return send(res, 200, { imported: incoming.poems.length, total: data.poems.length });
  }

  if (resource !== 'poems') throw new ApiError(404, 'not_found', `Unknown resource "${resource}".`);

  /* --- /poems --- */
  if (!id) {
    if (method === 'GET') {
      let list = data.poems.slice();
      const search = (q.get('search') || '').toLowerCase();
      if (search) {
        list = list.filter(p =>
          p.title.toLowerCase().includes(search) ||
          p.body.toLowerCase().includes(search) ||
          (p.blurb || '').toLowerCase().includes(search) ||
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

      const me = visitorFrom(null, req);
      return send(res, 200, { total, count: list.length, offset, poems: list.map(p => publicPoem(p, me)) });
    }

    if (method === 'POST') {
      requireAuthor(req, data);
      const body = await readBody(req);
      if (!body || !body.title || !body.body) {
        throw new ApiError(400, 'bad_request', 'title and body are required.');
      }
      const poem = normalise({ poems: [Object.assign({ id: newId() }, body)] }).poems[0];
      if (body.highlights) poem.highlights = resolveHighlights(poem, body.highlights);
      data.poems.push(poem);
      await commit();
      return send(res, 201, publicPoem(poem, visitorFrom(body, req)));
    }

    throw new ApiError(405, 'method_not_allowed', 'Use GET or POST on /api/poems.');
  }

  const poem = data.poems.find(p => p.id === id);
  if (!poem) throw new ApiError(404, 'not_found', `No poem with id "${id}".`);

  /* --- /poems/:id --- */
  if (!sub) {
    if (method === 'GET') return send(res, 200, publicPoem(poem, visitorFrom(null, req)));

    if (method === 'PATCH' || method === 'PUT') {
      requireAuthor(req, data);
      const body = (await readBody(req)) || {};
      if (typeof body.body === 'string' && body.body !== poem.body) {
        poem.highlights = engine.remapHighlights(poem.body, body.body, poem.highlights);
        poem.body = body.body;
      }
      if (typeof body.title === 'string') poem.title = body.title.trim();
      if (typeof body.blurb === 'string') poem.blurb = body.blurb;
      if (typeof body.date === 'string') poem.date = body.date;
      if (Array.isArray(body.tags)) poem.tags = body.tags.slice();
      if (body.style) poem.style = Object.assign(poem.style, body.style);
      if (body.highlights) poem.highlights = resolveHighlights(poem, body.highlights);
      poem.sample = false;
      await commit();
      return send(res, 200, publicPoem(poem, visitorFrom(body, req)));
    }

    if (method === 'DELETE') {
      requireAuthor(req, data);
      data.poems = data.poems.filter(p => p.id !== id);
      await commit();
      return send(res, 200, { deleted: true, id });
    }

    throw new ApiError(405, 'method_not_allowed', 'Use GET, PATCH or DELETE.');
  }

  /* --- /poems/:id/highlights --- */
  if (sub === 'highlights') {
    const words = engine.poemWords(poem.body);
    const shape = () => ({
      id: poem.id,
      count: poem.highlights.length,
      highlights: poem.highlights.map(i => ({ index: i, word: words[i] ? words[i].s : null }))
    });

    if (method === 'GET') return send(res, 200, shape());
    requireAuthor(req, data);

    if (method === 'PUT') {
      poem.highlights = resolveHighlights(poem, await readBody(req));
      await commit();
      return send(res, 200, shape());
    }
    if (method === 'POST') {
      const extra = resolveHighlights(poem, await readBody(req));
      poem.highlights = poem.highlights.concat(extra)
        .filter((v, i, arr) => arr.indexOf(v) === i)
        .sort((a, b) => a - b);
      await commit();
      return send(res, 200, shape());
    }
    if (method === 'DELETE') {
      poem.highlights = [];
      await commit();
      return send(res, 200, shape());
    }
    throw new ApiError(405, 'method_not_allowed', 'Use GET, PUT, POST or DELETE.');
  }

  if (sub === 'suggestions' && method === 'GET') {
    const n = Number(q.get('limit')) || 6;
    return send(res, 200, engine.keyWords(poem.body, n).map(k => ({
      word: k.word,
      count: k.count,
      indices: engine.indicesForWords(poem.body, [k.word])
    })));
  }

  if (sub === 'analysis' && method === 'GET') return send(res, 200, fullAnalysis(poem));

  /* --- /poems/:id/likes --- */
  if (sub === 'likes') {
    if (method === 'GET') return send(res, 200, { id: poem.id, likes: poem.likedBy.length });
    const body = await readBody(req);
    const visitor = visitorFrom(body, req);
    if (method === 'POST') {
      if (!poem.likedBy.includes(visitor)) poem.likedBy.push(visitor);
      await commit();
      return send(res, 200, { id: poem.id, likes: poem.likedBy.length, liked: true });
    }
    if (method === 'DELETE') {
      poem.likedBy = poem.likedBy.filter(v => v !== visitor);
      await commit();
      return send(res, 200, { id: poem.id, likes: poem.likedBy.length, liked: false });
    }
    throw new ApiError(405, 'method_not_allowed', 'Use GET, POST or DELETE.');
  }

  /* --- /poems/:id/comments --- */
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
      await commit();
      return send(res, 201, { id: comment.id, name, text, createdAt: comment.ts });
    }
    if (method === 'DELETE' && subId) {
      requireAuthor(req, data);
      const before = poem.comments.length;
      poem.comments = poem.comments.filter(c => c.id !== subId);
      if (poem.comments.length === before) {
        throw new ApiError(404, 'not_found', `No comment with id "${subId}".`);
      }
      await commit();
      return send(res, 200, { deleted: true, id: subId });
    }
    throw new ApiError(405, 'method_not_allowed', 'Use GET, POST, or DELETE /:commentId.');
  }

  throw new ApiError(404, 'not_found', `Unknown path ${url.pathname}.`);
}

/* ------------------------------------------------------------- handler --- */

async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', CORS_ORIGIN);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Visitor-Id');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }

  let url;
  try {
    url = new URL(req.url, `https://${req.headers.host || 'localhost'}`);
  } catch (err) {
    return send(res, 400, { error: 'bad_request', message: 'Could not parse the request URL.' });
  }

  try {
    await route(req, res, url);
  } catch (err) {
    if (err instanceof ApiError) {
      return send(res, err.status, { error: err.code, message: err.message });
    }
    console.error('API error:', err);
    return send(res, 500, {
      error: 'internal_error',
      message: err && err.message ? err.message : 'Something went wrong on the server.'
    });
  }
}

module.exports = handler;
module.exports.handler = handler;
module.exports.store = store;
module.exports.normalise = normalise;
module.exports.publicPoem = publicPoem;
