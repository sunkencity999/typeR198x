# Daily sortie leaderboard

The optional public board of today's daily sortie results: one entry per pilot per day, best rating kept, top 10 shown
under the sortie card and a one-line teaser on the Daily sortie tile. **It ships off.** `LEADERBOARD.endpoint` in
`assets/js/game/54-leaderboard.js` is `""`, and with an empty endpoint the client shows no UI, makes no request and the
game is byte-for-byte the game it was (the `t-leaderboard` probe asserts zero non-origin requests in that state).

Two interchangeable backends implement the same contract:

| Backend | File | Where it runs | Storage |
| --- | --- | --- | --- |
| A | `api/leaderboard.php` + `api/.htaccess` | the SiteGround host, same origin as the game (`./api/leaderboard.php`) | PDO SQLite, above the web root |
| B | `tools/leaderboard/worker.js` + `wrangler.toml.example` | a Cloudflare Worker (`https://<name>.<account>.workers.dev`) | KV namespace `BOARD` |

## Enabling the board (owner)

1. **Backend.**
   - *A, SiteGround:* create the private directory **above the web root**, next to `public_html`:
     `mkdir -m 700 ~/www/typer198x.com/typer198x-private` (Site Tools > File Manager, or SSH). The script resolves it as
     `api/../../typer198x-private/leaderboard.sqlite`; the database and its `.salt` file are created on the first
     request. If the directory is missing or not writable the script falls back to `api/.ht_leaderboard.sqlite`, which
     `api/.htaccess` denies to the web (`.ht*`, `*.sqlite*`, `*.salt`); a different location can be forced with the
     environment variable `TYPER_LEADERBOARD_DB=/abs/path/leaderboard.sqlite` (e.g. `SetEnv` in the web root's
     `.htaccess` under mod_php) or by editing `LB_DB_DEFAULT` at the top of the script.
     `tools/deploy/deploy.mjs` uploads `api/` with the assets (`ASSET_DIRS`), never a `.sqlite` / `.salt` file, and
     never downloads the live database into a backup.
   - *B, Cloudflare:* `cp tools/leaderboard/wrangler.toml.example tools/leaderboard/wrangler.toml`, then from
     `tools/leaderboard/`: `npx wrangler kv namespace create BOARD` (paste the id), `npx wrangler secret put IP_SALT`
     (any long random string), set `ALLOWED_ORIGINS` to the page origins, `npx wrangler deploy`. `wrangler.toml` is
     git-ignored (it holds the namespace id).
2. **Client.** In `assets/js/game/54-leaderboard.js` set `endpoint: "./api/leaderboard.php"` (A) or
   `endpoint: "https://typer198x-leaderboard.<account>.workers.dev"` (B). Nothing else changes: the settings row
   "Share daily sortie scores", the tile teaser and the results board appear on their own once the endpoint is set.
3. **Release** as usual (`tools/bump-version.sh`, matrix, `deploy.mjs`, `tools/deploy-check.sh https://typer198x.com --strict`).
   With a same-origin endpoint set, `deploy-check.sh` also fetches `api/leaderboard.php?day=<today>` (200, JSON,
   `Cache-Control: no-store`, no `Access-Control-Allow-Origin`) and asserts `api/.ht_leaderboard.sqlite` is not served.
4. **Privacy.** `privacy-policy.html` already carries the "Daily sortie leaderboard (optional)" section (effective
   1 November 2026); nothing to add when switching on.

To switch the board off again, set the endpoint back to `""` and deploy; existing rows expire after 90 days (A) or at
their KV expiration (B).

## Client behaviour (`54-leaderboard.js`)

- `LEADERBOARD = { endpoint, timeoutMs 6000, top 10, nameMax 12, teaserMinMs 300000, retries 1 }`.
- Consent: `settings.shareDailyScores` (default `false`; `normaliseSettings` reads anything but a stored `true` as off).
  The toggle row `#setShareScoresRow` in `#settingsPanel` is hidden while the endpoint is empty.
