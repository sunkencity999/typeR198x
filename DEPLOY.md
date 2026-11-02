# Type-R 198X release procedure (web build)

Run from the repo root on the release branch (for 20261025a: `wt/pace-acq`, or its merge into `training` / `main`;
20261024b was `training`, and the partial release 20261024a was `release/20261024a`).
Every step is a command the owner runs by hand; nothing here is automated end to end on purpose. The FTP password is only ever
passed through the `TYPER_FTP_PASSWORD` environment variable (or `--password-file`); never paste it into a
file, a commit or a shell history you keep.

Background: the live site serves release `20261024b` (the training update) once the owner's deploy of it is done,
else `20261016a` or `20261024a` (the first part of the training update); 20261025a follows any of them. Its `/`
answers `no-cache` (the `.htaccess` policy works there), but the host's NGINX direct delivery still answers
`/index.html` and the other pages with
`Cache-Control: max-age=15552000` and every other static file with `max-age=31536000`, and ignores the query string
when it resolves a file (audit G025; checked 2026-10-24). Steps 1, 4 and 6 exist to make sure returning players
actually receive this release. The stale-shell guard in `game.js` reloads an older shell once into the new one only
when that shell's `game.js` is no longer cached. A browser that cached the whole previous build at `/index.html`
(shell and scripts, the usual state after the footer pages' "Back to the game" links) runs it with zero requests
and never loads the new `game.js`: it stays on that build until the player reloads, opens `/` or the cache expires.
Nor does the guard reach a mixed cache: a browser that still holds the older `/index.html` and the older `game.js`
but has lost one of the other `assets/js/` scripts fetches that script's old `?v=` URL, gets this release's file (the
host ignores the query) and runs old and new code together. Resume can do nothing, plates can stop spawning or a boss
can stop taking damage, with `[TypeR] frame error` in the console, until the player reloads once (the reload
revalidates `/index.html` and the new shell's `?v=` URLs are all new).
On its first visit to `/` the new shell revalidates `/index.html`, `privacy-policy.html`, `support.html` and
`info.html` (after the first keystroke, or 30 s after load), and the in-site links carry `?v=20261025a`, so from then
on it gets this release.

## 0. Preconditions

```bash
git status --short                      # clean tree on the release commit
node --version                          # 18+
(cd tools/deploy && npm install)        # basic-ftp, once
(cd tools/playtest && npm install)      # Playwright, once
```

## 1. Bump the shell token

```bash
tools/bump-version.sh 20261025a         # YYYYMMDDx; omit the argument for today + next letter
tools/bump-version.sh 20261025a --dry-run   # same token again: must report "no changes"
git diff --stat                         # index/info/support/privacy pages + game.js only
```

If `assets/opt` changed in this release, `MANIFEST_ONLY=1 tools/build-web-assets.sh` first (new ART
version), then the bump. Commit the bump.

## 2. Matrix

```bash
(cd tools/playtest && bash run-matrix.sh)                     # tens of minutes; all rows exit 0
(cd tools/playtest && bash run-matrix.sh --quick)             # minutes; acceptable for a hotfix
bash tools/deploy-check.sh --local                            # source checks + native sync dry run, FAIL 0
```

Look at `tools/playtest/out/matrix/summary.tsv`: zero page errors on every row, fps >= 58, every `fixture-*` row
`pass`, and non-media MB before the first keystroke <= 2.5 on the DPR 1 rows and <= 2.75 on the DPR 2 rows (CONTRACT
8.y W2). `fixture-legacy-inboss` continues a run inside a boss, so it loads the boss art before its first keystroke
and is gated at 2.75 too (2.46 at a0a3845; 2.61 with the 20261024a JS/CSS). Two background fetches wait for the first
keystroke (CONTRACT 8.z Z11), so neither counts toward that figure: the stale-shell guard's revalidation of the four
pages (about +0.07 MB in every fixture row with a save) and the next sector's art prefetch, which a run resumed past a
quarter of its sector used to start during the boss intro (+0.44 MB in this row; 2.78 with the training JS/CSS before
the change, 2.34 after).

## 3. Dry run

```bash
node tools/deploy/deploy.mjs --dry-run --user <ftp-user>
```

Prints the local set in upload order (about 230 files for 20261101a: the AAA pass adds `sw.js`, `site.webmanifest`, `assets/ui/icons/`, the dyslexic font, the drone and mid-strip WebPs, the audio banks and music layers, and `api/` (the leaderboard backend, uploaded even while the client is off); 199 for 20261025a as for 20261024b and 20261024a, ~370 MB listed; on a real run the
~341 MB of PNG/WAV masters are skipped when the remote size matches) and exits without connecting, so no password
is needed. Check that `index.html` is last, `assets/opt/manifest.js` just before it, the other pages (`info.html`,
`privacy-policy.html`, `privacy.html`, `support.html`) just before that and after `style.css`, and that
`privacy-policy.html` and every `assets/opt` file are in the list.

## 4. Backup and deploy with the cache policy

```bash
export TYPER_FTP_PASSWORD='...'          # from the password manager; unset it afterwards
node tools/deploy/deploy.mjs --user <ftp-user> --backup light --htaccess
unset TYPER_FTP_PASSWORD
```

The host defaults to the server's own name (`gcam1233.siteground.biz`, the name on SiteGround's FTP certificate;
`ftp.typer198x.com` reaches the same server but fails the TLS name check, so use it only with `--secure false`).
If SiteGround ever moves the account, Site Tools shows the new server name; pass it with `--host` or `TYPER_FTP_HOST`.

What happens, in order: FTPS connect (explicit TLS; the script never falls back to plain FTP, a TLS or
certificate failure aborts with exit 1, and `--secure false` is the only way to log in over cleartext FTP,
which it warns about before connecting), web-root detection, backup of the deploy set (the web root's own files plus `assets/`; other directories that
may sit there, such as an old `native/` copy or a `.venv`, are neither crawled nor backed up) to
`tools/deploy/backups/<timestamp>/` (`light` skips files over 4 MB; use `--backup full` before a risky
release), upload of `assets/` first, then CSS/JS, then the other pages (they link `?v=<new token>` CSS, and a visit
before that CSS is on the host would cache the old `style.css` under the new URL for a year), then
`assets/opt/manifest.js`, then `index.html` last, `.htaccess` cache policy merged
into the existing file (the host's file is downloaded first and kept as
`tools/deploy/backups/htaccess-<ms>.previous.txt`; the uploaded text is `htaccess-<ms>.merged.txt`; the download
is attempted even when the listing shows no `.htaccess`, because some servers hide dotfiles, and a new file is
created only after that download answers "no such file"; if a listed `.htaccess` cannot be downloaded, or an
unlisted one fails for any other reason, the step is skipped, the run exits 1 and you merge
`tools/deploy/htaccess-cache.txt` by hand), then an
HTTPS verification that `index.html` and `game.js` match the local files and a print of their cache
headers. Add `--force` only if a size-equal binary must be re-uploaded.

## 4b. Flush the host's dynamic cache

Right after the upload, flush the dynamic cache in Site Tools (Speed → Caching), then run step 5 straight away. The
dynamic cache stores 404 responses keyed by the full URL (measured 2026-10-24: a GET of a missing `?v=` URL answered
404 MISS, then 404 HIT), so a GET of a new release URL before its file was uploaded can leave a cached 404 behind.
Existing files are served from disk by direct delivery and are not affected, so this is a precaution; step 5
fetches every script the served shell references and fails on a 404. Verifiers: do not GET `?v=20261025a` URLs on
the live host before the deploy (nor `?v=20261024b` or `?v=20261024a` ones while that release has not been deployed).

## 5. Go/no-go

```bash
bash tools/deploy-check.sh https://typer198x.com --strict
```

`FAIL 0` is the gate. The strict run fails on: `index.html` with a wrong status or MIME type, `index.html` or
`/` without `no-cache`/`max-age=0`,
shell tokens that disagree or differ from `<meta name="asset-version">`, any script, stylesheet, WebP or
MP3 with a wrong status or MIME type, the font with a wrong status or a non-font MIME type, a served
`game.js` failing `node --check`, no served script carrying the `window.SFX` guard, `assets/opt/manifest.js`
differing from the local one, a ship-card `?v=` that differs from the served manifest version, a
missing/incorrect privacy target, or a served `privacy-policy.html` whose effective date is not the local one
(an older policy still cached; step 6). Warnings about `immutable`, `Accept-Ranges`, a `/` that does not answer
200, a font served as `application/octet-stream` or a `game.js` whose `window.SFX` guard sits in another
script are worth fixing but do not block.

## 6. Host cache for `*.html` (required while it serves a long `max-age`)

When step 5 still reports a long `max-age` on `/index.html` after `--htaccess`, the host's own static
cache (nginx in front of Apache; headers `x-proxy-cache-info`, `host-header`) is answering, not Apache. Every browser
that opens a page under that header keeps it for 180 days, and no client code reaches a browser that never sends a
request, so this step is what stops new long-lived copies of this release's pages from forming:

1. In the hosting panel, exclude `*.html` (at least `/`, `/index.html`, `/privacy-policy.html`, `/support.html`,
   `/info.html`, `/privacy.html`) and `/assets/opt/manifest.js` from the static/dynamic cache, or disable that
   cache for the site.
2. Purge the cache there.
3. Re-run step 5. Repeat until `index.html` comes back `no-cache` and the `?v=` tokens on the served
   shell are the new ones.

Spot checks by hand:

```bash
curl -sI https://typer198x.com/index.html | grep -i cache-control
curl -sI https://typer198x.com/privacy-policy.html | grep -i cache-control
curl -s  https://typer198x.com/ | grep -o 'v=[0-9a-z]*' | sort | uniq -c
curl -s  https://typer198x.com/privacy-policy.html | grep 'Effective date'    # 1 November 2026
```

## 7. After the deploy

- Open `https://typer198x.com/` (the bare root, served no-cache; not `/index.html`) in a browser that played
  before. The title shows the DAILY SORTIE tile and the PRACTICE panel (DRILL · 60 S, ENDLESS DRIFT) under the
  Start / New run button. In the console, `document.querySelector('meta[name=asset-version]').content` and
  `ASSET_VERSION` both read `20261025a`. `localStorage['typesmup198x.save.v1']` keeps the old progress (Resume /
  Continue offered when a run was saved). The loading bar and title cabinet look the same as in 20261016a and
  20261024a, and the whole title screen as in 20261024b, so only the token identifies this build. `/index.html` in
  that same browser may still show the previous build (no deck on 20261016a, the deck hidden on 20261024a, no visible
  difference on 20261024b) until one reload or the next visit to `/`: that is the cached-whole-build case in
  Background, expected.
- Tag the release commit and record the token in the README changelog heading if it was left generic.

## Rollback

Each deploy leaves `tools/deploy/backups/<timestamp>/` mirroring the deploy set of the remote tree as it was: the
web root's own files and `assets/`, nothing from other directories (light backups
omit files over 4 MB, which are the masters already in git and unchanged on the host).

