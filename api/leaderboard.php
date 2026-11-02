<?php
declare(strict_types=1);
/**
 * Type-R 198X — daily sortie leaderboard (backend A: shared host, PHP 8, PDO SQLite, no Composer).
 *
 * Contract (tools/leaderboard/README.md):
 *   GET  ?day=YYYY-MM-DD[&token=<uuid>][&top=N]  -> { day, total, top: [{name, rating, speed, acc, sector, ship}], you: {rank, rating} | null }
 *   POST application/json {day, token, name, rating, speed, acc, score, sector, ship, rank, version}
 *                                                -> { day, rank, total, rating, improved }
 *   OPTIONS                                      -> 204, Allow: GET, POST, OPTIONS
 *   errors                                       -> { error, message[, field] } with 400 / 403 / 405 / 413 / 415 / 429 / 500
 * Always JSON, Cache-Control: no-store, no CORS header (same origin only: the game page and this file live on one host).
 * One row per (day, token) keeping the best rating; per-IP write limit (salted SHA-256 of the address, the salt lives
 * next to the database); 90-day retention purged on every write; no stack trace ever reaches the client.
 *
 * Storage: TYPER_LEADERBOARD_DB (env) > <web root>/../typer198x-private/leaderboard.sqlite (above the web root, when that
 * directory exists and is writable) > api/.ht_leaderboard.sqlite (fallback inside the web root, denied by api/.htaccess).
 *
 * Anti-cheat is honour-system grade (plausibility bounds + a rating/speed/accuracy consistency check), like every indie
 * web board: the client is open source and a determined player can forge a request. Tune LB_RULES below.
 */

// ---------------------------------------------------------------- the plausibility table (tune here)
const LB_RULES = [
    'rating'               => [0, 3000],      // integer, speed x (acc / 100)^2
    'speed'                => [0, 300],       // WPM, integer
    'acc'                  => [0, 100],       // percent, 2 decimals
    'score'                => [0, 5000000],
    'sector'               => [1, 10],
    'ships'                => ['coconut', 'little-dark-one', 'sofrito', 'honeybee'],
    'ranks'                => ['S', 'A', 'B', 'C', 'D'],   // or null (a lost sortie has no rank)
    'rating_tolerance'     => 2,              // |rating - round(speed x (acc/100)^2)| must not exceed this
    'name_max'             => 12,             // code points after sanitising
    'name_fallback'        => 'PILOT',
    'version_max'          => 24,             // the shell token the client ran (informational)
    'day_past'             => 1,              // accepted days: UTC today - day_past .. UTC today + day_future
    'day_future'           => 1,              //   (the client sends its LOCAL date, so +-1 covers every time zone)
    'top_default'          => 10,
    'top_max'              => 50,
    'body_max'             => 2048,           // bytes of request body
    'writes_per_ip_per_day' => 30,            // POST attempts per hashed IP per UTC day, counted once a request passes the
                                              //   transport checks (JSON, <= body_max, not cross-site), valid body or not
    'retention_days'       => 90,
    'trust_forwarded_for'  => false,          // true only behind a proxy that overwrites X-Forwarded-For
    'require_same_origin'  => true,           // a POST that a browser marks Sec-Fetch-Site: cross-site is refused
];
const LB_DB_DEFAULT = __DIR__ . '/../../typer198x-private/leaderboard.sqlite';
const LB_DB_FALLBACK = __DIR__ . '/.ht_leaderboard.sqlite';
const LB_UUID_RE = '/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i';