- Identity: `save.playerToken`, a UUID from `crypto.randomUUID()` (v4 fallback from `getRandomValues`), minted when the
  player opts in or when a counted daily sortie starts with consent on (so `modesBank`'s single save write persists it);
  `migrateSave` keeps it only when UUID-shaped; Reset save erases it, so the next opt-in mints a new one.
- Name: the pilot name sanitised (trim, collapse whitespace, strip control / zero-width / bidi characters, <= 12 code
  points, fallback `PILOT`); the server repeats the same sanitising.
- Submit: on `modesRunEnd` for `mode === "daily"` when `result.counted`, `result.rating` is a number and consent is on:
  one POST (fetch + AbortController, 6 s), one retry on a network failure or timeout, never on an HTTP 4xx/5xx. Then a
  GET of today's board. The result screen shows the board state as it arrives (`#modesBoard`, `aria-live="polite"`).
- Read: `GET ?day=YYYY-MM-DD&token=<uuid>` on every daily result (forced) and for the tile teaser on `menuRender`, at
  most once per 5 minutes per day key (errors are cached for the same 5 minutes).
- States: loading ("Loading today's board…"), empty ("Be the first pilot today"), unavailable (muted "Board
  unavailable"), rows (rank, name, rating, WPM, accuracy; the player's row `is-you` + `aria-current`), "You: #n of
  total", and a muted note for off / practice / unrated / failed / limited / rejected. Never a toast.
- Frame budget: nothing runs in `update` / `render`; the hook listeners set state and start promises.
- Harness: `window.TypeRHarness.leaderboardEndpoint = "https://board.test/api"` overrides the endpoint;
  `tools/playtest/probes/t-leaderboard.mjs` mocks it with `page.route`. `window.game.lbDebug()` exposes
  `state()`, `reset()`, `refresh()`.

## API contract

Both backends. Always `Content-Type: application/json; charset=utf-8`, `Cache-Control: no-store`,
`X-Content-Type-Options: nosniff`. Days are `YYYY-MM-DD`; the client sends its **local** date (the sortie's day key),
and a backend accepts a day within one day of its UTC date (`day_past` / `day_future` = 1), which covers every time zone.

### `GET <endpoint>?day=YYYY-MM-DD[&token=<uuid>][&top=N]`

- `day` defaults to UTC today; invalid -> `400 {error:"invalid", field:"day"}`.
- `top` 1..50, default 10. `token` optional; an invalid token is ignored.
- `200`:

```json
{
  "day": "2026-10-24",
  "total": 12,
  "top": [{ "name": "ACE", "rating": 61, "speed": 70, "acc": 93.33, "sector": 5, "ship": "honeybee" }],
  "you": { "rank": 3, "rating": 52 }
}
```

`you` is `null` without a token or when that token has no entry for the day. Order: rating desc, earliest best first.

### `POST <endpoint>` (`Content-Type: application/json`, body <= 2048 bytes)

```json
{
  "day": "2026-10-24", "token": "0b5f1c2e-7d1a-4c3e-9a1b-2f3e4d5c6b7a", "name": "ACE",
  "rating": 52, "speed": 60, "acc": 93.33, "score": 48210, "sector": 5, "ship": "coconut",
  "rank": "A", "version": "20261031a"
}
```

| Field | Rule |
| --- | --- |
| `day` | `YYYY-MM-DD`, real date, within `[UTC today - 1, UTC today + 1]` |
| `token` | UUID (8-4-4-4-12 hex); lower-cased |
| `name` | sanitised server-side: trim, collapse whitespace, strip control / zero-width / bidi, <= 12 code points, `PILOT` when empty |
| `rating` | integer 0..3000 and `abs(rating - round(speed * (acc/100)^2)) <= 2` |
| `speed` | integer 0..300 |
| `acc` | number 0..100, rounded to 2 decimals |
| `score` | integer 0..5,000,000 |
| `sector` | integer 1..10 |
| `ship` | one of `coconut`, `little-dark-one`, `sofrito`, `honeybee` |
| `rank` | `S` / `A` / `B` / `C` / `D` or `null` |
| `version` | string, `[A-Za-z0-9._-]`, <= 24 chars (informational) |

- `200 { "day", "rank", "total", "rating", "improved" }`: `rating` is the pilot's best for the day after this write,
  `improved` whether this submission replaced the stored row (one row per `(day, token)`, best rating kept; a lower
  rating is acknowledged, not stored).
- Errors (`{ "error", "message"[, "field"] }`): `400 bad_json` / `400 invalid` (+ `field`), `403 cross_origin` (A: a
  browser `Sec-Fetch-Site: cross-site` POST; B: an `Origin` outside `ALLOWED_ORIGINS`), `405 method_not_allowed` (with
  `Allow`), `413 payload_too_large`, `415 unsupported_media_type`, `429 rate_limited` (+ `Retry-After`), `500
  server_error`. No stack trace ever reaches the client.

### `OPTIONS`

`204`, `Allow: GET, POST, OPTIONS`. A (same origin) sends no CORS header at all. B answers the preflight with
`Access-Control-Allow-Origin: <the request's Origin>` only when it is listed in `ALLOWED_ORIGINS` (never `*`).

### Limits, retention, privacy

- **Rate limit:** 30 POSTs per hashed client IP per UTC day, counted once a request passes the transport checks
  (JSON, size, origin), valid body or not. The key is `sha256(salt | ip)` truncated to 32 hex; the salt is a random
  256-bit value generated once and kept next to the database (`<db>.salt`, mode 0600; B: the `IP_SALT` secret). The
  counters are deleted on the next write after the UTC day ends (A) or expire after 24 h (B), so an IP hash lives at
  most ~24 h. Raw addresses are never stored or logged by the scripts.
- **Retention:** entries older than 90 days are deleted on every write (A: `DELETE ... WHERE day < today - 90`; B: the
  per-day KV blob expires 91 days after its day).
- **Anti-cheat is honour-system grade**, like every indie web board: bounds, allowed enumerations and the
  rating / speed / accuracy consistency check reject nonsense, not a determined player with the open-source client and
  `curl`. The rules sit in one table at the top of each backend (`LB_RULES` / `RULES`) for tuning; keep the two equal.
- **CORS:** A sends no `Access-Control-Allow-Origin`, so only the same origin can read it from a page; B echoes only
  the listed origins.
- The policy text lives in `privacy-policy.html` ("Daily sortie leaderboard (optional)") and README "Privacy".

## Testing

```bash
brew install php                                    # once; pdo_sqlite is built in
tools/leaderboard/test-php.sh                       # php -S 127.0.0.1:8089 + curl: 34 checks, exit 0
cd tools/playtest && node probes/t-leaderboard.mjs --root ../..   # Playwright: off / consent off / consent on / 500 / reset
```

`test-php.sh` sets `TYPER_LEADERBOARD_DB` to a temp directory, so it never touches `api/` or the private directory;
`--keep` leaves the temp database for inspection. The Worker has no local test here; `npx wrangler dev` serves it on
`http://127.0.0.1:8787` and the same curl calls from `test-php.sh` apply (add `-H 'Origin: https://typer198x.com'`).
