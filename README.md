# Dad's Verses — REST API

A small HTTP API over your dad's poems: the poems themselves, the words he has
chosen to highlight, likes, comments, and the same literary analysis the website
runs (form detection, key words, imagery, sound, syntax).

No dependencies. Node 18 or newer. Data lives in a single JSON file.

---

## Running it

```bash
cd api
node server.js
```

Then visit <http://localhost:3000/api/health>.

Configuration is all environment variables:

| Variable | Default | What it does |
|---|---|---|
| `PORT` | `3000` | Port to listen on |
| `DATA_FILE` | `./data.json` | Where poems are stored |
| `AUTHOR_TOKEN` | *generated at boot* | Secret needed for the poet's own actions |
| `CORS_ORIGIN` | `*` | Restrict which sites may call the API |

```bash
PORT=4000 AUTHOR_TOKEN=a-long-random-string node server.js
```

If you don't set `AUTHOR_TOKEN`, the server generates one and prints it on
startup — so it's never accidentally open to the world, but it changes on every
restart. Set it explicitly for anything real.

---

## Who can do what

**Anyone** can read poems, read highlights, read the analysis, like a poem, and
leave a comment.

**Only the author** can create, edit or delete poems, set highlights, import
data, export data, or remove a comment. Those requests need the token:

```
Authorization: Bearer <AUTHOR_TOKEN>
```

---

## Endpoints

### Service

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/health` | Liveness plus a poem count |
| `GET` | `/api/collection` | Whole-collection summary, form tally, and per-poem trends |
| `GET` | `/api/forms` | Every form in use, with counts and display colours |
| `GET` | `/api/tags` | Every theme tag, with counts |
| `GET` | `/api/export` | 🔒 Full raw data, for backups |
| `POST` | `/api/import?merge=true` | 🔒 Restore or merge a backup |

### Poems

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/poems` | List. Query: `search`, `form`, `tag`, `highlighted=true`, `sort` (`newest`\|`oldest`\|`title`\|`likes`), `limit`, `offset` |
| `POST` | `/api/poems` | 🔒 Create. Body: `{title, body, date?, tags?, style?, highlights?}` |
| `GET` | `/api/poems/:id` | One poem, with its detected form and key words |
| `PATCH` | `/api/poems/:id` | 🔒 Update any subset of fields |
| `DELETE` | `/api/poems/:id` | 🔒 Delete |

### Highlights — the words the poet has marked

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/poems/:id/highlights` | The marked words and their positions |
| `PUT` | `/api/poems/:id/highlights` | 🔒 Replace. Body: `{"words":["hold"]}` or `{"indices":[3,7]}` |
| `POST` | `/api/poems/:id/highlights` | 🔒 Add to the existing set |
| `DELETE` | `/api/poems/:id/highlights` | 🔒 Clear them all |
| `GET` | `/api/poems/:id/suggestions?limit=6` | Key words worth marking, with their positions |

A highlight is stored as the **position of a word** in the poem, counting words
from zero. That means the same word can be marked in one place and left plain in
another. When the poem's text is edited, highlights are re-anchored to the same
words automatically — insert a line at the top and the marks move with the words
rather than sliding out of place.

Passing `{"words": [...]}` marks *every* occurrence of those words; passing
`{"indices": [...]}` gives you exact control.

### Analysis

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/poems/:id/analysis` | Form and evidence, rhyme density and schemes, enjambment, key words, imagery fields, alliteration, assonance, repeated phrases, similes, punctuation habits |

### Engagement

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/poems/:id/likes` | Current count |
| `POST` | `/api/poems/:id/likes` | Like. Identify the reader via `X-Visitor-Id` header or `{"visitorId":"…"}` |
| `DELETE` | `/api/poems/:id/likes` | Unlike |
| `GET` | `/api/poems/:id/comments` | List |
| `POST` | `/api/poems/:id/comments` | Add. Body: `{name, text}` |
| `DELETE` | `/api/poems/:id/comments/:commentId` | 🔒 Remove |

🔒 = author token required.

---

## Examples

```bash
TOKEN=your-author-token
API=http://localhost:3000/api

# Every ode, newest first
curl "$API/poems?form=ode"

# What has he marked in this one?
curl "$API/poems/seed3/highlights"

# Mark every instance of two words
curl -X PUT "$API/poems/seed3/highlights" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"words":["hold","bless"]}'

# Mark two exact positions instead
curl -X PUT "$API/poems/seed3/highlights" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"indices":[0,1]}'

# Read the close analysis
curl "$API/poems/seed3/analysis"

# Add a poem
curl -X POST "$API/poems" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"title":"Ode to the Back Porch","body":"You never asked for praise, plain porch,\nyou steady shelf of weathered pine.","tags":["home","praise"],"highlights":["praise"]}'

# Back everything up
curl -H "Authorization: Bearer $TOKEN" "$API/export" > backup.json
```

---

## Errors

Every failure returns JSON with a stable `error` code:

```json
{ "error": "unauthorized", "message": "This needs the author token: ..." }
```

| Code | Status | Meaning |
|---|---|---|
| `bad_request` | 400 | Something required was missing or malformed |
| `invalid_json` | 400 | The body wasn't valid JSON |
| `unauthorized` | 401 | Missing or wrong author token |
| `not_found` | 404 | No such poem, comment, or route |
| `method_not_allowed` | 405 | Wrong verb for that path |
| `payload_too_large` | 413 | Body over 512 KB |
| `internal_error` | 500 | A bug — check the server log |

---

## Moving data between the website and this server

The published site holds its own copy of the poems. To move them here:

1. Open the site, unlock author mode, and open the browser console.
2. Run `copy(DadsVerses.exportJSON(true))` — the data is now on your clipboard.
3. Paste it into `data.json` next to `server.js` and restart the server.

Going the other way:

```bash
curl -H "Authorization: Bearer $TOKEN" "$API/export" > from-server.json
```

then in the site's console, with author mode unlocked:

```js
DadsVerses.importJSON(pastedJsonString)          // replace everything
DadsVerses.importJSON(pastedJsonString, {merge: true})  // only add what's new
```

The two share identical resource shapes, so anything you write against one works
against the other. The in-page API even mirrors the HTTP routes:

```js
await DadsVerses.fetch('/api/poems?form=ode')
await DadsVerses.fetch('/api/poems/seed3/highlights', { method: 'PUT', body: { words: ['hold'] } })
```

---

## Files

| File | What it is |
|---|---|
| `server.js` | The whole server — routing, auth, storage |
| `poetry-engine.js` | The analysis engine, extracted from the site so both agree exactly |
| `data.json` | The poems (created on first write if missing) |
| `openapi.json` | Machine-readable spec, for Postman / Swagger / codegen |
| `smoke-test.js` | `npm run smoke` — starts the server and exercises every route |

## A note on the analysis

The engine is heuristic: it counts syllables, word endings, opening sounds, line
positions and word families. It's good at describing what a poem *does* — its
form, its repetitions, where it breaks its lines. It has no opinion on whether
the poem is any good. That part stays with the reader.
