#!/usr/bin/env bash
# tools/leaderboard/test-php.sh [--port N] [--keep]
# Exercises api/leaderboard.php against PHP's built-in server with curl: GET / POST / validation / headers / limits /
# rate limit / retention, with the database in a temp dir (TYPER_LEADERBOARD_DB). Needs php (brew install php) and curl.
# PASS/FAIL lines, exit 1 on any FAIL. --keep leaves the temp dir and prints its path.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
PORT=8089; KEEP=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --port) PORT="$2"; shift 2 ;;
    --keep) KEEP=1; shift ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done
command -v php >/dev/null 2>&1 || { echo "php not found (brew install php)"; exit 2; }
command -v curl >/dev/null 2>&1 || { echo "curl not found"; exit 2; }

TMP="$(mktemp -d)"
export TYPER_LEADERBOARD_DB="$TMP/board/leaderboard.sqlite"
LOG="$TMP/php.log"
php -S "127.0.0.1:$PORT" -t "$ROOT" > "$LOG" 2>&1 &
PID=$!
cleanup() { kill "$PID" 2>/dev/null; wait "$PID" 2>/dev/null; if [[ $KEEP -eq 1 ]]; then echo "kept $TMP"; else rm -rf "$TMP"; fi; }
trap cleanup EXIT
BASE="http://127.0.0.1:$PORT/api/leaderboard.php"
for _ in $(seq 1 50); do curl -s -o /dev/null "$BASE" 2>/dev/null && break; sleep 0.1; done

PASS=0; FAIL=0; POSTS=0
pass() { PASS=$((PASS+1)); echo "PASS  $*"; }
fail() { FAIL=$((FAIL+1)); echo "FAIL  $*"; }
check() { if [[ "$1" == "1" ]]; then pass "$2"; else fail "$2 ${3:-}"; fi; }
# req <method> <url> [curl args...]: STATUS, HEADERS and BODY are set
req() {
  local m="$1" u="$2"; shift 2
  local out; out="$(curl -s -X "$m" -D "$TMP/h" -o "$TMP/b" -w '%{http_code}' "$@" "$u")"
  STATUS="$out"; HEADERS="$(tr -d '\r' < "$TMP/h")"; BODY="$(cat "$TMP/b")"
}
# post <json>: a POST that passes the transport checks (JSON, <= 2 KB, not cross-site) and so counts against the IP limit
post() { req POST "$BASE" -H 'Content-Type: application/json' -H 'Sec-Fetch-Site: same-origin' --data "$1"; POSTS=$((POSTS+1)); }
jq_() { php -r '$j = json_decode(stream_get_contents(STDIN), true); $p = explode(".", $argv[1]); foreach ($p as $k) { if ($k === "") continue; $j = is_array($j) && array_key_exists($k, $j) ? $j[$k] : null; } echo is_scalar($j) || $j === null ? var_export($j, true) : json_encode($j);' "$1" <<< "$BODY"; }
hdr() { printf '%s\n' "$HEADERS" | awk -v k="$(printf '%s' "$1" | tr 'A-Z' 'a-z')" -F': *' 'tolower($1)==k { v=$0; sub(/^[^:]*: */, "", v); sub(/[ \t]+$/, "", v) } END { print tolower(v) }'; }

TODAY="$(date -u +%F)"
YESTERDAY="$(php -r 'echo gmdate("Y-m-d", time() - 86400);')"
TOKEN_A="11111111-2222-4333-8444-555555555555"
TOKEN_B="aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
body() { # body <token> <name> <rating> <speed> <acc> [day] [extra-json]
  printf '{"day":"%s","token":"%s","name":"%s","rating":%s,"speed":%s,"acc":%s,"score":12345,"sector":5,"ship":"coconut","rank":"A","version":"20261031a"%s}' "${6:-$TODAY}" "$1" "$2" "$3" "$4" "$5" "${7:-}"
}

echo "test-php: $BASE (db $TYPER_LEADERBOARD_DB)"

# 1 empty board
req GET "$BASE?day=$TODAY"
check "$([[ "$STATUS" == 200 && "$(jq_ total)" == 0 && "$(jq_ top)" == "[]" && "$(jq_ you)" == NULL && "$(jq_ day)" == "'$TODAY'" ]] && echo 1 || echo 0)" "GET empty day: 200 {day, total 0, top [], you null}" "$STATUS $BODY"
check "$([[ "$(hdr content-type)" == application/json* && "$(hdr cache-control)" == *no-store* && -z "$(hdr access-control-allow-origin)" && "$(hdr x-content-type-options)" == nosniff ]] && echo 1 || echo 0)" "headers: application/json, Cache-Control no-store, nosniff, no Access-Control-Allow-Origin" "$(hdr content-type) / $(hdr cache-control)"
req GET "$BASE"
check "$([[ "$STATUS" == 200 && "$(jq_ day)" == "'$TODAY'" ]] && echo 1 || echo 0)" "GET without day defaults to UTC today" "$STATUS $BODY"

