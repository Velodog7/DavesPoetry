#!/usr/bin/env node
/**
 * smoke-test.js — starts the API on a scratch port with a scratch data file and
 * exercises every route. Run with: npm run smoke
 *
 * Exits non-zero on the first failure, so it works as a CI gate.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = 4599;
const TOKEN = 'smoke-test-token';
const DATA_FILE = path.join(os.tmpdir(), 'dads-verses-smoke-' + Date.now() + '.json');

process.env.PORT = String(PORT);
process.env.AUTHOR_TOKEN = TOKEN;
process.env.DATA_FILE = DATA_FILE;

const BASE = `http://localhost:${PORT}/api`;
const authed = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };

let passed = 0;
const failures = [];

function check(label, condition, detail) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failures.push(label + (detail ? ` — ${detail}` : ''));
    console.log(`  ✗ ${label}${detail ? ' — ' + detail : ''}`);
  }
}

async function call(method, path, body, headers) {
  const res = await fetch(BASE + path, {
    method,
    headers: headers || (body ? { 'Content-Type': 'application/json' } : undefined),
    body: body ? JSON.stringify(body) : undefined
  });
  let data = null;
  try { data = await res.json(); } catch (_) { /* empty body is fine */ }
  return { status: res.status, data };
}

async function run() {
  const { server } = require('./server');
  await new Promise(resolve => server.listen(PORT, resolve));
  console.log(`\nSmoke test against ${BASE}\n`);

  console.log('service');
  let r = await call('GET', '/health');
  check('health responds', r.status === 200 && r.data.status === 'ok');

  console.log('\npoems');
  r = await call('POST', '/poems', { title: 'Ode to a Test Harness', body: 'You never complain, patient machine,\nyou run the same green road each night.' }, authed);
  check('create requires nothing more than title and body', r.status === 201, `status ${r.status}`);
  const id = r.data && r.data.id;
  check('detects the ode from its title', r.data && r.data.form === 'Ode', r.data && r.data.form);

  r = await call('POST', '/poems', { title: 'No body' }, authed);
  check('rejects a poem with no body', r.status === 400);

  r = await call('POST', '/poems', { title: 'x', body: 'y' });
  check('rejects an unauthenticated create', r.status === 401);

  r = await call('GET', '/poems');
  check('lists poems with a total', r.status === 200 && typeof r.data.total === 'number');

  r = await call('GET', '/poems?form=ode');
  check('filters by form', r.status === 200 && r.data.poems.every(p => p.form === 'Ode'));

  r = await call('GET', '/poems/' + id);
  check('fetches one poem', r.status === 200 && r.data.id === id);

  r = await call('GET', '/poems/does-not-exist');
  check('404s an unknown poem', r.status === 404 && r.data.error === 'not_found');

  console.log('\nhighlights');
  r = await call('GET', '/poems/' + id + '/suggestions?limit=3');
  check('suggests words worth marking', r.status === 200 && Array.isArray(r.data) && r.data.length > 0);

  r = await call('PUT', '/poems/' + id + '/highlights', { words: ['patient'] }, authed);
  check('marks every instance of a word', r.status === 200 && r.data.count >= 1, JSON.stringify(r.data));
  check('returns the marked word itself', r.data.highlights[0].word.toLowerCase() === 'patient');

  r = await call('POST', '/poems/' + id + '/highlights', { words: ['machine'] }, authed);
  check('adds to the existing marks', r.status === 200 && r.data.count >= 2);

  r = await call('PUT', '/poems/' + id + '/highlights', { indices: [0, 1] }, authed);
  check('accepts exact word positions', r.status === 200 && r.data.count === 2);

  r = await call('PUT', '/poems/' + id + '/highlights', { nonsense: true }, authed);
  check('rejects a malformed highlight body', r.status === 400);

  r = await call('PUT', '/poems/' + id + '/highlights', { words: ['patient'] });
  check('rejects unauthenticated highlighting', r.status === 401);

  console.log('\nhighlights survive an edit');
  await call('PUT', '/poems/' + id + '/highlights', { words: ['patient'] }, authed);
  const before = (await call('GET', '/poems/' + id)).data.highlightedWords;
  r = await call('PATCH', '/poems/' + id, { body: 'A new opening line\nYou never complain, patient machine,\nyou run the same green road each night.' }, authed);
  check('re-anchors marks after the text changes',
    JSON.stringify(r.data.highlightedWords) === JSON.stringify(before),
    `${JSON.stringify(before)} → ${JSON.stringify(r.data.highlightedWords)}`);

  console.log('\nanalysis');
  r = await call('GET', '/poems/' + id + '/analysis');
  check('returns a form and evidence', r.status === 200 && !!r.data.form && !!r.data.evidence);
  check('returns key words', Array.isArray(r.data.keyWords) && r.data.keyWords.length > 0);

  r = await call('GET', '/collection');
  check('summarises the collection', r.status === 200 && r.data.poems >= 1 && Array.isArray(r.data.forms));

  console.log('\nengagement');
  r = await call('POST', '/poems/' + id + '/likes', { visitorId: 'smoke' });
  check('likes a poem', r.status === 200 && r.data.likes === 1);
  r = await call('POST', '/poems/' + id + '/likes', { visitorId: 'smoke' });
  check('a second like from the same reader does not double-count', r.data.likes === 1);
  r = await call('DELETE', '/poems/' + id + '/likes', { visitorId: 'smoke' });
  check('unlikes', r.data.likes === 0);

  r = await call('POST', '/poems/' + id + '/comments', { name: 'Smoke', text: 'Reads well.' });
  check('accepts a comment from anyone', r.status === 201);
  const commentId = r.data.id;
  r = await call('POST', '/poems/' + id + '/comments', { name: 'Smoke' });
  check('rejects a comment with no text', r.status === 400);
  r = await call('DELETE', '/poems/' + id + '/comments/' + commentId);
  check('only the author may remove a comment', r.status === 401);
  r = await call('DELETE', '/poems/' + id + '/comments/' + commentId, null, authed);
  check('author removes a comment', r.status === 200);

  console.log('\ndata');
  r = await call('GET', '/export', null, authed);
  check('exports everything', r.status === 200 && Array.isArray(r.data.poems));
  const backup = r.data;
  r = await call('GET', '/export');
  check('export needs the token', r.status === 401);
  r = await call('POST', '/import', backup, authed);
  check('imports a backup', r.status === 200 && r.data.imported === backup.poems.length);

  console.log('\ncleanup');
  r = await call('DELETE', '/poems/' + id, null, authed);
  check('deletes a poem', r.status === 200 && r.data.deleted === true);
  r = await call('GET', '/poems/' + id);
  check('the deleted poem is gone', r.status === 404);

  r = await call('GET', '/nope');
  check('404s an unknown route', r.status === 404);

  server.close();
  try { fs.unlinkSync(DATA_FILE); } catch (_) {}

  console.log(`\n${passed} passed, ${failures.length} failed\n`);
  if (failures.length) {
    failures.forEach(f => console.log('  FAILED: ' + f));
    process.exit(1);
  }
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
