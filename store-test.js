#!/usr/bin/env node
/**
 * store-test.js — storage detection, including Vercel's custom prefixes.
 *
 * Nothing here touches the network: creating a KV store only records the
 * credentials, so we can check what was detected without a live database.
 */
'use strict';

const path = require('path');
const STORE_PATH = require.resolve('./lib/store.js');

let pass = 0, fail = 0;

function withEnv(vars, fn) {
  const saved = { ...process.env };
  /* Start from a clean slate so the machine's own environment can't leak in. */
  for (const key of Object.keys(process.env)) {
    if (/KV|REDIS|UPSTASH|STORE|DATA_FILE|BLOB/.test(key)) delete process.env[key];
  }
  Object.assign(process.env, vars);
  delete require.cache[STORE_PATH];
  try {
    return fn(require(STORE_PATH));
  } finally {
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, saved);
    delete require.cache[STORE_PATH];
  }
}

function check(label, actual, expected) {
  const ok = actual === expected;
  if (ok) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}\n         expected ${JSON.stringify(expected)}\n         got      ${JSON.stringify(actual)}`); }
}

function contains(label, haystack, needle) {
  const ok = typeof haystack === 'string' && haystack.includes(needle);
  if (ok) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}\n         ${JSON.stringify(haystack)} does not contain ${JSON.stringify(needle)}`); }
}

/* Force the file store out of the running: point DATA_FILE somewhere unwritable
   so auto-detection can't quietly choose it ahead of the case under test. */
const NO_FILE = { DATA_FILE: '/proc/no-such-dir/data.json' };

console.log('\nplain Upstash names');
withEnv({
  ...NO_FILE,
  UPSTASH_REDIS_REST_URL: 'https://plain.upstash.io',
  UPSTASH_REDIS_REST_TOKEN: 'tok-plain'
}, ({ createStore, envReport }) => {
  const store = createStore();
  check('kind is kv', store.kind, 'kv');
  check('writable', store.writable, true);
  contains('detail names the variable', store.detail, 'UPSTASH_REDIS_REST_URL');
  check('envReport sees the URL', envReport().UPSTASH_REDIS_REST_URL, true);
});

console.log('\ncustom prefix (the davespoems_ case)');
withEnv({
  ...NO_FILE,
  davespoems_KV_REST_API_URL: 'https://prefixed.upstash.io',
  davespoems_KV_REST_API_TOKEN: 'tok-prefixed',
  davespoems_KV_REST_API_READ_ONLY_TOKEN: 'tok-readonly',
  davespoems_KV_URL: 'rediss://user:pw@prefixed.upstash.io:6379',
  davespoems_REDIS_URL: 'rediss://user:pw@prefixed.upstash.io:6379'
}, ({ createStore, envReport }) => {
  const store = createStore();
  check('kind is kv', store.kind, 'kv');
  check('writable', store.writable, true);
  contains('detail names the prefixed variable', store.detail, 'davespoems_KV_REST_API_URL');
  const seen = envReport();
  check('envReport reports the prefixed name', seen.davespoems_KV_REST_API_URL, true);
  check('envReport reports the prefixed token', seen.davespoems_KV_REST_API_TOKEN, true);
  check('unprefixed name is not invented', seen.KV_REST_API_URL, undefined);
});

console.log('\nread-only token must not be mistaken for the write token');
withEnv({
  ...NO_FILE,
  davespoems_KV_REST_API_URL: 'https://prefixed.upstash.io',
  davespoems_KV_REST_API_READ_ONLY_TOKEN: 'tok-readonly'
}, ({ createStore }) => {
  const store = createStore();
  check('falls back to memory rather than using the read-only token', store.kind, 'memory');
});

console.log('\ncredentials are never crossed between two prefixes');
withEnv({
  ...NO_FILE,
  alpha_KV_REST_API_URL: 'https://alpha.upstash.io',
  alpha_KV_REST_API_TOKEN: 'tok-alpha',
  beta_UPSTASH_REDIS_REST_URL: 'https://beta.upstash.io',
  beta_UPSTASH_REDIS_REST_TOKEN: 'tok-beta'
}, ({ createStore }) => {
  const store = createStore();
  contains('picks the first list entry, alpha', store.detail, 'alpha_KV_REST_API_URL');
});

console.log('\nan exact name still beats a prefixed one');
withEnv({
  ...NO_FILE,
  KV_REST_API_URL: 'https://exact.upstash.io',
  KV_REST_API_TOKEN: 'tok-exact',
  something_KV_REST_API_URL: 'https://prefixed.upstash.io',
  something_KV_REST_API_TOKEN: 'tok-prefixed'
}, ({ createStore }) => {
  const store = createStore();
  contains('detail names the unprefixed variable', store.detail, 'via KV_REST_API_URL');
});

console.log('\nprefixed connection string, no REST credentials');
withEnv({
  ...NO_FILE,
  STORE: 'redis',
  davespoems_REDIS_URL: 'rediss://user:pw@prefixed.upstash.io:6379'
}, ({ createStore }) => {
  const store = createStore();
  /* The `redis` package is not a dependency, so this should land in memory —
     but with a message that names the variable it found. */
  check('kind is memory without the redis package', store.kind, 'memory');
  contains('explains what it found', store.detail, 'davespoems_REDIS_URL');
});

console.log('\nnothing connected');
withEnv({ ...NO_FILE }, ({ createStore, envReport }) => {
  const store = createStore();
  check('kind is memory', store.kind, 'memory');
  check('not writable', store.writable, false);
  contains('says what to do', store.detail, 'Upstash');
  check('envReport is empty', Object.keys(envReport()).length, 0);
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
