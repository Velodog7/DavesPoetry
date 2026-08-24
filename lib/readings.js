/**
 * readings.js — the close readings, one per poem.
 *
 * The analysis engine next door counts things: syllables, line endings, word
 * families. That is honest work and it is not the same as reading a poem. It
 * cannot tell you that an ammonite's ink turning to stone is both palaeontology
 * and a metaphor for writing, because noticing that requires having read the
 * poem rather than measured it.
 *
 * So the readings are written, not computed, and shipped with the deploy in
 * data/readings.json. Two consequences worth knowing:
 *
 *   - A poem written after these were composed has no reading. The site says
 *     so plainly rather than generating filler.
 *   - A poem edited after its reading was written may have moved out from under
 *     it. Each reading carries a fingerprint of the text it was written against,
 *     and a reading whose poem has changed is marked rather than trusted.
 */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'data', 'readings.json');

let cache = null;

function all() {
  if (cache) return cache;
  try {
    cache = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch (err) {
    cache = {};                       /* no readings shipped is a valid state */
  }
  return cache;
}

/* Short on purpose: this only has to notice that a poem changed, not resist
   anyone trying to forge one. Twelve hex characters is plenty for that. */
function fingerprint(body) {
  return crypto.createHash('sha256').update(String(body || ''), 'utf8')
    .digest('hex').slice(0, 12);
}

function readingFor(poem) {
  if (!poem) return null;
  const found = all()[poem.id];
  if (!found) return null;

  const current = fingerprint(poem.body);
  return {
    standfirst: found.standfirst,
    paragraphs: found.paragraphs || [],
    craft: found.craft || [],
    /* True when the poem has been revised since the reading was written. The
       reading is still shown — it is mostly still right — but the page says
       which draft it was reading. */
    stale: found.fingerprint !== current
  };
}

function count() {
  return Object.keys(all()).length;
}

module.exports = { readingFor, fingerprint, count };
