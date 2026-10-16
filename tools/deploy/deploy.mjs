#!/usr/bin/env node
// Deploys the Type-R 198X web build to a static host over FTP/FTPS.
//
//   TYPER_FTP_PASSWORD=... node tools/deploy/deploy.mjs \
//       --host ftp.typer198x.com --user <ftp-user> [--port 21] \
//       [--remote-dir auto|/public_html (an absolute path)] [--secure true|false] \
//       [--backup light|full|none] [--dry-run] [--force] [--site https://typer198x.com] [--htaccess]
//
// What it does, in order:
//   1. connects with explicit FTPS (TLS). It never falls back to plain FTP: a TLS failure aborts with exit 1,
//      and only an explicit --secure false logs in over cleartext FTP (warned about before connecting),
//   2. finds the remote web root (looks for index.html in /, /public_html, /httpdocs, /www, /htdocs),
//   3. backs up the remote tree to tools/deploy/backups/<timestamp>/ (light = skip files > 4 MB,
//      which are the art/audio masters already in git),
//   4. uploads assets first, then css/js, then assets/opt/manifest.js, then index.html last; unchanged binaries
//      (same size) are skipped,
//   5. verifies over HTTPS that index.html and game.js now match the local files and prints cache headers.
// The password is read from TYPER_FTP_PASSWORD (or --password-file) and never written anywhere.
import { Client } from "basic-ftp";
import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? (argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : "true") : d; };
const HOST = opt("host", process.env.TYPER_FTP_HOST || "ftp.typer198x.com");
const USER = opt("user", process.env.TYPER_FTP_USER || "");
const PORT = Number(opt("port", process.env.TYPER_FTP_PORT || 21));
const SECURE = opt("secure", "true"); // review R4/R23: TLS unless the operator opts out explicitly
const REMOTE_DIR = opt("remote-dir", "auto");
const BACKUP = opt("backup", "light");
const DRY = opt("dry-run", "false") === "true";
const FORCE = opt("force", "false") === "true";
const SITE = opt("site", "https://typer198x.com");
const PASSWORD_FILE = opt("password-file", "");
// --htaccess: install tools/deploy/htaccess-cache.txt as .htaccess in the web root (merged into an existing one).
const HTACCESS = opt("htaccess", "false") === "true";
const PASSWORD = PASSWORD_FILE ? fs.readFileSync(PASSWORD_FILE, "utf8").trim() : (process.env.TYPER_FTP_PASSWORD || "");

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
if (!USER) { console.error("missing --user"); process.exit(2); }
if (SECURE !== "true" && SECURE !== "false") { console.error(`--secure must be true or false (got ${SECURE}); plain FTP is never chosen automatically`); process.exit(2); }
if (!PASSWORD && !DRY) { console.error("missing TYPER_FTP_PASSWORD (or --password-file)"); process.exit(2); }

// ------------------------------------------------------------------ local file set
const TOP_FILES = ["index.html", "game.js", "style.css", "privacy-policy.html", "privacy.html", "info.html", "support.html", "robots.txt", "sitemap.xml", "site.webmanifest"];
const ASSET_DIRS = ["assets"];
const SKIP_RE = /(^|\/)(\.DS_Store|Thumbs\.db|\.git)$/;
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (SKIP_RE.test(p)) continue;
    if (e.isDirectory()) walk(p, out); else if (e.isFile()) out.push(p);
  }
  return out;
}
const local = [];
for (const f of TOP_FILES) if (fs.existsSync(path.join(ROOT, f))) local.push(path.join(ROOT, f));
for (const d of ASSET_DIRS) if (fs.existsSync(path.join(ROOT, d))) walk(path.join(ROOT, d), local);
const rel = (p) => path.relative(ROOT, p).split(path.sep).join("/");
const isText = (p) => /\.(html|js|mjs|css|json|svg|txt|xml|webmanifest|md)$/i.test(p);
// upload order: assets (new files first), then css/js, then assets/opt/manifest.js, then index.html last.
// manifest.js is served no-cache and read by the old shell, so it must not name files that are still uploading (review R42).
const order = (p) => p.endsWith("index.html") ? 4 : p.endsWith("/assets/opt/manifest.js") ? 3 : /\.(css|js)$/.test(p) && !p.includes("/assets/opt/") ? 2 : 1;
local.sort((a, b) => order(a) - order(b) || a.localeCompare(b));
const totalBytes = local.reduce((n, p) => n + fs.statSync(p).size, 0);
console.log(`local set: ${local.length} files, ${(totalBytes / 1048576).toFixed(1)} MB (root ${ROOT})`);

