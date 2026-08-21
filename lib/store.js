/**
 * store.js — where the poems live.
 *
 * The API runs in two very different places, so storage is pluggable:
 *
 *   kv      Upstash Redis over its REST API. No client library, and the
 *           recommended option on Vercel, whose filesystem is read-only.
 *   redis   Any Redis reached by connection string (Redis Cloud and the like).
 *           Needs the `redis` package in dependencies.
 *   file    A JSON file on disk. Right for running locally or on a normal VPS.
 *   memory  Seeded from data/seed.json, lost on the next cold start. A safety
 *           net so a misconfigured deploy still serves the poems read-only
 *           instead of crashing.
 *
 * Pick one with STORE=kv|redis|file|memory, or let it choose: KV if its environment
 * variables are present, otherwise a writable file, otherwise memory.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const SEED_FILE = path.join(__dirname, '..', 'data', 'seed.json');
const KEY = process.env.KV_KEY || 'dads-verses:data';

function readSeed() {
  try {
    return JSON.parse(fs.readFileSync(SEED_FILE, 'utf8'));
  } catch (err) {
    return { site: { name: 'Poems', byline: 'Collected poems' }, poems: [] };
  }
}

/* ------------------------------------------------------------------ KV ---
   Vercel KV and Upstash expose the same REST shape:
     GET  {url}/get/{key}   → {"result": "<string or null>"}
     POST {url}/set/{key}   → body is the raw value
*/
/* Vercel's own "KV" tile is gone; the same thing now comes from the Upstash
   entry in the marketplace. Whichever route created it, it exposes a REST URL
   and token under one of these names. */
const KV_URL_VARS = ['KV_REST_API_URL', 'UPSTASH_REDIS_REST_URL', 'REDIS_REST_API_URL'];
const KV_TOKEN_VARS = ['KV_REST_API_TOKEN', 'UPSTASH_REDIS_REST_TOKEN', 'REDIS_REST_API_TOKEN'];

/* Vercel's storage integrations offer a "custom prefix" when you connect a
   database, and it is applied to every variable: pick "davespoems" and you get
   `davespoems_KV_REST_API_URL` rather than `KV_REST_API_URL`. Matching on exact
   names alone would miss those entirely and quietly fall back to memory, so
   look for the known name at the *end* of any variable as well.

   Ordering is deliberate: an exact, unprefixed name always wins, and within
   each pass the earlier entry in the list wins. */
function envCandidates(names) {
  const found = [];
  const keys = Object.keys(process.env);

  for (const base of names) {
    const value = process.env[base];
    if (value) found.push({ name: base, prefix: '', value });
  }

  for (const base of names) {
    const re = new RegExp('^(.+_)' + base + '$');
    for (const key of keys) {
      const m = key.match(re);
      if (m && process.env[key]) found.push({ name: key, prefix: m[1], value: process.env[key] });
    }
  }

  return found;
}

function firstEnv(names) {
  const found = envCandidates(names);
  return found.length ? { name: found[0].name, value: found[0].value } : null;
}

function kvConfig() {
  const urls = envCandidates(KV_URL_VARS);
  const tokens = envCandidates(KV_TOKEN_VARS);
  if (!urls.length || !tokens.length) return null;

  /* Pair URL with the token that carries the same prefix. Two databases can be
     connected at once with different prefixes; crossing their credentials would
     authenticate against the wrong one. */
  for (const url of urls) {
    const token = tokens.find(t => t.prefix === url.prefix);
    if (token) {
      return { url: url.value.replace(/\/+$/, ''), token: token.value, via: url.name };
    }
  }

  return { url: urls[0].value.replace(/\/+$/, ''), token: tokens[0].value, via: urls[0].name };
}

/* Which storage-related variables are visible, so /api/health can explain
   itself without ever revealing a value. */
/* Redis Cloud and friends hand out a connection string instead of REST
   credentials. Usable, but only with a client library. */
const REDIS_URL_VARS = ['REDIS_URL', 'STORAGE_URL', 'KV_URL', 'REDIS_CONNECTION_STRING'];

function envReport() {
  const seen = {};
  /* Report the names as they actually appear, prefix and all, so a mismatch is
     visible at a glance. Names only — never a value. */
  envCandidates(KV_URL_VARS.concat(KV_TOKEN_VARS, REDIS_URL_VARS, ['BLOB_READ_WRITE_TOKEN']))
    .forEach(hit => { seen[hit.name] = true; });
  ['STORE', 'AUTHOR_TOKEN'].forEach(name => { if (process.env[name]) seen[name] = true; });
  return seen;
}

