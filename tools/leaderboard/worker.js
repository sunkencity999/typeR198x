// Type-R 198X — daily sortie leaderboard (backend B: Cloudflare Worker + KV namespace BOARD).
// Same contract and rules as api/leaderboard.php (tools/leaderboard/README.md):
//   GET  ?day=YYYY-MM-DD[&token=<uuid>][&top=N] -> { day, total, top: [{name, rating, speed, acc, sector, ship}], you: {rank, rating} | null }
//   POST application/json {day, token, name, rating, speed, acc, score, sector, ship, rank, version} -> { day, rank, total, rating, improved }
//   OPTIONS -> 204 (CORS preflight for the allowed origins)
// A Worker lives on another origin than the game, so CORS IS needed here: only the origins in env.ALLOWED_ORIGINS get
// Access-Control-Allow-Origin (echoed, never "*"); a browser POST from any other origin is refused with 403.
//
// KV layout: "day:<YYYY-MM-DD>" -> { rows: { "<token>": {name, rating, speed, acc, score, sector, ship, rank, version, t} } }
//   (expires retention_days after the day), "ip:<YYYY-MM-DD>:<hash>" -> "<n>" (expires after 24 h). The per-day blob is
//   read-modify-written, so two submissions landing within KV's propagation window (~1 s) can race; the loser's row is
//   restored by its next submission. For an indie board that is acceptable; a Durable Object would make it strict.
// Secrets / vars (wrangler.toml.example): ALLOWED_ORIGINS (comma-separated), IP_SALT (`wrangler secret put IP_SALT`).

// ---------------------------------------------------------------- the plausibility table (tune here; keep it equal to LB_RULES in leaderboard.php)
const RULES = Object.freeze({
  rating: [0, 3000],
  speed: [0, 300],
  acc: [0, 100],
  score: [0, 5000000],
  sector: [1, 10],
  ships: ["coconut", "little-dark-one", "sofrito", "honeybee"],
  ranks: ["S", "A", "B", "C", "D"],
  ratingTolerance: 2,
  nameMax: 12,
  nameFallback: "PILOT",
  versionMax: 24,
  dayPast: 1,
  dayFuture: 1,
  topDefault: 10,
  topMax: 50,
  bodyMax: 2048,
  writesPerIpPerDay: 30,
  retentionDays: 90
});
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BASE_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex"
};

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin");
    const allowed = allowedOrigins(env);
    const cors = corsHeaders(origin, allowed);
    try {
      if (request.method === "OPTIONS") {
        if (origin && !cors) return json(403, { error: "cross_origin", message: "Origin not allowed." }, {});
        return new Response(null, { status: 204, headers: { Allow: "GET, POST, OPTIONS", ...(cors || {}), "Access-Control-Max-Age": "86400" } });
      }
      if (origin && !cors) return json(403, { error: "cross_origin", message: "Origin not allowed." }, {});
      if (request.method === "GET" || request.method === "HEAD") return handleGet(request, env, cors || {});
      if (request.method === "POST") return handlePost(request, env, cors || {});
      return json(405, { error: "method_not_allowed", message: "Use GET, POST or OPTIONS." }, { Allow: "GET, POST, OPTIONS", ...(cors || {}) });
    } catch (e) {
      console.error("[typer198x leaderboard]", e && e.message);
      return json(500, { error: "server_error", message: "The board is unavailable." }, cors || {});
    }
  }
};

// ---------------------------------------------------------------- helpers
function json(status, data, extra) {
  return new Response(JSON.stringify(data), { status, headers: { ...BASE_HEADERS, ...extra } });
}

function allowedOrigins(env) {
  return String(env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim().replace(/\/$/, "")).filter(Boolean);
}

function corsHeaders(origin, allowed) {
  if (!origin) return null;
  if (!allowed.includes(origin.replace(/\/$/, ""))) return null;
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Accept",
    Vary: "Origin"
  };
}

function utcToday() {
  return new Date().toISOString().slice(0, 10);
}

