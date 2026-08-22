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
process.env.STORE = 'file';

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
  const server = require('./server');
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

  /* ------------------------------------------------------ the account --- */
  console.log('\nauthor account');

  r = await call('GET', '/auth');
  check('reports no account yet', r.status === 200 && r.data.configured === false);

  /* Two example poems: one untouched, one the poet has already edited. Only
     the untouched one should disappear when the account is created. */
  await call('POST', '/import?merge=true', {
    poems: [
      { id: 'sample-a', title: 'Shipped Example', body: 'A line.\nAnother line.', sample: true },
      { id: 'sample-b', title: 'Edited Example', body: 'A line.\nAnother line.', sample: false }
    ]
  }, authed);
  r = await call('GET', '/poems/sample-a');
  check('an example poem is in place', r.status === 200 && r.data.sample === true);

  r = await call('POST', '/auth/setup', { pin: '4913' });
  check('setup refuses without the setup key', r.status === 401);

  r = await call('POST', '/auth/setup', { pin: '1234' }, authed);
  check('rejects a common PIN', r.status === 400 && r.data.error === 'weak_pin');
  r = await call('POST', '/auth/setup', { pin: '5678' }, authed);
  check('rejects a straight run of digits', r.status === 400);
  r = await call('POST', '/auth/setup', { pin: '7777' }, authed);
  check('rejects a repeated digit', r.status === 400);
  r = await call('POST', '/auth/setup', { pin: '12a4' }, authed);
  check('rejects a non-numeric PIN', r.status === 400);

  r = await call('POST', '/auth/setup', { pin: '4913', name: 'Dave' }, authed);
  check('creates the account with the setup key', r.status === 201 && !!r.data.token);
  check('names the author', r.data.name === 'Dave');
  check('clears the untouched examples', r.data.clearedSamples === 1);
  const session = { Authorization: `Bearer ${r.data.token}`, 'Content-Type': 'application/json' };

  r = await call('GET', '/poems/sample-a');
  check('the untouched example is gone', r.status === 404);
  r = await call('GET', '/poems/sample-b');
  check('the edited one is kept', r.status === 200);

  r = await call('GET', '/auth');
  check('now reports an account', r.status === 200 && r.data.configured === true && r.data.name === 'Dave');
  check('never reveals the hash', JSON.stringify(r.data).indexOf('hash') < 0);

  r = await call('POST', '/auth/setup', { pin: '8261' }, authed);
  check('will not silently replace an existing account', r.status === 409);

  r = await call('GET', '/export', null, session);
  check('the session can do author work', r.status === 200);
  check('the export carries no account data', r.status === 200 && r.data.auth === undefined);

  r = await call('POST', '/auth/session', { pin: '4913' });
  check('signs in with the PIN', r.status === 200 && !!r.data.token);
  const session2 = { Authorization: `Bearer ${r.data.token}`, 'Content-Type': 'application/json' };

  r = await call('POST', '/auth/session', { pin: '9111' });
  check('rejects a wrong PIN', r.status === 401 && r.data.error === 'wrong_pin');
  check('counts down the remaining tries', r.data.attemptsRemaining === 4);

  r = await call('GET', '/auth/session', null, session2);
  check('confirms a live session', r.status === 200 && r.data.valid === true);
  r = await call('DELETE', '/auth/session', null, session2);
  check('signs out', r.status === 200);
  r = await call('GET', '/auth/session', null, session2);
  check('the signed-out session is dead', r.status === 200 && r.data.valid === false);
  r = await call('GET', '/export', null, session2);
  check('and cannot do author work', r.status === 401);

  /* Lock the account, then confirm the master token is still a way back in. */
  for (let i = 0; i < 5; i++) await call('POST', '/auth/session', { pin: '9112' });
  r = await call('POST', '/auth/session', { pin: '4913' });
  check('locks after repeated wrong PINs', r.status === 429 && r.data.error === 'locked');
  check('says how long the wait is', typeof r.data.retryAfter === 'number' && r.data.retryAfter > 0);
  r = await call('GET', '/export', null, authed);
  check('the master token still works while locked', r.status === 200);

  r = await call('POST', '/auth/setup', { pin: '6142', reset: true }, authed);
  check('the setup key resets a forgotten PIN', r.status === 200 && r.data.reset === true);
  const session3 = { Authorization: `Bearer ${r.data.token}`, 'Content-Type': 'application/json' };
  r = await call('POST', '/auth/session', { pin: '6142' });
  check('the reset clears the lockout', r.status === 200);
  r = await call('GET', '/export', null, session);
  check('the reset killed the older sessions', r.status === 401);

  r = await call('POST', '/auth/pin', { currentPin: '9113', pin: '5391' }, session3);
  check('changing the PIN needs the current one', r.status === 401);
  r = await call('POST', '/auth/pin', { currentPin: '6142', pin: '5391' }, session3);
  check('changes the PIN', r.status === 200 && !!r.data.token);
  const session4 = { Authorization: `Bearer ${r.data.token}`, 'Content-Type': 'application/json' };
  r = await call('POST', '/auth/session', { pin: '5391' });
  check('the new PIN works', r.status === 200);
  r = await call('POST', '/auth/session', { pin: '6142' });
  check('the old PIN does not', r.status === 401);

  r = await call('POST', '/import', { poems: [], auth: { pin: { hash: 'x', salt: 'y' } } }, session4);
  check('import is not a way to overwrite the account', r.status === 200);
  r = await call('POST', '/auth/session', { pin: '5391' });
  check('the account survived that import', r.status === 200);

  await call('POST', '/import', backup, session4);   /* put the poems back */

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
