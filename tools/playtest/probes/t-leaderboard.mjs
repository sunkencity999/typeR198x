// t-leaderboard (LEADERBOARD, 54-leaderboard.js): the optional public daily board. (i) endpoint empty -> no UI, no
// request to anything but the page's own origin even with consent on; (ii) endpoint set (window.TypeRHarness
// .leaderboardEndpoint) + consent off -> the GET teaser and the results board are allowed, zero POSTs, the opt-in row
// shows; (iii) consent on + a completed counted sortie -> exactly one POST with the contract's schema, results board rows,
// your row highlighted, "You: #n of total"; the POST retries once on a network failure; practice sorties never post;
// (iv) endpoint 500 -> unavailable states, no page errors; Reset save rotates the token. The endpoint is mocked with
// page.route on https://board.test. PASS = the feature works. Usage: node tools/playtest/probes/t-leaderboard.mjs
import { openProbe, sleep, F5, localMs, setNow, startMode, waitMode, waitFor, typeWords, checkErrors, LS_KEY } from "./modes_lib.mjs";
const WORDS6 = ["signal", "vector", "plasma", "shogun", "matrix", "cipher"];
const EP = "https://board.test/api";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const P = await openProbe("t-leaderboard");
const origin = P.base.replace(/\/index\.html$/, "");
const reqs = [];
P.page.on("request", (r) => reqs.push({ url: r.url(), method: r.method(), t: Date.now() }));
const foreign = () => reqs.filter((r) => !r.url.startsWith(origin) && !/^(data|blob|about):/.test(r.url));
const apiReqs = () => reqs.filter((r) => /\/api\b|board\.test/.test(r.url));

const ui = () => P.g(() => {
  const g = window.game;
  const cls = (id) => { const el = document.getElementById(id); return el ? el.className : null; };
  const txt = (id) => { const el = document.getElementById(id); return el ? el.textContent : null; };
  const board = document.getElementById("modesBoard");
  return {
    enabled: g.lbEnabled(), endpoint: g.lbEndpoint(), consent: g.lbConsent(), token: g.save.playerToken,
    rowCls: cls("setShareScoresRow"), teaserCls: cls("dailyBoard"), teaser: txt("dailyBoard"), boardCls: cls("modesBoard"), boardChildren: board ? board.children.length : -1,
    boardLive: board ? board.getAttribute("aria-live") : null, boardState: board ? board.dataset.state : null,
    title: txt("modesBoardTitle"), status: (board && board.querySelector(".modesBoard__status") || {}).textContent || null,
    you: (board && board.querySelector(".modesBoard__you") || {}).textContent || null, note: (board && board.querySelector(".modesBoard__note") || {}).textContent || null,
    rows: board ? [...board.querySelectorAll(".lbRow")].map((tr) => ({ you: tr.classList.contains("is-you"), cur: tr.getAttribute("aria-current"), cells: [...tr.children].map((td) => td.textContent) })) : [],
    debug: g.lbDebug().state()
  };
});

// ------------------------------------------------------------------ (i) endpoint empty (the shipped default), consent ON
await P.goto(F5({ settings: { muted: true, crt: true, shareDailyScores: true } }));
await sleep(300);
const day23 = await localMs(P, 2026, 10, 23);
await setNow(P, day23);
const i0 = await ui();
await startMode(P, "daily");
await typeWords(P, WORDS6, 150);
await P.g(() => window.game.modesDebug().finish("clear"));
await waitMode(P, "modeResults", 5000);
await sleep(600);
const i1 = await ui();
const n0 = reqs.length;
await sleep(800);
P.check("(i) endpoint empty: lbEnabled false, the opt-in row / teaser / board all hidden and empty (even with consent on), the results board has no children",
  !i0.enabled && i0.endpoint === "" && /hidden/.test(i0.rowCls) && /hidden/.test(i0.teaserCls) && /hidden/.test(i1.boardCls) && i1.boardChildren === 0 && i1.debug.run === null, { i0, i1: { boardCls: i1.boardCls, boardChildren: i1.boardChildren, run: i1.debug.run } });
P.check("(i) zero requests to any non-origin URL and zero /api requests over load + a counted daily sortie", foreign().length === 0 && apiReqs().length === 0 && reqs.length === n0,
  { total: reqs.length, foreign: foreign().slice(0, 3), api: apiReqs().slice(0, 3) });