# 2 first submission (rating 52 = 60 x 0.93^2 = 51.9)
post "$(body $TOKEN_A ACE 52 60 93)"
check "$([[ "$STATUS" == 200 && "$(jq_ rank)" == 1 && "$(jq_ total)" == 1 && "$(jq_ improved)" == true && "$(jq_ rating)" == 52 ]] && echo 1 || echo 0)" "POST valid: 200 rank 1 total 1 improved true" "$STATUS $BODY"
# 3 lower rating, same token: kept the best
post "$(body $TOKEN_A ACE 40 50 89.44)"
check "$([[ "$STATUS" == 200 && "$(jq_ improved)" == false && "$(jq_ rating)" == 52 && "$(jq_ total)" == 1 ]] && echo 1 || echo 0)" "POST lower rating same token: improved false, best kept (52), still one row" "$STATUS $BODY"
# 4 higher rating, same token: replaced
post "$(body $TOKEN_A ACE 65 70 96.4)"
check "$([[ "$STATUS" == 200 && "$(jq_ improved)" == true && "$(jq_ rating)" == 65 && "$(jq_ total)" == 1 ]] && echo 1 || echo 0)" "POST higher rating same token: improved true, rating 65, one row" "$STATUS $BODY"
# 5 second pilot beats A; A is #2 and sees it via token
post "$(body $TOKEN_B "Zed Pilot" 80 85 97)"
check "$([[ "$STATUS" == 200 && "$(jq_ rank)" == 1 && "$(jq_ total)" == 2 ]] && echo 1 || echo 0)" "POST second pilot: rank 1 total 2" "$STATUS $BODY"
req GET "$BASE?day=$TODAY&token=$TOKEN_A"
check "$([[ "$STATUS" == 200 && "$(jq_ total)" == 2 && "$(jq_ top.0.name)" == "'Zed Pilot'" && "$(jq_ top.1.name)" == "'ACE'" && "$(jq_ you.rank)" == 2 && "$(jq_ you.rating)" == 65 && "$(jq_ top.0.acc)" == 97 && "$(jq_ top.0.ship)" == "'coconut'" ]] && echo 1 || echo 0)" "GET with token: top ordered by rating, you {rank 2, rating 65}" "$STATUS $BODY"
req GET "$BASE?day=$TODAY&top=1"
check "$([[ "$STATUS" == 200 && "$(jq_ total)" == 2 && "$(jq_ top.1)" == NULL ]] && echo 1 || echo 0)" "GET top=1 limits the rows, total still 2" "$STATUS $BODY"
# yesterday accepted (local-date tolerance)
post "$(body $TOKEN_A ACE 52 60 93 "$YESTERDAY")"
check "$([[ "$STATUS" == 200 && "$(jq_ day)" == "'$YESTERDAY'" ]] && echo 1 || echo 0)" "POST for yesterday (UTC) accepted" "$STATUS $BODY"