function redisUrlConfig() {
  const found = firstEnv(REDIS_URL_VARS);
  if (!found) return null;
  if (!/^rediss?:\/\//i.test(found.value)) return null;
  return { url: found.value, via: found.name };
}

function hasRedisPackage() {
  try { require.resolve('redis'); return true; }
  catch (err) { return false; }
}

/* ------------------------------------------------------- redis (socket) --- */
function makeRedisStore(cfg) {
  let client = null;
  let cache = null;

  async function connect() {
    if (client && client.isOpen) return client;
    const redis = require('redis');
    client = redis.createClient({ url: cfg.url });
    client.on('error', () => {});   // a failed command reports the error itself
    await client.connect();
    return client;
  }

  return {
    kind: 'redis',
    writable: true,
    detail: 'Redis over a connection string (via ' + cfg.via + ')',

    async read() {
      if (cache) return cache;
      const c = await connect();
      const raw = await c.get(KEY);
      if (raw) {
        cache = JSON.parse(raw);
      } else {
        cache = readSeed();
        await this.write(cache);
      }
      return cache;
    },

    async write(data) {
      cache = data;
      const c = await connect();
      await c.set(KEY, JSON.stringify(data));
      return true;
    }
  };
}

function makeKvStore(cfg) {
  let cache = null;

  async function call(pathname, init) {
    const res = await fetch(`${cfg.url}${pathname}`, {
      ...init,
      headers: { Authorization: `Bearer ${cfg.token}`, ...(init && init.headers) }
    });
    if (!res.ok) {
      throw new Error(`KV ${init && init.method === 'POST' ? 'write' : 'read'} failed (${res.status})`);
    }
    return res.json();
  }

  return {
    kind: 'kv',
    writable: true,
    detail: 'Upstash Redis (via ' + cfg.via + ')',

    async read() {
      if (cache) return cache;
      const body = await call(`/get/${encodeURIComponent(KEY)}`);
      if (body && typeof body.result === 'string' && body.result.length) {
        cache = JSON.parse(body.result);
      } else {
        /* First run against an empty store: plant the seed so the site has
           something to show, and so the shape is there to write into. */
        cache = readSeed();
        await this.write(cache);
      }
      return cache;
    },

    async write(data) {
      cache = data;
      await call(`/set/${encodeURIComponent(KEY)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify(data)
      });
      return true;
    }
  };
}

/* ---------------------------------------------------------------- file --- */
function makeFileStore(file) {
  let cache = null;
  return {
    kind: 'file',
    writable: true,
    detail: file,

    async read() {
      if (cache) return cache;
      try {
        cache = JSON.parse(fs.readFileSync(file, 'utf8'));
      } catch (err) {
        if (err.code !== 'ENOENT') throw err;
        cache = readSeed();
        await this.write(cache);
      }
      return cache;
    },

    async write(data) {
      cache = data;
      /* Write to a temp file and rename, so an interrupted write can never
         leave a half-finished file where the poems used to be. */
      const tmp = file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
      fs.renameSync(tmp, file);
      return true;
    }
  };
}

/* -------------------------------------------------------------- memory --- */
function makeMemoryStore(reason) {
  let data = readSeed();
  return {
    kind: 'memory',
    writable: false,
    detail: reason,
    async read() { return data; },
    async write(next) {
      data = next;            // honoured for this invocation only
      return false;           // …and reported as not durable
    }
  };
}

function canWrite(dir) {
  try {
    fs.accessSync(dir, fs.constants.W_OK);
    return true;
  } catch (err) {
    return false;
  }
}

function createStore() {
  const requested = (process.env.STORE || '').toLowerCase();
  const cfg = kvConfig();

  if (requested === 'kv' || (!requested && cfg)) {
    if (!cfg) {
      return makeMemoryStore(
        'STORE=kv was set but no REST URL + token pair was found. Looked for ' +
        KV_URL_VARS.join(' / ') + ' and ' + KV_TOKEN_VARS.join(' / ') +
        ', with or without a custom prefix.'
      );
    }
    return makeKvStore(cfg);
  }

  if (requested === 'memory') return makeMemoryStore('STORE=memory');

  const file = process.env.DATA_FILE || path.join(__dirname, '..', 'data', 'data.json');
  if (requested === 'file' || canWrite(path.dirname(file))) {
    return makeFileStore(file);
  }

  /* A connection string points at a Redis that speaks the binary protocol
     (Redis Cloud, for instance). Usable, but only with the `redis` package. */
  const redisCfg = redisUrlConfig();
  if (requested === 'redis' || redisCfg) {
    if (!redisCfg) {
      return makeMemoryStore('STORE=redis was set but no REDIS_URL is present');
    }
    if (!hasRedisPackage()) {
      return makeMemoryStore(
        'found ' + redisCfg.via + ' (a Redis connection string) but the "redis" package is not installed, ' +
        'so nothing can be saved. Either add "redis" to dependencies, or — simpler and recommended — ' +
        'use Vercel → Storage → Upstash → Redis, which needs no package at all.'
      );
    }
    return makeRedisStore(redisCfg);
  }

  return makeMemoryStore(
    'no database connected — running read-only. In Vercel: Storage → Upstash → Redis.'
  );
}

module.exports = { createStore, readSeed, envReport };