const tok0 = await P.g((k) => JSON.parse(localStorage.getItem(k)).playerToken, LS_KEY);
P.check("(i) no token is minted while the board is off (save.playerToken stays \"\")", tok0 === "" && i1.token === "", { stored: tok0, mem: i1.token });

// ------------------------------------------------------------------ mock endpoint (CORS-complete, counts GET / POST / OPTIONS)
const mock = { posts: [], gets: [], options: 0, mode: "ok", total: 12, postRank: 3, failNextPost: 0, lastPost: null,
  top: [["ACE", 61, 70, 93.33, 5, "honeybee"], ["NOVA", 58, 62, 96.7, 4, "sofrito"], ["KITE", 55, 60, 95.5, 5, "coconut"], ["ORBIT", 50, 55, 95.3, 3, "little-dark-one"], ["DUSK", 47, 51, 96, 5, "coconut"],
    ["LUMEN", 44, 50, 93.8, 5, "coconut"], ["QUILL", 41, 46, 94.4, 4, "sofrito"], ["RIFT", 38, 44, 93, 5, "honeybee"], ["SABLE", 35, 40, 93.5, 5, "coconut"], ["TIDE", 30, 36, 91.3, 5, "coconut"], ["ZEST", 22, 30, 85.6, 5, "coconut"]]
    .map(([name, rating, speed, acc, sector, ship]) => ({ name, rating, speed, acc, sector, ship })) };
const corsHeaders = (req) => ({ "Access-Control-Allow-Origin": req.headers()["origin"] || "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Accept", "Cache-Control": "no-store", "Content-Type": "application/json; charset=utf-8" });
await P.page.route("https://board.test/**", async (route) => {
  const req = route.request();
  const m = req.method();
  const h = corsHeaders(req);
  if (m === "OPTIONS") { mock.options++; return route.fulfill({ status: 204, headers: h }); }
  if (m === "POST") {
    const rec = { url: req.url(), headers: req.headers(), raw: req.postData(), body: null };
    try { rec.body = JSON.parse(req.postData()); } catch (_) { rec.body = null; }
    mock.posts.push(rec);
    if (mock.mode === "500") return route.fulfill({ status: 500, headers: h, body: JSON.stringify({ error: "server_error", message: "down" }) });
    if (mock.failNextPost > 0) { mock.failNextPost--; return route.abort("connectionfailed"); }
    mock.lastPost = rec.body;
    return route.fulfill({ status: 200, headers: h, body: JSON.stringify({ day: rec.body.day, rank: mock.postRank, total: mock.total, rating: rec.body.rating, improved: true }) });
  }
  const u = new URL(req.url());
  mock.gets.push({ day: u.searchParams.get("day"), token: u.searchParams.get("token"), url: req.url() });
  if (mock.mode === "500") return route.fulfill({ status: 500, headers: h, body: JSON.stringify({ error: "server_error", message: "down" }) });
  const top = mock.top.slice();
  let you = null;
  if (mock.lastPost && mock.lastPost.day === u.searchParams.get("day")) {
    top.splice(mock.postRank - 1, 0, { name: mock.lastPost.name, rating: mock.lastPost.rating, speed: mock.lastPost.speed, acc: mock.lastPost.acc, sector: mock.lastPost.sector, ship: mock.lastPost.ship });
    if (u.searchParams.get("token") === mock.lastPost.token) you = { rank: mock.postRank, rating: mock.lastPost.rating };
  }
  return route.fulfill({ status: 200, headers: h, body: JSON.stringify({ day: u.searchParams.get("day"), total: mock.total, top: top.slice(0, 10), you }) });
});
await P.context.addInitScript((ep) => { window.TypeRHarness = Object.assign(window.TypeRHarness || {}, { leaderboardEndpoint: ep }); }, EP);

// ------------------------------------------------------------------ (ii) endpoint set, consent OFF: teaser GET yes, POST never
reqs.length = 0;
await P.goto(F5());
await sleep(300);
await setNow(P, day23);
await waitFor(P, () => { const s = window.game.lbDebug().state(); return s.board && s.board.day === "2026-10-23"; }, 5000);
const ii0 = await ui();
// boot fetched the real today's board once (before the probe moved the clock); the moved clock fetched 2026-10-23 once
const gets23 = () => mock.gets.filter((g) => g.day === "2026-10-23").length;
P.check("(ii) endpoint set + consent off: lbEnabled, the opt-in row is shown, the menu teaser reads 'Board: ACE leads with 61 · 12 pilots' from one GET ?day=2026-10-23, no GET carries a token, zero POSTs",
  ii0.enabled && ii0.endpoint === EP && !ii0.consent && !/hidden/.test(ii0.rowCls) && !/hidden/.test(ii0.teaserCls) && ii0.teaser === "Board: ACE leads with 61 · 12 pilots" &&
  gets23() === 1 && mock.gets.length <= 2 && mock.gets.every((g) => g.token === null) && mock.posts.length === 0, { ii0: { ...ii0, debug: undefined }, gets: mock.gets, posts: mock.posts.length });