# 6 validation
post "$(body $TOKEN_A ACE 52 60 93 2020-01-01)"
check "$([[ "$STATUS" == 400 && "$(jq_ error)" == "'invalid'" && "$(jq_ field)" == "'day'" ]] && echo 1 || echo 0)" "POST old day: 400 invalid field day" "$STATUS $BODY"
post "$(body not-a-uuid ACE 52 60 93)"
check "$([[ "$STATUS" == 400 && "$(jq_ field)" == "'token'" ]] && echo 1 || echo 0)" "POST bad token: 400 field token" "$STATUS $BODY"
post "$(body $TOKEN_A ACE 5000 60 93)"
check "$([[ "$STATUS" == 400 && "$(jq_ field)" == "'rating'" ]] && echo 1 || echo 0)" "POST rating 5000: 400 field rating" "$STATUS $BODY"
post "$(body $TOKEN_A ACE 10 50 100)"
check "$([[ "$STATUS" == 400 && "$(jq_ field)" == "'rating'" ]] && echo 1 || echo 0)" "POST rating inconsistent with speed x acc^2: 400 field rating" "$STATUS $BODY"
post "$(printf '{"day":"%s","token":"%s","name":"X","rating":50,"speed":50,"acc":100,"score":1,"sector":5,"ship":"x-wing","rank":"A","version":""}' "$TODAY" "$TOKEN_A")"
check "$([[ "$STATUS" == 400 && "$(jq_ field)" == "'ship'" ]] && echo 1 || echo 0)" "POST unknown ship: 400 field ship" "$STATUS $BODY"
post "$(printf '{"day":"%s","token":"%s","name":"X","rating":50,"speed":50,"acc":100,"score":1,"sector":11,"ship":"coconut","rank":"A","version":""}' "$TODAY" "$TOKEN_A")"
check "$([[ "$STATUS" == 400 && "$(jq_ field)" == "'sector'" ]] && echo 1 || echo 0)" "POST sector 11: 400 field sector" "$STATUS $BODY"
post "$(printf '{"day":"%s","token":"%s","name":"X","rating":50,"speed":50,"acc":100,"score":1,"sector":5,"ship":"coconut","rank":"Z","version":""}' "$TODAY" "$TOKEN_A")"
check "$([[ "$STATUS" == 400 && "$(jq_ field)" == "'rank'" ]] && echo 1 || echo 0)" "POST rank Z: 400 field rank" "$STATUS $BODY"
post "$(printf '{"day":"%s","token":"%s","name":"X","rating":50,"speed":50,"acc":100,"score":6000000,"sector":5,"ship":"coconut","rank":null,"version":""}' "$TODAY" "$TOKEN_A")"
check "$([[ "$STATUS" == 400 && "$(jq_ field)" == "'score'" ]] && echo 1 || echo 0)" "POST score 6,000,000: 400 field score" "$STATUS $BODY"
# name sanitised server-side: control chars stripped, spaces collapsed, 12 code points, empty -> PILOT, rank null ok
TOKEN_C="cccccccc-1111-4222-8333-444444444444"
post "$(printf '{"day":"%s","token":"%s","name":"  Ab\\u0007cd   efghijklmnop  ","rating":90,"speed":90,"acc":100,"score":1,"sector":5,"ship":"honeybee","rank":null,"version":"<script>"}' "$TODAY" "$TOKEN_C")"
TOKEN_D="dddddddd-1111-4222-8333-444444444444"
post "$(printf '{"day":"%s","token":"%s","name":"","rating":85,"speed":85,"acc":100,"score":1,"sector":5,"ship":"sofrito","rank":null,"version":""}' "$TODAY" "$TOKEN_D")"
req GET "$BASE?day=$TODAY"
check "$([[ "$(jq_ top.0.name)" == "'Abcd efghijk'" && "$(jq_ top.1.name)" == "'PILOT'" && "$(jq_ total)" == 4 ]] && echo 1 || echo 0)" "names sanitised server-side: 'Abcd efghijk' (12 code points, control char stripped), '' -> PILOT; rank null accepted" "$BODY"

# 7 transport rules
req POST "$BASE" -H 'Content-Type: text/plain' --data 'hello'
check "$([[ "$STATUS" == 415 && "$(jq_ error)" == "'unsupported_media_type'" ]] && echo 1 || echo 0)" "POST text/plain: 415" "$STATUS $BODY"
BIG="$(head -c 2100 /dev/zero | tr '\0' 'a')"
req POST "$BASE" -H 'Content-Type: application/json' --data "{\"name\":\"$BIG\"}"
check "$([[ "$STATUS" == 413 && "$(jq_ error)" == "'payload_too_large'" ]] && echo 1 || echo 0)" "POST 2.1 KB body: 413" "$STATUS"
req POST "$BASE" -H 'Content-Type: application/json' --data '{not json'
POSTS=$((POSTS+1))   # passes the transport checks, so it counts
check "$([[ "$STATUS" == 400 && "$(jq_ error)" == "'bad_json'" ]] && echo 1 || echo 0)" "POST bad JSON: 400 bad_json" "$STATUS $BODY"
req POST "$BASE" -H 'Content-Type: application/json' -H 'Sec-Fetch-Site: cross-site' --data "$(body $TOKEN_A ACE 52 60 93)"
check "$([[ "$STATUS" == 403 && "$(jq_ error)" == "'cross_origin'" ]] && echo 1 || echo 0)" "POST Sec-Fetch-Site: cross-site: 403" "$STATUS $BODY"
req PUT "$BASE" --data ''
check "$([[ "$STATUS" == 405 && "$(hdr allow)" == *post* ]] && echo 1 || echo 0)" "PUT: 405 with Allow" "$STATUS $(hdr allow)"
req OPTIONS "$BASE"
check "$([[ "$STATUS" == 204 && "$(hdr allow)" == *"get, post, options"* && -z "$(hdr access-control-allow-origin)" ]] && echo 1 || echo 0)" "OPTIONS: 204, Allow: GET, POST, OPTIONS, no CORS header" "$STATUS $(hdr allow)"
req GET "$BASE?day=nope"
check "$([[ "$STATUS" == 400 && "$(jq_ field)" == "'day'" ]] && echo 1 || echo 0)" "GET day=nope: 400 field day" "$STATUS $BODY"

