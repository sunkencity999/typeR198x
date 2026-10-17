# Type-R 198X release procedure (web build)

Run from the repo root on the `web-overhaul` branch (or its merge into `main`). Every step is a command
the owner runs by hand; nothing here is automated end to end on purpose. The FTP password is only ever
passed through the `TYPER_FTP_PASSWORD` environment variable (or `--password-file`); never paste it into a
file, a commit or a shell history you keep.

Background: the live site serves the pre-overhaul build under the same shell token the repo still carries
(`20251130a`) and answers `/index.html` with `Cache-Control: max-age=15552000` (audit G025). Steps 1, 4
and 6 exist to make sure returning players actually receive this release.

## 0. Preconditions

```bash
git status --short                      # clean tree on the release commit
node --version                          # 18+
(cd tools/deploy && npm install)        # basic-ftp, once
(cd tools/playtest && npm install)      # Playwright, once
```

## 1. Bump the shell token

```bash
tools/bump-version.sh 20261016a         # YYYYMMDDx; omit the argument for today + next letter
tools/bump-version.sh 20261016a --dry-run   # same token again: must report "no changes"
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

Look at `tools/playtest/out/matrix/summary.tsv`: zero page errors on every row, fps >= 58, non-media MB
before the first keystroke <= 2.5, every `fixture-*` row `pass`.

## 3. Dry run

```bash
node tools/deploy/deploy.mjs --dry-run --user <ftp-user>
```

Prints the local set in upload order (about 190 files, ~370 MB listed; on a real run the ~341 MB of
PNG/WAV masters are skipped when the remote size matches) and exits without connecting, so no password
is needed. Check that `index.html` is last, `assets/opt/manifest.js` just before it, and that `privacy-policy.html`
and every `assets/opt` file are in the list.

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
release), upload of `assets/` first, then CSS/JS, then `assets/opt/manifest.js`, then `index.html` last, `.htaccess` cache policy merged
into the existing file (the host's file is downloaded first and kept as
`tools/deploy/backups/htaccess-<ms>.previous.txt`; the uploaded text is `htaccess-<ms>.merged.txt`; the download
is attempted even when the listing shows no `.htaccess`, because some servers hide dotfiles, and a new file is
created only after that download answers "no such file"; if a listed `.htaccess` cannot be downloaded, or an
unlisted one fails for any other reason, the step is skipped, the run exits 1 and you merge
`tools/deploy/htaccess-cache.txt` by hand), then an
HTTPS verification that `index.html` and `game.js` match the local files and a print of their cache
headers. Add `--force` only if a size-equal binary must be re-uploaded.

## 5. Go/no-go

```bash
bash tools/deploy-check.sh https://typer198x.com --strict
```

`FAIL 0` is the gate. The strict run fails on: `index.html` with a wrong status or MIME type, `index.html` or
`/` without `no-cache`/`max-age=0`,
shell tokens that disagree or differ from `<meta name="asset-version">`, any script, stylesheet, WebP or
MP3 with a wrong status or MIME type, the font with a wrong status or a non-font MIME type, a served
`game.js` failing `node --check`, no served script carrying the `window.SFX` guard, `assets/opt/manifest.js`
differing from the local one, a ship-card `?v=` that differs from the served manifest version, or a
missing/incorrect privacy target. Warnings about `immutable`, `Accept-Ranges`, a `/` that does not answer
200, a font served as `application/octet-stream` or a `game.js` whose `window.SFX` guard sits in another
script are worth fixing but do not block.

## 6. If the host cache still serves the old shell

When step 5 still reports a long `max-age` on `/index.html` after `--htaccess`, the host's own static
cache (nginx in front of Apache; headers `x-proxy-cache-info`, `host-header`) is answering, not Apache:

1. In the hosting panel, exclude `*.html` (at least `/`, `/index.html`, `/assets/opt/manifest.js`) from
   the static/dynamic cache, or disable that cache for the site.
2. Purge the cache there.
3. Re-run step 5. Repeat until `index.html` comes back `no-cache` and the `?v=` tokens on the served
   shell are the new ones.

Spot checks by hand:

```bash
curl -sI https://typer198x.com/index.html | grep -i cache-control
curl -s  https://typer198x.com/ | grep -o 'v=[0-9a-z]*' | sort | uniq -c
```

## 7. After the deploy

- Open the site in a browser that played the old build: the loading screen should show the new bar and
  the title cabinet; `localStorage['typesmup198x.save.v1']` keeps the old progress (Continue offered).
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