// the teaser is throttled: several menu renders add no request
const getsBefore = mock.gets.length;
await P.g(() => { for (let i = 0; i < 5; i++) window.game.refreshMenu(); });
await sleep(300);
P.check("(ii) five more menu renders within 5 minutes add no GET (teaser throttle)", mock.gets.length === getsBefore, { before: getsBefore, after: mock.gets.length });
await startMode(P, "daily");
await typeWords(P, WORDS6, 150);
await P.g(() => window.game.modesDebug().finish("clear"));
await waitMode(P, "modeResults", 5000);
await waitFor(P, () => { const b = document.getElementById("modesBoard"); return b && b.dataset.state === "ok" && b.querySelectorAll(".lbRow").length > 0; }, 5000);
const ii1 = await ui();
P.check("(ii) counted sortie with consent off: zero POSTs; the results board (aria-live polite) shows 'Today's board' with 10 rows (rank, name, rating, wpm, acc), no 'You' line, the opt-in note",
  mock.posts.length === 0 && ii1.boardLive === "polite" && !/hidden/.test(ii1.boardCls) && ii1.title === "Today's board" && ii1.rows.length === 10 && ii1.rows[0].cells.join("|") === "1|ACE|61|70|93%" &&
  ii1.rows.every((r) => !r.you) && ii1.you === null && ii1.note === "Turn on Share daily sortie scores in Settings to enter the board." && ii1.debug.run && ii1.debug.run.status === "off",
  { posts: mock.posts.length, live: ii1.boardLive, title: ii1.title, rows: ii1.rows.slice(0, 2), you: ii1.you, note: ii1.note, run: ii1.debug.run });
P.check("(ii) every request outside the page origin went to the mocked board", foreign().every((r) => r.url.startsWith("https://board.test/")), { foreign: foreign().filter((r) => !r.url.startsWith("https://board.test/")).slice(0, 3) });
await P.g(() => window.game.stopToMenu(false));
await waitMode(P, "menu", 3000);

// ------------------------------------------------------------------ (iii) consent ON through the settings row, a counted sortie posts once
await P.page.click("#btnMenuSettings");
await sleep(300);
const rowVisible = await P.g(() => { const r = document.getElementById("setShareScoresRow").getBoundingClientRect(); return r.width > 0 && r.height > 0 && document.getElementById("settingsModal").contains(document.getElementById("setShareScores")); });
await P.page.check("#setShareScores");
await sleep(450);   // settings debounce (300 ms)
const iii0 = await P.g((k) => { const b = JSON.parse(localStorage.getItem(k)); return { consent: b.settings.shareDailyScores, token: b.playerToken, mem: window.game.save.playerToken, label: document.querySelector('label[for="setShareScores"]').textContent.replace(/\s+/g, " ").trim() }; }, LS_KEY);
await P.page.click("#btnSettingsClose");
await sleep(200);
P.check("(iii) the settings row is visible inside the modal, its copy is the opt-in text, checking it stores settings.shareDailyScores true and mints a UUID save.playerToken",
  rowVisible && iii0.consent === true && UUID_RE.test(iii0.token) && iii0.token === iii0.mem && iii0.label === "Share daily sortie scores (sends your pilot name and today's result to the public board)", iii0);