function parseDay(v) {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T00:00:00Z`);
  return Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) !== v ? null : (d.toISOString().slice(0, 10) === v ? v : null);
}

function dayInWindow(day) {
  const diff = Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${utcToday()}T00:00:00Z`)) / 86400000);
  return diff >= -RULES.dayPast && diff <= RULES.dayFuture;
}

function isUuid(v) {
  return typeof v === "string" && UUID_RE.test(v);
}

function sanitiseName(v) {
  let s = typeof v === "string" ? v : "";
  s = s.replace(/[\u0000-\u001f\u007f-\u009f​-‏ -‮⁠-⁯﻿]/g, "");
  s = s.replace(/\s+/g, " ").trim();
  s = Array.from(s).slice(0, RULES.nameMax).join("").trim();
  return s || RULES.nameFallback;
}

function intIn(v, range) {
  if (typeof v === "boolean" || v === null || v === undefined || v === "") return null;
  const f = Number(v);
  if (!Number.isFinite(f)) return null;
  const n = Math.round(f);
  return n >= range[0] && n <= range[1] ? n : null;
}

// [clean, null] or [null, [field, message]]
function validate(input) {
  const day = parseDay(input.day);
  if (!day || !dayInWindow(day)) return [null, ["day", "day must be YYYY-MM-DD within a day of today (UTC)"]];
  if (!isUuid(input.token)) return [null, ["token", "token must be a UUID"]];
  const rating = intIn(input.rating, RULES.rating);
  if (rating === null) return [null, ["rating", `rating must be an integer ${RULES.rating[0]}..${RULES.rating[1]}`]];
  const speed = intIn(input.speed, RULES.speed);
  if (speed === null) return [null, ["speed", `speed must be an integer ${RULES.speed[0]}..${RULES.speed[1]}`]];
  const accF = typeof input.acc === "boolean" ? NaN : Number(input.acc);
  if (!Number.isFinite(accF) || input.acc === null || input.acc === "") return [null, ["acc", "acc must be a number 0..100"]];
  const acc = Math.round(accF * 100) / 100;
  if (acc < RULES.acc[0] || acc > RULES.acc[1]) return [null, ["acc", "acc must be a number 0..100"]];
  const score = intIn(input.score, RULES.score);
  if (score === null) return [null, ["score", `score must be an integer ${RULES.score[0]}..${RULES.score[1]}`]];
  const sector = intIn(input.sector, RULES.sector);
  if (sector === null) return [null, ["sector", "sector must be 1..10"]];
  if (!RULES.ships.includes(input.ship)) return [null, ["ship", "unknown ship"]];
  const rank = input.rank === undefined ? null : input.rank;
  if (rank !== null && !RULES.ranks.includes(rank)) return [null, ["rank", "rank must be S, A, B, C, D or null"]];
  const expected = Math.round(speed * Math.pow(acc / 100, 2));
  if (Math.abs(rating - expected) > RULES.ratingTolerance) return [null, ["rating", "rating does not match speed and accuracy"]];
  const version = (typeof input.version === "string" ? input.version.replace(/[^A-Za-z0-9._-]/g, "") : "").slice(0, RULES.versionMax);
  return [{ day, token: input.token.toLowerCase(), name: sanitiseName(input.name), rating, speed, acc, score, sector, ship: input.ship, rank, version }, null];
}

async function sha256Hex(s) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function readDay(env, day) {
  const raw = await env.BOARD.get(`day:${day}`);
  if (!raw) return { rows: {} };
  try { const o = JSON.parse(raw); return o && typeof o.rows === "object" && o.rows ? o : { rows: {} }; } catch (_) { return { rows: {} }; }
}

function sorted(rows) {
  return Object.entries(rows).map(([token, r]) => ({ token, ...r })).sort((a, b) => (b.rating - a.rating) || (a.t - b.t) || (a.token < b.token ? -1 : 1));
}