// ---------------------------------------------------------------- hardening: never leak a trace
ini_set('display_errors', '0');
ini_set('html_errors', '0');
error_reporting(E_ALL);
set_error_handler(static function (int $no, string $str, string $file, int $line): bool {
    throw new ErrorException($str, 0, $no, $file, $line);
});
register_shutdown_function(static function (): void {
    $e = error_get_last();
    if ($e !== null && in_array($e['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR], true) && !headers_sent()) {
        http_response_code(500);
        header('Content-Type: application/json; charset=utf-8');
        header('Cache-Control: no-store');
        echo '{"error":"server_error","message":"The board is unavailable."}';
    }
});

lb_main();

// ---------------------------------------------------------------- entry
function lb_main(): void
{
    header_remove('X-Powered-By');
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
    header('Referrer-Policy: no-referrer');
    header('X-Robots-Tag: noindex');
    $method = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
    if ($method === 'OPTIONS') {
        header('Allow: GET, POST, OPTIONS');
        http_response_code(204);
        exit;
    }
    if ($method === 'HEAD') {
        $method = 'GET';
    }
    if ($method !== 'GET' && $method !== 'POST') {
        header('Allow: GET, POST, OPTIONS');
        lb_fail(405, 'method_not_allowed', 'Use GET, POST or OPTIONS.');
    }
    try {
        $pdo = lb_db();
        if ($method === 'GET') {
            lb_get($pdo);
        } else {
            lb_post($pdo);
        }
    } catch (LbHttpError $e) {
        throw $e;   // already answered by lb_fail (never reached: lb_fail exits)
    } catch (Throwable $e) {
        error_log('[typer198x leaderboard] ' . get_class($e) . ': ' . $e->getMessage());
        lb_fail(500, 'server_error', 'The board is unavailable.');
    }
}

final class LbHttpError extends RuntimeException
{
}

/** Emits a JSON error and ends the request. */
function lb_fail(int $status, string $error, string $message, ?string $field = null): void
{
    $body = ['error' => $error, 'message' => $message];
    if ($field !== null) {
        $body['field'] = $field;
    }
    lb_json($status, $body);
}

function lb_json(int $status, array $data): void
{
    http_response_code($status);
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

// ---------------------------------------------------------------- storage
function lb_db_path(): string
{
    $env = getenv('TYPER_LEADERBOARD_DB');
    if (is_string($env) && $env !== '') {
        return $env;
    }
    $dir = dirname(LB_DB_DEFAULT);
    if (is_dir($dir) && is_writable($dir)) {
        return LB_DB_DEFAULT;
    }
    return LB_DB_FALLBACK;
}

function lb_db(): PDO
{
    $path = lb_db_path();
    $dir = dirname($path);
    if (!is_dir($dir) && !@mkdir($dir, 0700, true) && !is_dir($dir)) {
        throw new RuntimeException("cannot create database directory $dir");
    }
    $pdo = new PDO('sqlite:' . $path, null, null, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);
    $pdo->exec('PRAGMA busy_timeout = 4000');
    $pdo->exec('PRAGMA foreign_keys = ON');
    $pdo->exec('CREATE TABLE IF NOT EXISTS scores (
        day TEXT NOT NULL, token TEXT NOT NULL, name TEXT NOT NULL, rating INTEGER NOT NULL, speed INTEGER NOT NULL,
        acc REAL NOT NULL, score INTEGER NOT NULL, sector INTEGER NOT NULL, ship TEXT NOT NULL, rank TEXT, version TEXT NOT NULL,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (day, token))');
    $pdo->exec('CREATE INDEX IF NOT EXISTS scores_day_rating ON scores (day, rating DESC, updated_at ASC)');
    $pdo->exec('CREATE TABLE IF NOT EXISTS writes (day TEXT NOT NULL, iphash TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (day, iphash))');
    $pdo->exec('CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)');
    @chmod($path, 0600);
    return $pdo;
}

/** The IP-hash salt: a 0600 file next to the database, created once; the meta table is the fallback when the directory is read-only. */
function lb_salt(PDO $pdo): string
{
    $file = lb_db_path() . '.salt';
    if (is_file($file)) {
        $s = trim((string) @file_get_contents($file));
        if (strlen($s) >= 32) {
            return $s;
        }
    }
    $row = $pdo->query("SELECT v FROM meta WHERE k = 'salt'")->fetch();
    if (is_array($row) && strlen((string) $row['v']) >= 32) {
        return (string) $row['v'];
    }
    $salt = bin2hex(random_bytes(32));
    if (@file_put_contents($file, $salt . "\n", LOCK_EX) !== false) {
        @chmod($file, 0600);
    } else {
        $st = $pdo->prepare("INSERT OR IGNORE INTO meta (k, v) VALUES ('salt', :v)");
        $st->execute([':v' => $salt]);
        $row = $pdo->query("SELECT v FROM meta WHERE k = 'salt'")->fetch();
        $salt = (string) $row['v'];
    }
    return $salt;
}

function lb_client_ip(): string
{
    $ip = (string) ($_SERVER['REMOTE_ADDR'] ?? '0.0.0.0');
    if (LB_RULES['trust_forwarded_for'] && !empty($_SERVER['HTTP_X_FORWARDED_FOR'])) {
        $first = trim(explode(',', (string) $_SERVER['HTTP_X_FORWARDED_FOR'])[0]);
        if (filter_var($first, FILTER_VALIDATE_IP) !== false) {
            $ip = $first;
        }
    }
    return $ip;
}

function lb_utc_today(): string
{
    return gmdate('Y-m-d');
}

function lb_now_ms(): int
{
    return (int) round(microtime(true) * 1000);
}

/** Retention: scores older than retention_days and IP counters from before the current UTC day (<= 24 h of hashes). */
function lb_purge(PDO $pdo): void
{
    $cut = gmdate('Y-m-d', time() - LB_RULES['retention_days'] * 86400);
    $st = $pdo->prepare('DELETE FROM scores WHERE day < :cut');
    $st->execute([':cut' => $cut]);
    $st = $pdo->prepare('DELETE FROM writes WHERE day < :today');
    $st->execute([':today' => lb_utc_today()]);
}

// ---------------------------------------------------------------- validation
function lb_is_uuid($v): bool
{
    return is_string($v) && preg_match(LB_UUID_RE, $v) === 1;
}

/** YYYY-MM-DD and a real calendar date, else null. */
function lb_parse_day($v): ?string
{
    if (!is_string($v) || preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $v, $m) !== 1) {
        return null;
    }
    if (!checkdate((int) $m[2], (int) $m[3], (int) $m[1])) {
        return null;
    }
    return $v;
}

/** The day is inside [UTC today - day_past, UTC today + day_future]. */
function lb_day_in_window(string $day): bool
{
    $today = new DateTimeImmutable(lb_utc_today() . ' 00:00:00', new DateTimeZone('UTC'));
    $d = new DateTimeImmutable($day . ' 00:00:00', new DateTimeZone('UTC'));
    $diff = (int) $today->diff($d)->format('%r%a');
    return $diff >= -LB_RULES['day_past'] && $diff <= LB_RULES['day_future'];
}

/** trim, collapse whitespace, strip control / zero-width / bidi characters, <= name_max code points, fallback. */
function lb_sanitise_name($v): string
{
    $s = is_string($v) ? $v : '';
    if ($s !== '' && preg_match('//u', $s) !== 1) {
        $s = '';   // not UTF-8
    }
    $s = (string) preg_replace('/[\x{0000}-\x{001F}\x{007F}-\x{009F}\x{200B}-\x{200F}\x{2028}-\x{202E}\x{2060}-\x{206F}\x{FEFF}]/u', '', $s);
    $s = trim((string) preg_replace('/\s+/u', ' ', $s));
    $max = (int) LB_RULES['name_max'];
    $s = (string) preg_replace('/^(.{0,' . $max . '}).*$/us', '$1', $s);
    $s = trim($s);
    return $s === '' ? LB_RULES['name_fallback'] : $s;
}

function lb_int_in($v, array $range): ?int
{
    if (is_bool($v) || !is_numeric($v)) {
        return null;
    }
    $f = (float) $v;
    if (!is_finite($f)) {
        return null;
    }
    $n = (int) round($f);
    return ($n >= $range[0] && $n <= $range[1]) ? $n : null;
}

/** Returns [clean, null] or [null, [field, message]]. */
function lb_validate(array $in): array
{
    $R = LB_RULES;
    $day = lb_parse_day($in['day'] ?? null);
    if ($day === null || !lb_day_in_window($day)) {
        return [null, ['day', 'day must be YYYY-MM-DD within a day of today (UTC)']];
    }
    if (!lb_is_uuid($in['token'] ?? null)) {
        return [null, ['token', 'token must be a UUID']];
    }
    $rating = lb_int_in($in['rating'] ?? null, $R['rating']);
    if ($rating === null) {
        return [null, ['rating', "rating must be an integer {$R['rating'][0]}..{$R['rating'][1]}"]];
    }
    $speed = lb_int_in($in['speed'] ?? null, $R['speed']);
    if ($speed === null) {
        return [null, ['speed', "speed must be an integer {$R['speed'][0]}..{$R['speed'][1]}"]];
    }
    $accRaw = $in['acc'] ?? null;
    if (is_bool($accRaw) || !is_numeric($accRaw) || !is_finite((float) $accRaw)) {
        return [null, ['acc', 'acc must be a number 0..100']];
    }
    $acc = round((float) $accRaw, 2);
    if ($acc < $R['acc'][0] || $acc > $R['acc'][1]) {
        return [null, ['acc', 'acc must be a number 0..100']];
    }
    $score = lb_int_in($in['score'] ?? null, $R['score']);
    if ($score === null) {
        return [null, ['score', "score must be an integer {$R['score'][0]}..{$R['score'][1]}"]];
    }
    $sector = lb_int_in($in['sector'] ?? null, $R['sector']);
    if ($sector === null) {
        return [null, ['sector', 'sector must be 1..10']];
    }
    $ship = $in['ship'] ?? null;
    if (!is_string($ship) || !in_array($ship, $R['ships'], true)) {
        return [null, ['ship', 'unknown ship']];
    }
    $rank = $in['rank'] ?? null;
    if ($rank !== null && (!is_string($rank) || !in_array($rank, $R['ranks'], true))) {
        return [null, ['rank', 'rank must be S, A, B, C, D or null']];
    }
    $expected = (int) round($speed * pow($acc / 100, 2));
    if (abs($rating - $expected) > $R['rating_tolerance']) {
        return [null, ['rating', 'rating does not match speed and accuracy']];
    }
    $version = $in['version'] ?? '';
    $version = is_string($version) ? (string) preg_replace('/[^A-Za-z0-9._-]/', '', $version) : '';
    $version = substr($version, 0, (int) $R['version_max']);
    return [[
        'day' => $day, 'token' => strtolower((string) $in['token']), 'name' => lb_sanitise_name($in['name'] ?? ''),
        'rating' => $rating, 'speed' => $speed, 'acc' => $acc, 'score' => $score, 'sector' => $sector, 'ship' => $ship,
        'rank' => $rank, 'version' => $version,
    ], null];
}

// ---------------------------------------------------------------- GET
function lb_get(PDO $pdo): void
{
    $day = isset($_GET['day']) ? lb_parse_day($_GET['day']) : lb_utc_today();
    if ($day === null) {
        lb_fail(400, 'invalid', 'day must be YYYY-MM-DD', 'day');
    }
    $token = (isset($_GET['token']) && lb_is_uuid($_GET['token'])) ? strtolower((string) $_GET['token']) : null;
    $top = lb_int_in($_GET['top'] ?? LB_RULES['top_default'], [1, LB_RULES['top_max']]) ?? LB_RULES['top_default'];
    lb_json(200, lb_board($pdo, $day, $token, $top));
}

function lb_board(PDO $pdo, string $day, ?string $token, int $top): array
{
    $st = $pdo->prepare('SELECT name, rating, speed, acc, sector, ship FROM scores WHERE day = :day ORDER BY rating DESC, updated_at ASC, rowid ASC LIMIT :top');
    $st->bindValue(':day', $day, PDO::PARAM_STR);
    $st->bindValue(':top', $top, PDO::PARAM_INT);
    $st->execute();
    $rows = [];
    foreach ($st->fetchAll() as $r) {
        $rows[] = [
            'name' => (string) $r['name'], 'rating' => (int) $r['rating'], 'speed' => (int) $r['speed'],
            'acc' => round((float) $r['acc'], 2), 'sector' => (int) $r['sector'], 'ship' => (string) $r['ship'],
        ];
    }
    $c = $pdo->prepare('SELECT COUNT(*) AS n FROM scores WHERE day = :day');
    $c->execute([':day' => $day]);
    $total = (int) $c->fetch()['n'];
    $you = null;
    if ($token !== null) {
        $you = lb_you($pdo, $day, $token);
    }
    return ['day' => $day, 'total' => $total, 'top' => $rows, 'you' => $you];
}

/** {rank, rating} for a token on a day, or null. Ties: the earlier best wins. */
function lb_you(PDO $pdo, string $day, string $token): ?array
{
    $st = $pdo->prepare('SELECT rowid AS rid, rating, updated_at FROM scores WHERE day = :day AND token = :token');
    $st->execute([':day' => $day, ':token' => $token]);
    $me = $st->fetch();
    if (!is_array($me)) {
        return null;
    }
    $st = $pdo->prepare('SELECT COUNT(*) AS n FROM scores WHERE day = :day AND (rating > :r OR (rating = :r AND updated_at < :t) OR (rating = :r AND updated_at = :t AND rowid < :rid))');
    $st->execute([':day' => $day, ':r' => (int) $me['rating'], ':t' => (int) $me['updated_at'], ':rid' => (int) $me['rid']]);
    return ['rank' => 1 + (int) $st->fetch()['n'], 'rating' => (int) $me['rating']];
}

// ---------------------------------------------------------------- POST
function lb_post(PDO $pdo): void
{
    if (LB_RULES['require_same_origin'] && strtolower((string) ($_SERVER['HTTP_SEC_FETCH_SITE'] ?? '')) === 'cross-site') {
        lb_fail(403, 'cross_origin', 'The board only accepts results from its own site.');
    }
    $ct = strtolower(trim(explode(';', (string) ($_SERVER['CONTENT_TYPE'] ?? $_SERVER['HTTP_CONTENT_TYPE'] ?? ''))[0]));
    if ($ct !== 'application/json') {
        lb_fail(415, 'unsupported_media_type', 'Send application/json.');
    }
    $max = (int) LB_RULES['body_max'];
    if ((int) ($_SERVER['CONTENT_LENGTH'] ?? 0) > $max) {
        lb_fail(413, 'payload_too_large', "The body must be at most $max bytes.");
    }
    $raw = (string) file_get_contents('php://input', false, null, 0, $max + 1);
    if (strlen($raw) > $max) {
        lb_fail(413, 'payload_too_large', "The body must be at most $max bytes.");
    }

    // Every POST attempt counts against the per-IP limit, valid or not (its own short transaction).
    $salt = lb_salt($pdo);
    $ipHash = substr(hash('sha256', $salt . '|' . lb_client_ip()), 0, 32);
    $today = lb_utc_today();
    $pdo->exec('BEGIN IMMEDIATE');
    try {
        lb_purge($pdo);
        $st = $pdo->prepare('INSERT INTO writes (day, iphash, n) VALUES (:day, :h, 1) ON CONFLICT(day, iphash) DO UPDATE SET n = n + 1');
        $st->execute([':day' => $today, ':h' => $ipHash]);
        $st = $pdo->prepare('SELECT n FROM writes WHERE day = :day AND iphash = :h');
        $st->execute([':day' => $today, ':h' => $ipHash]);
        $n = (int) $st->fetch()['n'];
        $pdo->exec('COMMIT');
    } catch (Throwable $e) {
        $pdo->exec('ROLLBACK');
        throw $e;
    }
    if ($n > (int) LB_RULES['writes_per_ip_per_day']) {
        header('Retry-After: 3600');
        lb_fail(429, 'rate_limited', 'Too many submissions from this address today.');
    }

    $in = json_decode($raw, true);
    if (!is_array($in)) {
        lb_fail(400, 'bad_json', 'The body must be a JSON object.');
    }
    [$clean, $err] = lb_validate($in);
    if ($err !== null) {
        lb_fail(400, 'invalid', $err[1], $err[0]);
    }

    $now = lb_now_ms();
    $pdo->exec('BEGIN IMMEDIATE');
    try {
        $st = $pdo->prepare('SELECT rating FROM scores WHERE day = :day AND token = :token');
        $st->execute([':day' => $clean['day'], ':token' => $clean['token']]);
        $cur = $st->fetch();
        $improved = false;
        if (!is_array($cur)) {
            $st = $pdo->prepare('INSERT INTO scores (day, token, name, rating, speed, acc, score, sector, ship, rank, version, created_at, updated_at)
                VALUES (:day, :token, :name, :rating, :speed, :acc, :score, :sector, :ship, :rank, :version, :now, :now)');
            $st->execute([
                ':day' => $clean['day'], ':token' => $clean['token'], ':name' => $clean['name'], ':rating' => $clean['rating'], ':speed' => $clean['speed'],
                ':acc' => $clean['acc'], ':score' => $clean['score'], ':sector' => $clean['sector'], ':ship' => $clean['ship'], ':rank' => $clean['rank'],
                ':version' => $clean['version'], ':now' => $now,
            ]);
            $improved = true;
        } elseif ($clean['rating'] > (int) $cur['rating']) {
            $st = $pdo->prepare('UPDATE scores SET name = :name, rating = :rating, speed = :speed, acc = :acc, score = :score, sector = :sector, ship = :ship,
                rank = :rank, version = :version, updated_at = :now WHERE day = :day AND token = :token');
            $st->execute([
                ':name' => $clean['name'], ':rating' => $clean['rating'], ':speed' => $clean['speed'], ':acc' => $clean['acc'], ':score' => $clean['score'],
                ':sector' => $clean['sector'], ':ship' => $clean['ship'], ':rank' => $clean['rank'], ':version' => $clean['version'], ':now' => $now,
                ':day' => $clean['day'], ':token' => $clean['token'],
            ]);
            $improved = true;
        }
        $you = lb_you($pdo, $clean['day'], $clean['token']);
        $c = $pdo->prepare('SELECT COUNT(*) AS n FROM scores WHERE day = :day');
        $c->execute([':day' => $clean['day']]);
        $total = (int) $c->fetch()['n'];
        $pdo->exec('COMMIT');
    } catch (Throwable $e) {
        $pdo->exec('ROLLBACK');
        throw $e;
    }
    lb_json(200, ['day' => $clean['day'], 'rank' => $you ? $you['rank'] : 1, 'total' => $total, 'rating' => $you ? $you['rating'] : $clean['rating'], 'improved' => $improved]);
}