const tokenA = iii0.token;
await setNow(P, await localMs(P, 2026, 10, 24));
await startMode(P, "daily");
await typeWords(P, WORDS6, 150);
const before = mock.posts.length;
await P.g(() => window.game.modesDebug().finish("clear"));
await waitMode(P, "modeResults", 5000);
await waitFor(P, () => { const s = window.game.lbDebug().state(); return s.run && s.run.status === "posted" && s.boardState === "ok"; }, 6000);
await sleep(200);
const iii1 = await ui();
const post = mock.posts[before];
const body = post && post.body;
const r = iii1.debug.run;
const sector24 = await P.g(() => ({ plan: modesDailySectorFor(20261024, 5), result: window.game._modes && window.game._modes.result && window.game._modes.result.sector }));
const schemaOk = body && Object.keys(body).sort().join() === "acc,day,name,rank,rating,score,sector,ship,speed,token,version" &&
  body.day === "2026-10-24" && body.token === tokenA && body.name === "MODES" && Number.isInteger(body.rating) && body.rating > 0 && body.rating <= 3000 &&
  Number.isInteger(body.speed) && body.speed > 0 && body.speed <= 300 && typeof body.acc === "number" && body.acc >= 0 && body.acc <= 100 && Math.abs(body.rating - Math.round(body.speed * Math.pow(body.acc / 100, 2))) <= 1 &&
  Number.isInteger(body.score) && body.score >= 0 && body.sector === sector24.plan && body.sector === sector24.result && body.ship === "coconut" && (body.rank === null || /^[SABCD]$/.test(body.rank)) && body.version === "20261031a";
P.check("(iii) exactly one POST for the counted sortie: JSON body {day, token, name, rating, speed, acc, score, sector, ship, rank, version} with the contract's types and bounds, rating = round(speed x (acc/100)^2), Content-Type application/json",
  mock.posts.length === before + 1 && schemaOk && /application\/json/.test(post.headers["content-type"] || "") && post.url === EP, { body, sector24, ct: post && post.headers["content-type"], url: post && post.url });
P.check("(iii) the results board renders the top rows with the pilot's row 3 highlighted (is-you, aria-current) and 'You: #3 of 12'; run status posted; the board GET carried the token",
  r && r.status === "posted" && r.you && r.you.rank === 3 && r.you.total === 12 && iii1.rows.length === 10 && iii1.rows[2].you && iii1.rows[2].cur === "true" && iii1.rows[2].cells[1] === "MODES" &&
  iii1.rows.filter((x) => x.you).length === 1 && iii1.you === "You: #3 of 12" && iii1.note === null && mock.gets[mock.gets.length - 1].token === tokenA,
  { run: r, row2: iii1.rows[2], you: iii1.you, note: iii1.note, lastGet: mock.gets[mock.gets.length - 1] });
// Fly again = practice: no POST, the board still shows "You" from the GET. The results screen ignores Enter for a
// moment after it appears (t-modes-daily D7 presses it seconds later too), so wait that moment out first.
await sleep(2500);
await P.g(() => document.getElementById("btnModeAgain").focus());
await P.page.keyboard.press("Enter");
const flyAgain = await waitMode(P, "playing", 4000);
await waitFor(P, () => !window.game.levelIntro, 8000);
const before2 = mock.posts.length;
await P.g(() => window.game.modesDebug().finish("clear"));
await waitMode(P, "modeResults", 5000);
await waitFor(P, () => { const s = window.game.lbDebug().state(); return s.run && s.run.status === "practice" && !s.inflight; }, 6000);
await sleep(200);
const iii2 = await ui();
P.check("(iii) a practice sortie (Fly again) never posts; its board says 'Practice sorties do not enter the board.' and keeps 'You: #3 of 12' from the GET",
  flyAgain && mock.posts.length === before2 && iii2.debug.run.status === "practice" && iii2.note === "Practice sorties do not enter the board." && iii2.you === "You: #3 of 12", { flyAgain, posts: mock.posts.length - before2, run: iii2.debug.run, note: iii2.note, you: iii2.you });
await P.g(() => window.game.stopToMenu(false));
await waitMode(P, "menu", 3000);

// retry once on a network failure
mock.failNextPost = 1;
await setNow(P, await localMs(P, 2026, 10, 25));
await startMode(P, "daily");
await typeWords(P, WORDS6, 150);
const before3 = mock.posts.length;
await P.g(() => window.game.modesDebug().finish("clear"));
await waitMode(P, "modeResults", 5000);
await waitFor(P, () => { const s = window.game.lbDebug().state(); return s.run && s.run.status === "posted"; }, 8000);
const iii3 = await ui();
P.check("(iii) a failed POST (connection reset) is retried once: two attempts, the second succeeds, status posted", mock.posts.length === before3 + 2 && iii3.debug.run.status === "posted" && iii3.debug.run.you.rank === 3,
  { attempts: mock.posts.length - before3, run: iii3.debug.run });
await P.g(() => window.game.stopToMenu(false));
await waitMode(P, "menu", 3000);

