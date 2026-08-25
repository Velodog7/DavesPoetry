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

  console.log('\ninline formatting');
  const eng = require('./lib/poetry-engine');
  check('markers are stripped from the words',
    eng.stripMarks('a **loud** and *quiet* ~~cut~~ line') === 'a loud and quiet cut line');
  check('a lone asterisk is left alone',
    eng.stripMarks('a lone * star') === 'a lone * star');
  check('a backslash escapes a marker',
    eng.stripMarks('an escaped \\* marker') === 'an escaped * marker');
  check('an unclosed marker stays literal',
    eng.stripMarks('an **unclosed run') === 'an **unclosed run');

  /* The invariant the whole design rests on: styling a word must not move it. */
  const plainW = eng.poemWords('the quick brown fox').map(w => w.i + ':' + w.s).join(' ');
  const styledW = eng.poemWords('the **quick** *brown* fox').map(w => w.i + ':' + w.s).join(' ');
  check('word positions do not move when a word is styled', plainW === styledW,
    `${plainW} vs ${styledW}`);

  r = await call('POST', '/poems', {
    title: 'A Styled Poem',
    body: 'the **loud** bell\nrang for the ~~lost~~ hour'
  }, authed);
  const styledId = r.data && r.data.id;
  check('a styled poem is accepted', r.status === 201);
  check('the analysis counts words, not markers', r.data.wordCount === 8, 'count ' + r.data.wordCount);

  r = await call('PUT', '/poems/' + styledId + '/highlights', { words: ['loud'] }, authed);
  check('highlights find a word through its markup', r.status === 200 && r.data.count === 1);
  r = await call('GET', '/poems/' + styledId);
  check('and resolve back to the bare word', r.data.highlightedWords.join(',') === 'loud');

  r = await call('GET', '/poems?search=loud');
  check('search matches the plain spelling', r.status === 200 && r.data.total === 1);

  await call('DELETE', '/poems/' + styledId, null, authed);

  console.log('\nclose readings');
  const readings = require('./lib/readings');
  check('readings ship with the deploy', readings.count() >= 23, `count ${readings.count()}`);

  /* A reading is written against one draft. Import that exact draft and the
     reading attaches clean; change a word and it must say so rather than
     quietly describing lines that no longer exist. */
  const REAL_ID = 'p_c1c07161cb8a915b';                 /* Ode to an Ammonite */
  const REAL_BODY = 'You lived.\nYou swam.\nYou were buoyant.\nYou were rapacious.\n' +
    'Fern-like suture lines\ndivide your coiled chambers:\nyour various snakestone homes.\n' +
    'You and yours withstood eons:\nThree hundred and sixty million years.\n' +
    'Witness to the Devonian, \nyou slipped through the needle-eye of the Permian’s end— \n' +
    'survivor of the Great Dying— \nto claim the Triassic and Jurassic seas, \n' +
    'until the Cretaceous fire turned your ink to stone.\nYou and yours perished, extinct:\n' +
    'your remains interred in limestone.\nYour form, curled and helical,\n' +
    'like the ram’s horn of Ammon,\nendures, circling \nagainst time.\n';

  await call('POST', '/import?merge=true',
    { poems: [{ id: REAL_ID, title: 'Ode to an Ammonite', body: REAL_BODY }] }, authed);

  r = await call('GET', '/poems/' + REAL_ID);
  check('a poem carries its own written reading', r.status === 200 && !!r.data.reading);
  check('the reading is about this poem, not a template',
    r.data.reading && /ammonite|ink to stone/i.test(JSON.stringify(r.data.reading)));
  check('the reading is not marked stale for the draft it was written against',
    r.data.reading && r.data.reading.stale === false,
    r.data.reading && JSON.stringify(r.data.reading.stale));
  check('it carries craft notes with quoted evidence',
    r.data.reading && r.data.reading.craft.length >= 3 &&
    r.data.reading.craft.every(c => c.move && c.line && c.why));

  await call('PATCH', '/poems/' + REAL_ID, { body: REAL_BODY + '\nA new line he added later.' }, authed);
  r = await call('GET', '/poems/' + REAL_ID);
  check('editing the poem marks its reading stale', r.data.reading && r.data.reading.stale === true);

  r = await call('GET', '/poems/' + id);
  check('a poem with no reading says null rather than inventing one', r.data.reading === null);

  r = await call('GET', '/poems/' + REAL_ID + '/analysis');
  check('the analysis endpoint carries it too', r.status === 200 && !!r.data.reading);

  await call('DELETE', '/poems/' + REAL_ID, null, authed);

  /* ------------------------------------------------ readings aloud ------ */
  console.log('\nrecordings');
  const AUDIO_ID = 'p_8c4dc81c955ff498';                /* Ode to Weeds */
  const AUDIO_BODY = 'Cutgrass:\nBeside crossties\nand in car parks\nthey paint green stripes \n' +
    'across white gravel.\nAlways first to arrive,\nthey seek accidents.\n' +
    'So they have been labeled:\ninvasive, aggressive.\n\nDogtooth:\n' +
    'On the fringes of the two-lane,\nthey meticulously erode\nthe black mortise of asphalt.\n' +
    'They hark to these barren places \nunfailingly, binding to them,\nmonogamous.\n\nVetch:\n' +
    'Intruders into the lawn,\nthat genteel crowd,\nthey soldier above, \n' +
    'right-angled from Earth,\ntowards the sun,\nwhich draws them only a trace,\n' +
    'only a scintilla nearer.\n\nIt is enough \nto give them elegant names:\n' +
    'Leersia, Cynodon, Lathyrus.\n\n';

  check('the recording is on disk where the page will ask for it',
    fs.existsSync(path.join(__dirname, 'audio', 'ode-to-weeds.mp3')));

  await call('POST', '/import?merge=true',
    { poems: [{ id: AUDIO_ID, title: 'Ode to Weeds', body: AUDIO_BODY }] }, authed);

  r = await call('GET', '/poems/' + AUDIO_ID);
  check('a recorded poem is served with its recording',
    r.status === 200 && !!(r.data.audio && r.data.audio.src), JSON.stringify(r.data.audio));
  check('with one timing per word',
    r.data.audio && r.data.audio.words.length === r.data.wordCount,
    r.data.audio && r.data.audio.words.length + ' vs ' + r.data.wordCount);
  check('the timings run forwards and stay inside the recording',
    r.data.audio && r.data.audio.words.every((w, i, all) =>
      w[0] <= w[1] && w[1] <= r.data.audio.duration + 0.5 && (i === 0 || w[0] >= all[i - 1][0])));
  check('and it is not marked stale for the draft it was read from',
    r.data.audio && r.data.audio.stale === false);

  /* The recording is of one draft. Revise the poem and the timings can no
     longer be trusted to point at the right words, so they are withheld —
     the audio still plays, it just stops claiming to know where it is. */
  await call('PATCH', '/poems/' + AUDIO_ID, { body: AUDIO_BODY + '\nA line added after the reading.' }, authed);
  r = await call('GET', '/poems/' + AUDIO_ID);
  check('editing the poem marks the recording stale', r.data.audio && r.data.audio.stale === true);
  check('and withholds the timings rather than misplacing them',
    r.data.audio && r.data.audio.words.length === 0);
  check('but still offers the recording', r.data.audio && !!r.data.audio.src);

  r = await call('GET', '/poems/' + id);
  check('a poem never read aloud says null rather than inventing audio', r.data.audio === null);

  await call('DELETE', '/poems/' + AUDIO_ID, null, authed);

  /* ------------------------------------------------------ the account --- */
  console.log('\nauthor account');

  r = await call('GET', '/auth');
  check('reports no account yet', r.status === 200 && r.data.configured === false);

  /* A retitled deploy must win over whatever the store was first seeded with,
     right up until someone owns the site. Otherwise the page paints the new
     name and the API immediately replaces it with the old one. */
  const seeded = require('./lib/store').readSeed();
  await call('POST', '/import?merge=true', { site: { name: 'Stale Old Name', byline: 'x' }, poems: [] }, authed);
  r = await call('GET', '/site');
  check('an unowned site takes its name from the deploy',
    r.status === 200 && r.data.name === seeded.site.name, JSON.stringify(r.data));

  /* Two example poems: one untouched, one the poet has already edited. Only
     the untouched one should disappear when the account is created. */
  await call('POST', '/import?merge=true', {
    poems: [
      { id: 'sample-a', title: 'Shipped Example', body: 'A line.\nAnother line.', sample: true },
      { id: 'sample-b', title: 'Edited Example', body: 'A line.\nAnother line.', sample: false }
    ]
  }, authed);
  /* The seed ships no examples, so an unowned site must not serve the ones
     already sitting in the store — not "eventually", now. */
  r = await call('GET', '/poems/sample-a');
  check('a shipped-none deploy hides a stored example immediately', r.status === 404);
  r = await call('GET', '/poems/sample-b');
  check('but keeps one the poet has touched', r.status === 200);
  r = await call('GET', '/poems');
  check('and the list agrees', r.data.poems.every(p => !p.sample));
  const served = r.data.total;
  r = await call('GET', '/health');
  check('health counts what a visitor sees, not the raw store',
    r.data.poems === served, `health ${r.data.poems} vs served ${served}`);

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
  check('nothing left to clear at setup', r.data.clearedSamples === 0);
  const session = { Authorization: `Bearer ${r.data.token}`, 'Content-Type': 'application/json' };

  r = await call('GET', '/poems/sample-a');
  check('the untouched example is gone', r.status === 404);
  r = await call('GET', '/poems/sample-b');
  check('the edited one is kept', r.status === 200);

  r = await call('GET', '/site');
  check('the deploy name is now frozen as his', r.status === 200 && r.data.name === seeded.site.name);
  r = await call('PATCH', '/site', { name: 'What Dave Calls It' }, session);
  check('and from here only he changes it', r.status === 200 && r.data.name === 'What Dave Calls It');
  r = await call('GET', '/site');
  check('his choice sticks, deploy or no deploy', r.data.name === 'What Dave Calls It');
  await call('PATCH', '/site', { name: seeded.site.name }, session);

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
