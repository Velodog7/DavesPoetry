# Dave's Poetry — site + API

## What went wrong, and what changed

The old `server.js` was a long-running Node server: it called `server.listen()`
and waited for connections. Vercel never runs a process like that. It runs one
short-lived **function per request** and calls an exported handler. There was no
handler to call, so every request died with `FUNCTION_INVOCATION_FAILED`.

There was a second problem waiting behind it: the API stored poems in
`data.json` on disk. On Vercel the filesystem is **read-only**, and anything
written to the one writable directory (`/tmp`) disappears when the function goes
cold. Even with the crash fixed, every like, comment and edit would have
evaporated within minutes.

Both are fixed:

- **`lib/api.js`** holds every route and exports a plain `(req, res)` handler.
- **`api/index.js`** is the Vercel entry point — three lines that re-export it.
- **`server.js`** is now just a local wrapper around the same handler, so what
  you run on your laptop is the same code Vercel runs.
- **`lib/store.js`** abstracts storage, with a real persistent option for
  serverless.

---

## Deploying it

### 1. Repo layout

Put these at the **root** of the repo:

```
api/index.js          ← Vercel finds this automatically
lib/api.js
lib/store.js
lib/auth.js
lib/poetry-engine.js
data/seed.json        ← the starting poems
index.html            ← the website
vercel.json
package.json
server.js             ← local only; Vercel ignores it
smoke-test.js
store-test.js
```

There is nothing to build and nothing to install — no dependencies.

### 2. Connect a database (this is the important step)

Vercel no longer has its own "KV" tile — that product moved into the marketplace
and is now **Upstash**. In the dashboard:

**Storage → Upstash → Redis → Create**

Connect it to the `daves-poetry` project when prompted. Upstash injects
`UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` (or the `KV_REST_API_*`
spelling of the same pair), which the API picks up with no further
configuration. On the first request it copies `data/seed.json` into the store.
There is a free tier that is far more than a poetry site needs.

> **About the "custom prefix" box.** Vercel offers one when you connect the
> database, and it renames *every* variable: type `davespoems` and you get
> `davespoems_KV_REST_API_URL` instead of `KV_REST_API_URL`. The API handles
> this — it matches the known name at the end of any variable, and pairs the URL
> with the token carrying the same prefix, so two connected databases never get
> their credentials crossed. Leaving the box empty is still simpler. Either way
> `/api/health` prints the names it actually found, prefix included.

> **Pick Upstash, not the "Redis" tile.** They look interchangeable in that list
> and they are not:
>
> | | Upstash → Redis | Redis (Redis Cloud) |
> |---|---|---|
> | Credentials | `UPSTASH_REDIS_REST_URL` + `_TOKEN` | `REDIS_URL` connection string |
> | Client library | none — plain REST | `npm install redis` |
> | Free plan persistence | yes, written to disk | **no — RAM only** |
>
> That last row is the one that matters. Redis Cloud's free plan says it plainly
> on the confirmation screen: *"RAM-only Redis database. No persistence or high
> availability."* Everything lives in memory, so a restart on their side takes
> the poems with it. Fine for a cache; wrong for the only copy of someone's
> writing.
>
> If you have already created a Redis Cloud database, delete it and create an
> Upstash one instead. The API does support connection-string Redis — set
> `STORE=redis` and add `"redis": "^4"` to `dependencies` — but on a free plan
> that has no persistence, don't rely on it.

Without a database the API still **serves** the poems, but refuses writes with a
clear `503 read_only` rather than pretending to save.

### Checking it worked

```bash
curl https://daves-poetry.vercel.app/api/health
```

```json
{
  "status": "ok",
  "storage": { "kind": "kv", "writable": true, "detail": "Upstash Redis (via UPSTASH_REDIS_REST_URL)" },
  "authorTokenConfigured": true,
  "poems": 6,
  "environmentSeen": { "UPSTASH_REDIS_REST_URL": true, "UPSTASH_REDIS_REST_TOKEN": true, "AUTHOR_TOKEN": true },
  "nextStep": null
}
```

`environmentSeen` lists which variables the running deploy can actually read —
names only, never values — and `nextStep` tells you what is still missing. If
`kind` is `memory`, nothing is connected yet.

### 3. Set the author token

**Settings → Environment Variables → Add**

| Name | Value |
|---|---|
| `AUTHOR_TOKEN` | a long random string you keep private |

Generate one with `openssl rand -hex 24`.

Without it the API refuses *all* writes with `503 no_author_token` — deliberately,
so a fresh deploy is never wide open to the internet.

Redeploy after adding environment variables; Vercel only picks them up on a new
build.

### 4. Hand the site to the poet

`AUTHOR_TOKEN` is the **setup key**, not the day-to-day password. He uses it
exactly once:

1. He opens the site and presses the lock button.
2. **Create your account** — his name, the setup key, and a PIN he chooses.
3. From then on it is just the PIN, on a keypad built for tapping.

After that he never needs the token again, and you never need to give him a
48-character hex string to type.

**Why a setup key at all?** The site is public. An open "create the author
account" button belongs to whoever finds the page first — and that is not
necessarily the person it was built for.

**A four-digit PIN on a public page** is only safe because guessing is made
expensive, so the server does three things and none of them are optional:

- The PIN is never stored — only a salted **scrypt** hash of it.
- Five wrong tries in fifteen minutes lock sign-in for 15 minutes, then an
  hour, then four. Ten thousand guesses stop being a weekend's work.
- Obvious PINs (`1234`, `0000`, straight runs, repeated digits) are refused at
  the point of choosing.

Signing in issues a **session token**, good for 90 days on that device, so the
PIN itself travels once rather than on every request. Changing the PIN — or
resetting it with the setup key — revokes every session everywhere.

**If he forgets the PIN**, the sign-in screen offers *"Forgotten it? Reset with
the setup key"*. That is what `AUTHOR_TOKEN` is for. Keep it somewhere you can
find it.

---

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `AUTHOR_TOKEN` | *(none)* | Required for any write. Without it, writes are refused. |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` | *(none)* | Set by the Upstash integration. `KV_REST_API_URL` / `_TOKEN` also work, as does either pair behind a custom prefix. |
| `REDIS_URL` | *(none)* | A connection string (Redis Cloud). Needs the `redis` package installed. |
| `STORE` | auto | Force `kv`, `redis`, `file` or `memory` instead of auto-detecting. |
| `DATA_FILE` | `data/data.json` | Where the file store writes, when using one. |
| `KV_KEY` | `dads-verses:data` | The key the collection is stored under. |
| `CORS_ORIGIN` | `*` | Restrict which sites may call the API. |

---

## Running locally

```bash
AUTHOR_TOKEN=dev-token node server.js
```

- Site — <http://localhost:3000>
- API — <http://localhost:3000/api/health>

It uses the file store on disk, so your local poems persist normally.

```bash
npm run smoke        # 65 checks against every route, sign-in included
npm run test:store   # 19 checks on storage detection, prefixes included
```

---

## The endpoints

Unchanged from before, with one addition (`/api/site`). Full machine-readable
detail is in `openapi.json`.

| | Path | Auth |
|---|---|---|
| `GET` | `/api/health` | — |
| `GET` | `/api/auth` | — |
| `POST` | `/api/auth/setup` | 🔑 setup key |
| `GET` `POST` `DELETE` | `/api/auth/session` · `?all=true` | PIN to open one |
| `POST` | `/api/auth/pin` | 🔒 + current PIN |
| `GET` | `/api/poems` · `?search= &form= &tag= &highlighted=true &sort= &limit= &offset=` | — |
| `POST` | `/api/poems` | 🔒 |
| `GET` `PATCH` `DELETE` | `/api/poems/:id` | 🔒 to change |
| `GET` `PUT` `POST` `DELETE` | `/api/poems/:id/highlights` | 🔒 to change |
| `GET` | `/api/poems/:id/suggestions` | — |
| `GET` | `/api/poems/:id/analysis` | — |
| `GET` `POST` `DELETE` | `/api/poems/:id/likes` | — |
| `GET` `POST` | `/api/poems/:id/comments` | — |
| `DELETE` | `/api/poems/:id/comments/:commentId` | 🔒 |
| `GET` `PATCH` | `/api/site` | 🔒 to change |
| `GET` | `/api/collection` · `/api/forms` · `/api/tags` | — |
| `GET` | `/api/export` | 🔒 |
| `POST` | `/api/import?merge=true` | 🔒 |

```bash
TOKEN=your-author-token
API=https://daves-poetry.vercel.app/api

curl "$API/poems?form=ode"

curl -X PUT "$API/poems/seed3/highlights" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"words":["hold","bless"]}'

curl -H "Authorization: Bearer $TOKEN" "$API/export" > backup.json
```

---

## Loading his real poems

Export from the Claude-hosted version (open it, unlock author mode, open the
browser console):

```js
copy(DadsVerses.exportJSON(true))
```

Then either paste it into `data/seed.json` and redeploy, or push it straight in:

```bash
curl -X POST "$API/import" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  --data-binary @backup.json
```

---

## How the site talks to the API

`index.html` works out where it is running and saves accordingly:

| Where | How it saves |
|---|---|
| On this server / Vercel | Reads and writes over the API. Likes and comments from any visitor persist for everyone. |
| Hosted on claude.ai | Republishes itself, as before. |
| Opened as a plain file | Shows the built-in poems and saves nothing, saying so plainly. |

Nothing to configure — it probes `/api/health` on load. To point the page at an
API on another domain, add this to the `<head>`:

```html
<meta name="poems-api" content="https://your-api.example.com/api">
```

### Signing in to write

The lock button shows one of three things, depending on where it finds itself:

| | What it asks for |
|---|---|
| No account yet, setup key available | Name, setup key, and a PIN to choose |
| Account exists | The PIN, on a keypad |
| No account and no `AUTHOR_TOKEN` | An explanation of what the owner needs to do |

The session token lives in that browser's local storage, so he signs in once
per device. On load the page asks the server whether that token is still
good, rather than trusting what it finds locally — so a session revoked from
another device really is gone.

Readers need nothing: liking and commenting are open to anyone.

From the console, `DadsVerses.backend()` reports which mode the page is in,
`DadsVerses.unlock("4913")` signs in with a PIN (or with the master token, if
you pass something that isn't 4–8 digits), and `DadsVerses.reload()` pulls
fresh data from the server.

## A note on concurrency

Each write reads the whole collection, changes it, and writes it back. Two
people saving in the same second could have one change overwrite the other.
For a family poetry site that is a non-issue; worth knowing if it ever gets busy.