# 8 storage: the db and the salt file live where TYPER_LEADERBOARD_DB says, the salt is 0600 and 64 hex chars
check "$([[ -f "$TYPER_LEADERBOARD_DB" && -f "$TYPER_LEADERBOARD_DB.salt" && "$(wc -c < "$TYPER_LEADERBOARD_DB.salt" | tr -d ' ')" -ge 64 && "$(stat -f '%Lp' "$TYPER_LEADERBOARD_DB.salt" 2>/dev/null || stat -c '%a' "$TYPER_LEADERBOARD_DB.salt")" == "600" ]] && echo 1 || echo 0)" "database and 0600 salt file created at TYPER_LEADERBOARD_DB" "$(ls -la "$(dirname "$TYPER_LEADERBOARD_DB")" 2>&1 | tail -3 | tr '\n' ' ')"
check "$([[ "$(php -r '$p = new PDO("sqlite:" . getenv("TYPER_LEADERBOARD_DB")); echo $p->query("SELECT COUNT(*) FROM writes")->fetchColumn();')" == 1 ]] && echo 1 || echo 0)" "one hashed-IP counter row (no raw address stored)"
check "$([[ "$(php -r '$p = new PDO("sqlite:" . getenv("TYPER_LEADERBOARD_DB")); echo $p->query("SELECT iphash FROM writes")->fetchColumn();')" =~ ^[0-9a-f]{32}$ ]] && echo 1 || echo 0)" "the IP counter key is a 32-hex salted hash"

# 9 retention: a 100-day-old row is purged by the next write
php -r '$p = new PDO("sqlite:" . getenv("TYPER_LEADERBOARD_DB")); $p->exec("INSERT INTO scores VALUES (\"2020-01-01\",\"99999999-9999-4999-8999-999999999999\",\"OLD\",1,1,100,1,1,\"coconut\",NULL,\"\",0,0)");'
OLD_BEFORE="$(php -r '$p = new PDO("sqlite:" . getenv("TYPER_LEADERBOARD_DB")); echo $p->query("SELECT COUNT(*) FROM scores WHERE day = \"2020-01-01\"")->fetchColumn();')"
post "$(body $TOKEN_B "Zed Pilot" 81 86 97)"
OLD_AFTER="$(php -r '$p = new PDO("sqlite:" . getenv("TYPER_LEADERBOARD_DB")); echo $p->query("SELECT COUNT(*) FROM scores WHERE day = \"2020-01-01\"")->fetchColumn();')"
check "$([[ "$OLD_BEFORE" == 1 && "$OLD_AFTER" == 0 ]] && echo 1 || echo 0)" "90-day retention: a 2020 row is purged on the next write" "before $OLD_BEFORE after $OLD_AFTER"

# 10 rate limit: 30 POST attempts per hashed IP per UTC day, the 31st is 429 (invalid bodies count too; 415 / 413 / 403
# transport rejections happen before the counter and do not)
LIMIT_HIT=""
while [[ $POSTS -lt 31 ]]; do
  post "$(body $TOKEN_B "Zed Pilot" 81 86 97)"
  if [[ "$STATUS" == 429 ]]; then LIMIT_HIT="$POSTS"; break; fi
done
check "$([[ "$LIMIT_HIT" == 31 && "$(jq_ error)" == "'rate_limited'" && -n "$(hdr retry-after)" ]] && echo 1 || echo 0)" "rate limit: POST attempt 31 of the day answers 429 rate_limited with Retry-After (30 allowed)" "hit at attempt ${LIMIT_HIT:-none}, status $STATUS"
req GET "$BASE?day=$TODAY"
check "$([[ "$STATUS" == 200 && "$(jq_ total)" == 4 ]] && echo 1 || echo 0)" "GET still answers after the limit (reads are not limited)" "$STATUS"

# 11 no PHP notices / traces in the server log or any body
check "$([[ ! -s "$LOG" || -z "$(grep -iE 'warning|notice|fatal|stack trace|deprecated' "$LOG")" ]] && echo 1 || echo 0)" "php -S log carries no warning / notice / fatal / trace" "$(grep -iE 'warning|notice|fatal|stack trace|deprecated' "$LOG" | head -3)"
php -l "$ROOT/api/leaderboard.php" > "$TMP/lint" 2>&1 && pass "php -l api/leaderboard.php: $(head -1 "$TMP/lint")" || fail "php -l: $(cat "$TMP/lint")"

echo "test-php: $PASS passed, $FAIL failed ($POSTS POST attempts)"
[[ $FAIL -eq 0 ]]
