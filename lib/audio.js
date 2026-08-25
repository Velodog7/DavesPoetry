/**
 * audio.js — recordings of the poems, read aloud, and where each word falls.
 *
 * A recording is not just a file to play. If the page is going to underline
 * words as they are spoken, it needs to know when each one is spoken, and it
 * needs to say so in the only vocabulary the rest of the site already uses:
 * word *index*. Index 0 is the first word of the poem as tokenised by
 * poetry-engine — the same index the poet's highlights are stored against.
 * Get that right and the follow-along, the highlights and the analysis all
 * agree about what a word is without any of them knowing about the others.
 *
 * Timings are produced offline by forced alignment (the text is known, so the
 * aligner only has to find it in the audio) and shipped with the deploy in
 * data/audio.json:
 *
 *   { "<poem id>": {
 *       "file": "ode-to-weeds.mp3",     // served from /audio/
 *       "duration": 56.61,
 *       "credit": "Read by the poet",
 *       "fingerprint": "2d526b611c5f",  // of the body the timings were cut to
 *       "words": [[start, end], ...]    // seconds, one pair per word, in order
 *   } }
 *
 * Two ways a recording can fall out of step with its poem, both handled here
 * rather than by the page:
 *
 *   - The poem was edited after the recording was made. The fingerprint no
 *     longer matches, so the timings may now point at words that moved. The
 *     audio still plays; the follow-along switches itself off.
 *   - The timings and the poem disagree about how many words there are. That
 *     is the same failure caught a different way, and it is caught even when
 *     the fingerprint was never written.
 */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const engine = require('./poetry-engine');

const FILE = path.join(__dirname, '..', 'data', 'audio.json');

let cache = null;

function all() {
  if (cache) return cache;
  try {
    cache = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch (err) {
    cache = {};                        /* no recordings shipped is a valid state */
  }
  return cache;
}

function fingerprint(body) {
  return crypto.createHash('sha256').update(String(body || ''), 'utf8')
    .digest('hex').slice(0, 12);
}

function audioFor(poem) {
  if (!poem) return null;
  const found = all()[poem.id];
  if (!found || !found.file) return null;

  const words = Array.isArray(found.words) ? found.words : [];
  const expected = engine.poemWords(poem.body).length;
  const drifted = found.fingerprint ? found.fingerprint !== fingerprint(poem.body) : false;
  const miscounted = words.length !== expected;

  return {
    src: '/audio/' + found.file,
    duration: Number(found.duration) || 0,
    credit: found.credit || '',
    /* Only sent when it can be trusted. A page given no timings simply plays
       the recording, which is the right thing to do with a poem that has been
       revised since it was read aloud. */
    words: (drifted || miscounted) ? [] : words,
    stale: drifted || miscounted
  };
}

function count() {
  return Object.keys(all()).length;
}

module.exports = { audioFor, fingerprint, count };