// ------------------------------------------------------------------ ftp helpers
const client = new Client(120000);
client.ftp.verbose = false;
async function connect() {
  // review R4/R23: no automatic downgrade. TLS failures (bad certificate, AUTH TLS refused, reset handshake) abort.
  const secure = SECURE !== "false";
  if (!secure) console.warn(`WARNING: --secure false: logging in to ${HOST}:${PORT} over PLAIN FTP, the password crosses the network in cleartext`);
  try {
    // SNI only for a hostname: Node refuses an IP literal as servername, which used to abort an FTPS run to an IP host.
    await client.access({ host: HOST, user: USER, password: PASSWORD, port: PORT, secure, secureOptions: net.isIP(HOST) ? {} : { servername: HOST } });
  } catch (e) {
    client.close();
    if (secure) {
      console.error(`FTPS connect to ${HOST}:${PORT} failed: ${e.message}`);
      console.error("not retrying over plain FTP; re-run with --secure false only if you accept sending the password in cleartext");
      process.exit(1);
    }
    throw e;
  }
  console.log(`connected to ${HOST}:${PORT} ${secure ? "with explicit FTPS (TLS)" : "over PLAIN FTP (cleartext credentials!)"}`);
}
async function findRemoteRoot() {
  // review R41: normalise once so every later path is absolute (a relative --remote-dir would otherwise make
  // ensureDir nest a copy of it inside the web root and the following cd(root) fail)
  if (REMOTE_DIR !== "auto") { await client.cd(REMOTE_DIR); return await client.pwd(); }
  for (const c of ["/", "/public_html", "/httpdocs", "/www", "/htdocs", "/web", "/typer198x.com"]) {
    try {
      const list = await client.list(c);
      if (list.some((f) => f.name === "index.html")) { await client.cd(c); return c; }
    } catch { /* not there */ }
  }
  throw new Error("could not find a remote directory containing index.html; pass --remote-dir");
}
const listCache = new Map();
async function remoteList(dir) {
  if (!listCache.has(dir)) {
    try { listCache.set(dir, await client.list(dir)); } catch { listCache.set(dir, []); }
  }
  return listCache.get(dir);
}
async function remoteWalk(dir, out = []) {
  for (const f of await remoteList(dir)) {
    const p = dir === "/" ? `/${f.name}` : `${dir}/${f.name}`;
    if (f.isDirectory) await remoteWalk(p, out); else if (f.isFile) out.push({ path: p, size: f.size });
  }
  return out;
}