function board(day, data, token, top) {
  const list = sorted(data.rows);
  const out = list.slice(0, top).map((r) => ({ name: r.name, rating: r.rating, speed: r.speed, acc: r.acc, sector: r.sector, ship: r.ship }));
  let you = null;
  if (token) {
    const i = list.findIndex((r) => r.token === token);
    if (i >= 0) you = { rank: i + 1, rating: list[i].rating };
  }
  return { day, total: list.length, top: out, you };
}

// ---------------------------------------------------------------- GET
async function handleGet(request, env, cors) {
  const url = new URL(request.url);
  const day = url.searchParams.has("day") ? parseDay(url.searchParams.get("day")) : utcToday();
  if (!day) return json(400, { error: "invalid", message: "day must be YYYY-MM-DD", field: "day" }, cors);
  const t = url.searchParams.get("token");
  const token = isUuid(t) ? t.toLowerCase() : null;
  const top = intIn(url.searchParams.get("top") ?? RULES.topDefault, [1, RULES.topMax]) ?? RULES.topDefault;
  const data = await readDay(env, day);
  return json(200, board(day, data, token, top), cors);
}

// ---------------------------------------------------------------- POST
async function handlePost(request, env, cors) {
  const ct = (request.headers.get("Content-Type") || "").split(";")[0].trim().toLowerCase();
  if (ct !== "application/json") return json(415, { error: "unsupported_media_type", message: "Send application/json." }, cors);
  const len = Number(request.headers.get("Content-Length") || 0);
  if (len > RULES.bodyMax) return json(413, { error: "payload_too_large", message: `The body must be at most ${RULES.bodyMax} bytes.` }, cors);
  const raw = await request.text();
  if (raw.length > RULES.bodyMax) return json(413, { error: "payload_too_large", message: `The body must be at most ${RULES.bodyMax} bytes.` }, cors);

  // Every POST attempt counts against the per-IP limit, valid or not.
  const ip = request.headers.get("CF-Connecting-IP") || "0.0.0.0";
  const ipHash = (await sha256Hex(`${env.IP_SALT || "typer198x"}|${ip}`)).slice(0, 32);
  const today = utcToday();
  const ipKey = `ip:${today}:${ipHash}`;
  const n = Number(await env.BOARD.get(ipKey)) || 0;
  await env.BOARD.put(ipKey, String(n + 1), { expirationTtl: 86400 });
  if (n + 1 > RULES.writesPerIpPerDay) return json(429, { error: "rate_limited", message: "Too many submissions from this address today." }, { ...cors, "Retry-After": "3600" });

  let input;
  try { input = JSON.parse(raw); } catch (_) { input = null; }
  if (!input || typeof input !== "object" || Array.isArray(input)) return json(400, { error: "bad_json", message: "The body must be a JSON object." }, cors);
  const [clean, err] = validate(input);
  if (err) return json(400, { error: "invalid", message: err[1], field: err[0] }, cors);

  const data = await readDay(env, clean.day);
  const cur = data.rows[clean.token];
  let improved = false;
  if (!cur || clean.rating > cur.rating) {
    data.rows[clean.token] = { name: clean.name, rating: clean.rating, speed: clean.speed, acc: clean.acc, score: clean.score, sector: clean.sector, ship: clean.ship, rank: clean.rank, version: clean.version, t: Date.now() };
    improved = true;
    // retention: the blob expires retentionDays after its day (KV deletes it; nothing else to purge)
    const expireAt = Math.floor(Date.parse(`${clean.day}T00:00:00Z`) / 1000) + (RULES.retentionDays + 1) * 86400;
    await env.BOARD.put(`day:${clean.day}`, JSON.stringify(data), { expiration: Math.max(expireAt, Math.floor(Date.now() / 1000) + 3600) });
  }
  const b = board(clean.day, data, clean.token, 1);
  return json(200, { day: clean.day, rank: b.you ? b.you.rank : 1, total: b.total, rating: b.you ? b.you.rating : clean.rating, improved }, cors);
}
