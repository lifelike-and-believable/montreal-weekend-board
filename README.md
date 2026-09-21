# Montreal Weekend Board

The Weekend Board, ported off the claude.ai artifact runtime onto Vercel,
as an installable PWA.

## What this is

`public/index.html` is the board. Through the port, the lines between the
`claude-shim.js` tag and the closing `</script>` were kept byte-identical
to the artifact source, so the board's own code could run unmodified while
everything around it was rewritten. The artifact has since been retired,
and that constraint with it — the board is now ordinary source, edited in
place like anything else here.

Most of the porting still sits outside it, because that is where it
belongs, not because it has to:

- `public/claude-shim.js` reimplements the three capabilities the board
  asks the host for (`db`, `assets`, `sample`) against this app's own API.
- The head carries the PWA manifest, icons and iOS meta.
- A small style block adds `env(safe-area-inset-*)` where standalone mode
  needs it. It does **not** touch the sticky filter bar's height — see the
  v12/v15 note in the board source.
- "Running all weekend" and "Out of town" fold away like the day boards.
  The board only sets `.hidden` on those sections and refills their grid,
  so a class on the `<section>` and a count read off the grid both survive
  every re-render — no board edit needed. Unlike a folded day, the choice
  is not scoped to a weekend: it is a standing preference.
- A banner above the masthead says when the listings on screen are not
  this weekend's. The board falls back to its inline blocks silently, so
  without it a dead refresh and a live one look identical. It reads
  `__BOARD_FRESH__` and lives outside the board's script, like everything
  else here.

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
    api/blob.js                serves /_blob/<photoId>, the asset path
                               the board builds for poster photos
    api/data.js                serves /board-data.js — the four data
                               blocks, loaded before the board script,
                               and __BOARD_FRESH__ saying which path it
                               took, so a dead refresh can be seen
    api/refresh.js             the daily refresh POSTs the blocks here,
                               and prunes what the last weekend left
    api/login.js api/session.js
    api/health.js              config presence check, booleans only
    lib/auth.js                signed cookie, one-year expiry
    lib/store.js               Redis documents, Blob photos
    lib/prune.js               reclaims expired records, their photos,
                               and stale plan documents
    lib/location.js            reads the free-text `hood` into a
                               structured `loc`, additively
    lib/metro.js               station -> line, verified, ASCII-keyed
    tests/                     node --test; `npm test` runs them all

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

### The métro dot

The station on each row carries a dot per line, using the same dot the
category chips use. A dot rather than tinted text: the yellow line has no
readable text colour on this background, and recolouring the text would
make the greyest thing on the card the loudest. The text is unchanged.

Only records the refresh wrote have `loc`, so only they get dots. The
inline fallback listings and captured posters render as they always did.

### Getting from one pick to the next

The itinerary already worked out the gap between consecutive picks and
called anything under half an hour "to get across town — tight". It said
that whether the two things were on opposite sides of the island or on the
same street, because nothing in the board knew where anything was.

With `loc` it does, so the same line now says what is true:

    30 min free · both in Mile End
    15 min — direct on the orange line, tight
    15 min to get across town — tight
    15 min between them — tight          (when either end is unplaced)

No distance is computed and no journey time is invented — nothing here
knows how far apart two addresses are. It knows only whether two picks
share a neighbourhood, a station, or a line, which is enough to stop the
board calling a walk down the street a trip across town. An overlap is
still an overlap, and a comfortable gap only names the relationship when
there is something useful to say.

### Posters that could not be read

The poster read is synchronous: you photograph one, `api/read-poster.js`
reads it, and the form comes back filled in. When that read does not yield
a title and a date, the record is held off the board and listed under
"Needs filling in" until you complete it.

It used to say the record was "queued for the morning" and that the
refresh would read it later. Nothing ever did — no server path has ever
looked at a spotted record, and the only one that touches them now is the
prune. The wording says what actually happens, and a test asserts the
promise cannot creep back while no server code could keep it.

Three things went with that, all carried since the artifact:

- `thaw()`, which defensively copied every snapshot because the artifact
  host froze them. The shim does not, so it had been a no-op since the
  port; a test pins that the shim still does not freeze.
- `photoData`, a base64 copy of the poster inside the record, kept so the
  never-existent later read would have something to look at. Photos are
  served from `/_blob/<photoId>`. **A record captured before this whose
  upload had failed loses its thumbnail** — it keeps everything else.
- `thumbDataUrl`, which built that copy.

## Housekeeping

The refresh prunes as it writes. It is the only moment the app knows the
weekend has turned over, so that is where reclaiming happens:

- spotted records dated more than 30 days before the new weekend, and the
  photos behind them
- photos no record refers to any more — `dropSpotted` deletes the
  document and nothing ever deleted the blob — once they are more than 7
  days old, so a photo uploaded mid-capture is never taken
- `plans/<weekendId>` documents older than 120 days

A record with no date on it is never touched: that is a poster still
waiting to be read. Nothing here can fail a refresh — the listings are
already stored by then, and problems come back in `pruned.errors`.

    # what a run would remove, without removing it
    curl -X POST https://<host>/api/refresh \
      -H "authorization: Bearer $REFRESH_SECRET" \
      -H "content-type: application/json" \
      -d '{"pruneDryRun":true, ...blocks}'

`"prune": false` skips it entirely. `npm test` covers the rules above,
the freshness banner, the service worker's cache behaviour, the location
parsing, and the two board helpers — which are lifted straight out of
`index.html` and run as they ship.

## Where things are

`hood` is one free-text field doing four jobs — neighbourhood, street
address, metro station, and the occasional venue note — so the same place
arrives spelled several ways. Across one weekend's listings, "Mile End"
appears as three different strings, and 32 distinct `hood` values cover
only 12 real neighbourhoods.

The refresh now reads each record's `hood` into an added `loc`:

    hood: "Mile End · métro Laurier"      unchanged, still rendered verbatim
    loc: { area: "Mile End", areaKey: "mile-end",
           metro: "Laurier", metroKey: "laurier",
           lines: ["orange"], line: "orange" }

Strictly additive — `hood` keeps the text it arrived with, because the
board renders that string directly. `POST /api/refresh` reports coverage
in `located`. If the location layer throws, the listings are stored
unstructured rather than not at all.

`lines` holds every line the station serves, in line order, and the board
draws one dot each — most interchanges serve two of the four, and which
two is worth seeing. `line` is additionally set when there is exactly one.
A station the table does not know gets neither and renders as plain text:
a missing dot is invisible, a wrong one is a claim about the city that a
Montrealer will catch. `lib/metro.js` was checked against Wikipedia's station list rather
than written from memory, and a test asserts every station in the shipped
listings resolves.

Only what the refresh writes gets this. The inline fallback blocks and
captured-poster records keep their free-text `hood` and render exactly as
they do today.

## Still to do

- **A neighbourhood filter is still not worth building**, even now that
  `loc.areaKey` would make it work: easy transit and a car make filtering
  by area much less useful than seeing where a thing is.