// ------------------------------------------------------------------ main
(async () => {
  if (DRY) {
    console.log("dry run: would upload, in order:");
    for (const p of local) console.log(`  ${rel(p)}  (${fs.statSync(p).size} B)`);
    process.exit(0);
  }
  await connect();
  const root = await findRemoteRoot();
  console.log(`remote web root: ${root}`);
  const remoteFiles = await remoteWalk(root);
  console.log(`remote has ${remoteFiles.length} files`);

  // backup
  if (BACKUP !== "none") {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const bdir = path.join(HERE, "backups", stamp);
    let n = 0, skipped = 0;
    for (const f of remoteFiles) {
      if (BACKUP === "light" && f.size > 4 * 1048576) { skipped++; continue; }
      const relPath = f.path.slice(root === "/" ? 1 : root.length + 1);
      const dest = path.join(bdir, relPath);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      await client.downloadTo(dest, f.path);
      n++;
    }
    console.log(`backup: ${n} files saved to ${bdir}${skipped ? ` (${skipped} files > 4 MB skipped)` : ""}`);
  }

  // upload
  const remoteSize = new Map(remoteFiles.map((f) => [f.path.slice(root === "/" ? 1 : root.length + 1), f.size]));
  let up = 0, skip = 0, bytes = 0;
  for (const p of local) {
    const r = rel(p);
    const size = fs.statSync(p).size;
    const same = remoteSize.has(r) && remoteSize.get(r) === size;
    if (!FORCE && same && !isText(p)) { skip++; continue; }
    const remotePath = root === "/" ? `/${r}` : `${root}/${r}`;
    await client.ensureDir(path.posix.dirname(remotePath));
    await client.cd(root);
    await client.uploadFrom(p, remotePath);
    up++; bytes += size;
    process.stdout.write(`\r  uploaded ${up} (${(bytes / 1048576).toFixed(1)} MB)  skipped ${skip}   `);
  }
  console.log(`\nupload done: ${up} uploaded, ${skip} unchanged binaries skipped`);

  // optional Apache cache policy (.htaccess): append our block to an existing file, never replace it.
  // The download is always attempted, because servers may hide dotfiles from LIST/MLSD: a new file is created only
  // when the listing has no .htaccess AND the RETR itself answers "no such file". A listed file that cannot be
  // downloaded, or any other download error, leaves the host's file alone (review R24).
  // The download is kept as htaccess-<ms>.previous.txt and the uploaded text written to a separate
  // htaccess-<ms>.merged.txt, so the previous copy really is the previous copy (review R16/R25).
  let htaccessSkipped = false;
  if (HTACCESS) {
    const snippet = fs.readFileSync(path.join(HERE, "htaccess-cache.txt"), "utf8");
    const marker = "Type-R 198X cache policy";
    const remotePath = root === "/" ? "/.htaccess" : `${root}/.htaccess`;
    const ms = Date.now();
    const prev = path.join(HERE, "backups", `htaccess-${ms}.previous.txt`);
    const mergedPath = path.join(HERE, "backups", `htaccess-${ms}.merged.txt`);
    fs.mkdirSync(path.dirname(prev), { recursive: true });
    const listed = remoteSize.has(".htaccess");
    const byHand = "left untouched. Merge tools/deploy/htaccess-cache.txt into it by hand.";
    let existing = "", found = false;
    try { await client.downloadTo(prev, remotePath); existing = fs.readFileSync(prev, "utf8"); found = true; }
    catch (e) {
      try { fs.rmSync(prev, { force: true }); } catch { /* nothing to remove */ }
      // 550 alone is ambiguous (Pure-FTPd/ProFTPD use it for "permission denied" too), so absence needs the text as well
      const absent = !listed && e.code === 550 && /no such file|not found|does not exist|cannot find/i.test(e.message);
      if (!absent) {
        console.error(listed
          ? `.htaccess: the host lists one but it could not be downloaded (${e.message}); ${byHand}`
          : `.htaccess: not in the listing, but the download attempt failed with "${e.message}" instead of "no such file", so one may exist; ${byHand}`);
        htaccessSkipped = true;
      }
    }
    if (htaccessSkipped) {
      // nothing uploaded
    } else if (existing.includes(marker)) {
      console.log(`.htaccess: cache policy already present, left unchanged (copy at ${prev})`);
    } else {
      const merged = existing ? `${existing.replace(/\s*$/, "")}\n\n${snippet}` : snippet;
      fs.writeFileSync(mergedPath, merged);
      await client.uploadFrom(mergedPath, remotePath);
      const hidden = listed ? "" : " that the listing hid";
      const how = existing ? `appended the cache policy to the existing file${hidden} (previous copy kept at ${prev})`
        : found ? `the existing file${hidden} was empty, wrote the cache policy (previous empty copy kept at ${prev})`
        : "created (the host neither listed nor served an .htaccess, so there is no previous copy)";
      console.log(`.htaccess: ${how}; uploaded text at ${mergedPath}`);
    }
  }
  client.close();

  // verify
  const sha = (buf) => crypto.createHash("sha256").update(buf).digest("hex").slice(0, 12);
  for (const f of ["index.html", "game.js", "style.css"]) {
    try {
      const res = await fetch(`${SITE}/${f}?deploycheck=${Date.now()}`, { cache: "no-store" });
      const body = Buffer.from(await res.arrayBuffer());
      const ok = sha(body) === sha(fs.readFileSync(path.join(ROOT, f)));
      console.log(`${ok ? "OK  " : "DIFF"} ${f}  status ${res.status}  cache-control: ${res.headers.get("cache-control") || "(none)"}  content-type: ${res.headers.get("content-type")}`);
    } catch (e) { console.log(`verify ${f} failed: ${e.message}`); }
  }
  console.log("reminder: index.html must come back with Cache-Control: no-cache (audit G025) so a new ?v= token reaches returning players; see tools/nginx-cache.conf or tools/deploy/htaccess-cache.txt (--htaccess), then run tools/deploy-check.sh " + SITE + " --strict.");
  if (htaccessSkipped) { console.error("deploy finished, but the .htaccess step was skipped (see above): exit 1"); process.exitCode = 1; }
})().catch((e) => { console.error("deploy failed:", e.message); client.close(); process.exit(1); });
