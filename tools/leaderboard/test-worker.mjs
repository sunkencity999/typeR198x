#!/usr/bin/env node
// tools/leaderboard/test-worker.mjs: drives tools/leaderboard/worker.js in Node with an in-memory KV namespace and
// the global Request / Response (Node >= 18): the same contract checks as test-php.sh, minus the SQLite specifics.
// PASS/FAIL lines, exit 1 on any FAIL. Usage: node tools/leaderboard/test-worker.mjs
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const worker = (await import(pathToFileURL(path.join(HERE, "worker.js")).href)).default;

// In-memory KV: get / put with expirationTtl / expiration recorded for the assertions.
const kv = { map: new Map(), meta: new Map(),
  async get(k) { return this.map.has(k) ? this.map.get(k) : null; },
  async put(k, v, opts) { this.map.set(k, String(v)); this.meta.set(k, opts || {}); } };
const env = { BOARD: kv, ALLOWED_ORIGINS: "https://typer198x.com,https://www.typer198x.com", IP_SALT: "test-salt" };
const EP = "https://board.example/";
const ORIGIN = "https://typer198x.com";

let pass = 0, fail = 0, posts = 0;
const check = (ok, name, evidence) => { if (ok) { pass++; console.log(`PASS  ${name}`); } else { fail++; console.log(`FAIL  ${name}  ${evidence === undefined ? "" : JSON.stringify(evidence)}`); } };
async function call(method, query = "", { body, headers = {}, ip = "203.0.113.7", origin = ORIGIN } = {}) {
  const h = { ...headers };
  if (origin) h.Origin = origin;
  if (ip) h["CF-Connecting-IP"] = ip;
  if (body !== undefined && !("Content-Type" in h)) h["Content-Type"] = "application/json";
  const req = new Request(EP + query, { method, headers: h, body: body === undefined ? undefined : (typeof body === "string" ? body : JSON.stringify(body)) });
  if (method === "POST" && (h["Content-Type"] || "").startsWith("application/json") && origin === ORIGIN && String(body).length <= 2048) posts++;
  const res = await worker.fetch(req, env);
  let json = null;
  try { json = await res.clone().json(); } catch (_) { json = null; }
  return { status: res.status, headers: Object.fromEntries(res.headers.entries()), json };
}
const today = new Date().toISOString().slice(0, 10);
const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
const A = "11111111-2222-4333-8444-555555555555", B = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const body = (token, name, rating, speed, acc, extra = {}) => ({ day: today, token, name, rating, speed, acc, score: 12345, sector: 5, ship: "coconut", rank: "A", version: "20261031a", ...extra });

let r = await call("GET", `?day=${today}`);
check(r.status === 200 && r.json.total === 0 && Array.isArray(r.json.top) && r.json.top.length === 0 && r.json.you === null && r.json.day === today, "GET empty day: 200 {day, total 0, top [], you null}", r);
check(/application\/json/.test(r.headers["content-type"]) && r.headers["cache-control"] === "no-store" && r.headers["access-control-allow-origin"] === ORIGIN && r.headers.vary === "Origin" && r.headers["x-content-type-options"] === "nosniff",
  "headers: application/json, no-store, nosniff, Access-Control-Allow-Origin echoes the allowed origin + Vary: Origin", r.headers);
r = await call("GET", "", { origin: null });
check(r.status === 200 && r.json.day === today && !("access-control-allow-origin" in r.headers), "GET without Origin (curl): 200, UTC today, no CORS header", r.headers);
r = await call("GET", `?day=${today}`, { origin: "https://evil.example" });
check(r.status === 403 && r.json.error === "cross_origin" && !("access-control-allow-origin" in r.headers), "GET from a foreign Origin: 403 cross_origin, no CORS header", r);
r = await call("OPTIONS", "");
check(r.status === 204 && r.headers.allow === "GET, POST, OPTIONS" && r.headers["access-control-allow-origin"] === ORIGIN && /POST/.test(r.headers["access-control-allow-methods"]) && /Content-Type/.test(r.headers["access-control-allow-headers"]), "OPTIONS preflight from the allowed origin: 204 with the CORS headers", r.headers);
r = await call("OPTIONS", "", { origin: "https://evil.example" });
check(r.status === 403, "OPTIONS from a foreign Origin: 403", r.status);

r = await call("POST", "", { body: body(A, "ACE", 52, 60, 93) });
check(r.status === 200 && r.json.rank === 1 && r.json.total === 1 && r.json.improved === true && r.json.rating === 52, "POST valid: 200 rank 1 total 1 improved true", r.json);
const dayKey = `day:${today}`;
check(kv.meta.get(dayKey) && kv.meta.get(dayKey).expiration > Math.floor(Date.now() / 1000) + 89 * 86400 && kv.meta.get(dayKey).expiration < Math.floor(Date.now() / 1000) + 93 * 86400, "the day blob expires ~91 days after its day (retention)", kv.meta.get(dayKey));
r = await call("POST", "", { body: body(A, "ACE", 40, 50, 89.44) });
check(r.status === 200 && r.json.improved === false && r.json.rating === 52 && r.json.total === 1, "POST lower rating same token: improved false, best kept, one row", r.json);
r = await call("POST", "", { body: body(A, "ACE", 65, 70, 96.4) });
check(r.status === 200 && r.json.improved === true && r.json.rating === 65 && r.json.total === 1, "POST higher rating same token: replaced", r.json);
r = await call("POST", "", { body: body(B, "Zed Pilot", 80, 85, 97) });
check(r.status === 200 && r.json.rank === 1 && r.json.total === 2, "POST second pilot: rank 1 total 2", r.json);
r = await call("GET", `?day=${today}&token=${A}`);
check(r.status === 200 && r.json.total === 2 && r.json.top[0].name === "Zed Pilot" && r.json.top[1].name === "ACE" && r.json.you && r.json.you.rank === 2 && r.json.you.rating === 65 && Object.keys(r.json.top[0]).sort().join() === "acc,name,rating,sector,ship,speed",
  "GET with token: ordered top rows with exactly {name, rating, speed, acc, sector, ship}, you {rank 2, rating 65}", r.json);