// ------------------------------------------------------------------ (iv) endpoint answers 500: unavailable states, no page errors
mock.mode = "500";
await setNow(P, await localMs(P, 2026, 10, 26));
await P.g(() => window.game.lbDebug().reset());
await P.g(() => window.game.refreshMenu());
await waitFor(P, () => window.game.lbDebug().state().boardState === "error", 5000);
const iv0 = await ui();
await startMode(P, "daily");
await typeWords(P, WORDS6, 150);
const before4 = mock.posts.length;
await P.g(() => window.game.modesDebug().finish("clear"));
await waitMode(P, "modeResults", 5000);
await waitFor(P, () => { const s = window.game.lbDebug().state(); return s.run && s.run.status === "failed" && s.boardState === "error" && !s.inflight; }, 8000);
await sleep(200);
const iv1 = await ui();
const toasts = await P.g(() => [...document.querySelectorAll(".toast")].map((t) => t.textContent));
P.check("(iv) endpoint 500: the menu teaser is the muted 'Board unavailable'; after a counted sortie the POST is not retried on HTTP 500 (one attempt), run status failed, the board shows 'Board unavailable' + 'your result was not sent', no toast",
  iv0.teaser === "Board unavailable" && /is-muted/.test(iv0.teaserCls) && mock.posts.length === before4 + 1 && iv1.debug.run.status === "failed" && iv1.boardState === "error" && iv1.status === "Board unavailable" &&
  iv1.note === "Board unavailable · your result was not sent." && iv1.rows.length === 0 && !toasts.some((t) => /board/i.test(t)),
  { teaser: iv0.teaser, teaserCls: iv0.teaserCls, attempts: mock.posts.length - before4, run: iv1.debug.run, status: iv1.status, note: iv1.note, toasts });
P.check("(iv) a board failure never ends the sortie: the results card still rendered (COUNTED SORTIE, Fly again focused)",
  (await P.g(() => ({ head: document.querySelector("#resultsMode .resultsTitle").textContent, focus: document.activeElement && document.activeElement.id }))).head === "COUNTED SORTIE");
await P.g(() => window.game.stopToMenu(false));
await waitMode(P, "menu", 3000);
mock.mode = "ok";

// ------------------------------------------------------------------ Reset save rotates the token
await P.g(() => { window.game.onResetSavePressed(); });   // not awaited: it resolves with the confirm below
await P.page.locator("#btnConfirmOk").waitFor({ state: "visible", timeout: 2000 });
await P.page.click("#btnConfirmOk");
await sleep(400);
const reset = await P.g((k) => { const g = window.game; const stored = JSON.parse(localStorage.getItem(k)); const before = g.save.playerToken; g.setSetting("shareDailyScores", true); return { stored: stored.playerToken, consent: stored.settings.shareDailyScores, before, after: g.save.playerToken }; }, LS_KEY);
P.check("Reset save erases the token and the opt-in (playerToken \"\", shareDailyScores false); opting in again mints a different UUID",
  reset.stored === "" && reset.consent === false && reset.before === "" && UUID_RE.test(reset.after) && reset.after !== tokenA, reset);

// pure helpers
const pure = await P.g(() => [lbSanitiseName("  Ace \u0007 Pilot​  "), lbSanitiseName(""), lbSanitiseName("ABCDEFGHIJKLMNOP"), lbSanitiseName(" x"), lbIsUuid(lbMakeToken()), lbMakeToken() !== lbMakeToken()]);
P.check("pure helpers: lbSanitiseName strips control / zero-width chars, collapses spaces, caps at 12 code points, falls back to PILOT; lbMakeToken mints distinct UUIDs",
  pure[0] === "Ace Pilot" && pure[1] === "PILOT" && pure[2] === "ABCDEFGHIJKL" && pure[3] === "x" && pure[4] === true && pure[5] === true, pure);

// The mocked failures (one aborted POST, the 500 answers) make Chrome log "Failed to load resource" lines; those are the
// resource errors play.mjs ignores by policy. Anything else in the console, and any page error, fails the probe.
const other = P.errors.consoleErrors.filter((m) => !/^Failed to load resource/.test(m));
P.check("zero page errors; the only console errors are Chrome's resource-load lines for the mocked failures", P.errors.pageErrors.length === 0 && other.length === 0,
  { pageErrors: P.errors.pageErrors.slice(0, 3), other: other.slice(0, 3), resourceLines: P.errors.consoleErrors.length });
P.errors.consoleErrors.length = 0;   // counted above; P.finish() must not fail the run on them
await P.finish();
