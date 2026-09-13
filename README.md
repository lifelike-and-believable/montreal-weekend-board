# Montreal Weekend Board

The Weekend Board, ported off the claude.ai artifact runtime onto Vercel,
as an installable PWA.

## What this is

`public/index.html` is the board. Lines between the `claude-shim.js` tag
and the closing `</script>` are **byte-identical to the artifact source** —
verified, not approximate. All the porting happens around them:

- `public/claude-shim.js` reimplements the three artifact runtime
  capabilities (`db`, `assets`, `sample`) against this app's own API, so
  the board's own code runs unmodified.
- The head carries the PWA manifest, icons and iOS meta.
- A small style block adds `env(safe-area-inset-*)` where standalone mode
  needs it. It does **not** touch the sticky filter bar's height — see the
  v12/v15 note in the board source.

## Layout

    public/index.html          the board (shell + unmodified board code)
    public/claude-shim.js      db / assets / sample shim
    public/gate.js             passcode gate
    public/sw.js               shell cache, /api never cached
    public/manifest.webmanifest
    public/icons/              app icons
    api/db.js                  document read/write
    api/upload.js              poster photo upload
    api/read-poster.js         Anthropic vision proxy (holds the API key)
    api/blob.js                serves /_blob/<photoId>, the artifact-era
                               asset path the board still builds
    api/data.js                serves /board-data.js — the four data
                               blocks, loaded before the board script
    api/refresh.js             the daily refresh POSTs the blocks here
    api/login.js api/session.js
    api/health.js              config presence check, booleans only
    lib/auth.js                signed cookie, one-year expiry
    lib/store.js               Redis documents, Blob photos

## Deploying

    npx vercel --prod

The Vercel project `montreal-weekend-board` already exists under the
Lifelike Dev Team, and a smoke deploy has validated the build config
(`outputDirectory: public` plus root `api/`).

## Required configuration

In the Vercel project settings:

| Variable | What it is |
|---|---|
| `AUTH_SECRET` | `openssl rand -base64 32`. Signs the session cookie. |
| `BOARD_PASSCODE` | The passcode you type on first launch. |
| `DOC_SALT` | `openssl rand -hex 16`. Namespaces documents and photo paths. |
| `REFRESH_SECRET` | `openssl rand -base64 32`. Bearer token for the daily refresh job. |
| `ANTHROPIC_API_KEY` | Poster reading. |
| `ANTHROPIC_MODEL` | Optional. Defaults to `claude-sonnet-5`. |

Plus two Storage integrations (Vercel dashboard, Storage tab):

- **Upstash Redis** — sets `KV_REST_API_URL` / `KV_REST_API_TOKEN`.
  Documents. Redis rather than Blob because blob reads come off a CDN,
  and a stale read would make a just-saved poster vanish from the board.
- **Vercel Blob** — sets `BLOB_READ_WRITE_TOKEN`. Poster photos.

And turn **Deployment Protection → Vercel Authentication** OFF for this
project. It is on by default for the team and its SSO redirect breaks the
home-screen app. The passcode gate replaces it.

`/api/health` reports which of these are present.

## Still to do

- **Phase 3, cut over the refresh.** Trigger `trig_01U8SVUJg5iV4YvZmB6NqsV4`
  still republishes the artifact. Add `api/refresh.js` accepting the four
  data blocks as JSON behind `REFRESH_SECRET`, rewrite the trigger prompt,
  run both for one weekend, then retire the artifact side.
- **Phase 4, simplify.** Once refresh writes JSON: drop `photoData`,
  demote `needsRead` to an error path, drop `thaw()`, delete the merge
  procedure from the project doc.