r = await call("GET", `?day=${today}&top=1`);
check(r.status === 200 && r.json.top.length === 1 && r.json.total === 2, "GET top=1 limits the rows, total still 2", r.json);
r = await call("POST", "", { body: body(A, "ACE", 52, 60, 93, { day: yesterday }) });
check(r.status === 200 && r.json.day === yesterday, "POST for yesterday (UTC) accepted", r.json);

const bad = async (b, field, name) => { const x = await call("POST", "", { body: b }); check(x.status === 400 && x.json.error === "invalid" && x.json.field === field, name, x.json); };
await bad(body(A, "ACE", 52, 60, 93, { day: "2020-01-01" }), "day", "POST old day: 400 field day");
await bad(body(A, "ACE", 52, 60, 93, { day: "2026-02-30" }), "day", "POST 2026-02-30 (not a calendar date): 400 field day");
await bad(body("nope", "ACE", 52, 60, 93), "token", "POST bad token: 400 field token");
await bad(body(A, "ACE", 5000, 60, 93), "rating", "POST rating 5000: 400 field rating");
await bad(body(A, "ACE", 10, 50, 100), "rating", "POST rating inconsistent with speed x acc^2: 400 field rating");
await bad(body(A, "ACE", 50, 50, 100, { ship: "x-wing" }), "ship", "POST unknown ship: 400 field ship");
await bad(body(A, "ACE", 50, 50, 100, { sector: 11 }), "sector", "POST sector 11: 400 field sector");
await bad(body(A, "ACE", 50, 50, 100, { rank: "Z" }), "rank", "POST rank Z: 400 field rank");
await bad(body(A, "ACE", 50, 50, 100, { score: 6000000 }), "score", "POST score 6,000,000: 400 field score");
await bad(body(A, "ACE", 50, 50, 101), "acc", "POST acc 101: 400 field acc");
const C = "cccccccc-1111-4222-8333-444444444444", D = "dddddddd-1111-4222-8333-444444444444";
await call("POST", "", { body: body(C, "  Ab\u0007cd   efghijklmnop  ", 90, 90, 100, { ship: "honeybee", rank: null, version: "<script>" }) });
await call("POST", "", { body: body(D, "", 85, 85, 100, { ship: "sofrito", rank: null }) });
r = await call("GET", `?day=${today}`);
check(r.json.top[0].name === "Abcd efghijk" && r.json.top[1].name === "PILOT" && r.json.total === 4, "names sanitised server-side (12 code points, control char stripped, '' -> PILOT); rank null accepted", r.json.top.map((x) => x.name));

r = await call("POST", "", { body: "hello", headers: { "Content-Type": "text/plain" } });
check(r.status === 415 && r.json.error === "unsupported_media_type", "POST text/plain: 415", r.json);
r = await call("POST", "", { body: JSON.stringify({ name: "a".repeat(2100) }) });
check(r.status === 413 && r.json.error === "payload_too_large", "POST 2.1 KB body: 413", r.json);
r = await call("POST", "", { body: "{not json" });
check(r.status === 400 && r.json.error === "bad_json", "POST bad JSON: 400 bad_json", r.json);
r = await call("POST", "", { body: body(A, "ACE", 52, 60, 93), origin: "https://evil.example" });
check(r.status === 403 && r.json.error === "cross_origin", "POST from a foreign Origin: 403 cross_origin", r.json);
r = await call("PUT", "", { body: "" });
check(r.status === 405 && r.headers.allow === "GET, POST, OPTIONS", "PUT: 405 with Allow", r.status);
r = await call("GET", "?day=nope");
check(r.status === 400 && r.json.field === "day", "GET day=nope: 400 field day", r.json);

// per-IP limit: 30 counted POSTs per UTC day, the 31st is 429; another address is unaffected; the counter expires in 24 h
let hit = null;
while (posts < 31) { r = await call("POST", "", { body: body(B, "Zed Pilot", 81, 86, 97) }); if (r.status === 429) { hit = posts; break; } }
const ipKeys = [...kv.map.keys()].filter((k) => k.startsWith("ip:"));
check(hit === 31 && r.json.error === "rate_limited" && r.headers["retry-after"] === "3600", "rate limit: counted POST attempt 31 answers 429 rate_limited with Retry-After", { hit, status: r.status });
check(ipKeys.length === 1 && /^ip:\d{4}-\d{2}-\d{2}:[0-9a-f]{32}$/.test(ipKeys[0]) && kv.meta.get(ipKeys[0]).expirationTtl === 86400, "one IP counter key, a 32-hex salted hash under the UTC day, expiring after 24 h", { ipKeys, meta: kv.meta.get(ipKeys[0]) });
r = await call("POST", "", { body: body("eeeeeeee-1111-4222-8333-444444444444", "OTHER", 30, 30, 100), ip: "198.51.100.9" });
check(r.status === 200, "another address is not limited", r.status);
r = await call("GET", `?day=${today}`);
check(r.status === 200 && r.json.total === 5, "GET still answers after the limit (reads are not limited)", r.json.total);

console.log(`test-worker: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