1. Copy the backup into a scratch root: `rsync -a tools/deploy/backups/<timestamp>/ /tmp/typer-rollback/`
   and restore any large files it skipped from the previous git tag (`git show <tag>:path > ...`).
2. Deploy the previous release with the same tool. `deploy.mjs` always deploys the repo it lives in, so
   check the previous tag out as a worktree and run it from there:
   ```bash
   git worktree add /tmp/typer-prev <previous-tag>
   (cd /tmp/typer-prev/tools/deploy && npm install)
   (cd /tmp/typer-prev && TYPER_FTP_PASSWORD='...' node tools/deploy/deploy.mjs --user <ftp-user> --backup light --force)
   git worktree remove /tmp/typer-prev
   ```
   (`--force` re-uploads size-equal files, which a rollback usually needs.) Alternatively upload the
   backup folder from step 1 with any FTP client.
3. The previous `.htaccess` is in `tools/deploy/backups/htaccess-<ms>.previous.txt` (the file as downloaded
   before the merge; `htaccess-<ms>.merged.txt` is what was uploaded, and `backups/<timestamp>/.htaccess` holds
   the same original when the server lists dotfiles); restore it only if the cache policy itself caused the
   problem (it should stay, it is what lets a fix reach players).
4. Purge the host cache (step 6) so the restored shell is what players receive, then run step 5 without
   `--strict` to confirm the site is back.
