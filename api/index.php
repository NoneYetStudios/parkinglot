<?php
/**
 * Parking Lot - Native PHP + SQLite Global Leaderboard API
 * Designed for zero-config deployment on JetHost / cPanel / Apache / LiteSpeed shared hosting.
 * Matches the Node.js API specification exactly.
 */

error_reporting(0);
ini_set('display_errors', '0');

// CORS & JSON headers
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

function jsonResponse($data, $statusCode = 200) {
    http_response_code($statusCode);
    echo json_encode($data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

function jsonError($message, $code = 'error', $statusCode = 400) {
    http_response_code($statusCode);
    echo json_encode([
        'ok' => false,
        'error' => [
            'code' => $code,
            'message' => $message
        ]
    ], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

// -----------------------------------------------------------------------------
// Database Connection & Initialization
// -----------------------------------------------------------------------------
$dataDir = __DIR__ . '/../data';
if (!is_dir($dataDir)) {
    @mkdir($dataDir, 0755, true);
    @file_put_contents($dataDir . '/.htaccess', "Deny from all\n");
}

$dbPath = is_writable($dataDir) ? ($dataDir . '/leaderboard.sqlite') : (__DIR__ . '/leaderboard.sqlite');

try {
    $pdo = new PDO('sqlite:' . $dbPath);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);

    $pdo->exec('PRAGMA foreign_keys = ON;');
    $pdo->exec('PRAGMA busy_timeout = 5000;');
    @$pdo->exec('PRAGMA journal_mode = WAL;');

    // Initialize Schema
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS scores (
            id                    INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id            TEXT    NOT NULL UNIQUE,
            nickname              TEXT    NOT NULL CHECK (length(nickname) BETWEEN 1 AND 64),
            score                 INTEGER NOT NULL CHECK (score BETWEEN 50 AND 100000),
            lot_id                TEXT    NOT NULL,
            modifiers             TEXT    NOT NULL,
            difficulty_multiplier REAL    NOT NULL CHECK (difficulty_multiplier > 0),
            elapsed_seconds       INTEGER NOT NULL,
            created_at            INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_scores_rank ON scores (score DESC, created_at ASC, id ASC);
        CREATE INDEX IF NOT EXISTS idx_scores_lot_rank ON scores (lot_id, score DESC, created_at ASC, id ASC);
        CREATE INDEX IF NOT EXISTS idx_scores_mods_rank ON scores (modifiers, score DESC, created_at ASC, id ASC);
        CREATE INDEX IF NOT EXISTS idx_scores_lot_mods_rank ON scores (lot_id, modifiers, score DESC, created_at ASC, id ASC);
    ");

    // Seed initial records if table is empty
    $count = (int)$pdo->query("SELECT COUNT(*) FROM scores")->fetchColumn();
    if ($count === 0) {
        $now = time() * 1000;
        $seeds = [
            ['seed_1', 'TheGooseWhisperer', 2880, 'dollar', 'goose', 1.35, 12, $now - 86400000 * 3],
            ['seed_2', 'FrontRowRoyalty', 2750, 'strip', 'carts,goose', 1.95, 18, $now - 86400000 * 2],
            ['seed_3', 'ParallelParkPro', 2640, 'mall', 'badParkers', 2.05, 24, $now - 86400000 * 2],
            ['seed_4', 'AsphaltExplorer', 2510, 'stadium', 'standard', 2.25, 32, $now - 86400000],
            ['seed_5', 'DollarStoreLegend', 2420, 'dollar', 'carts', 1.25, 14, $now - 43200000],
            ['seed_6', 'CartDodger99', 2310, 'strip', 'standard', 1.35, 19, $now - 21600000],
            ['seed_7', 'SuburbanSpeedster', 2180, 'dollar', 'standard', 1.00, 11, $now - 3600000]
        ];
        $seedStmt = $pdo->prepare("
            INSERT OR IGNORE INTO scores (session_id, nickname, score, lot_id, modifiers, difficulty_multiplier, elapsed_seconds, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ");
        foreach ($seeds as $s) {
            $seedStmt->execute($s);
        }
    }
} catch (Exception $e) {
    jsonError('Database connection failed: ' . $e->getMessage(), 'db_error', 500);
}

// -----------------------------------------------------------------------------
// Secret Key for HMAC Sessions
// -----------------------------------------------------------------------------
$secretFile = $dataDir . '/secret.key';
if (file_exists($secretFile)) {
    $secret = trim(@file_get_contents($secretFile));
} else {
    $secret = bin2hex(random_bytes(32));
    @file_put_contents($secretFile, $secret);
}

function base64UrlEncode($data) {
    return strtr(rtrim(base64_encode($data), '='), '+/', '-_');
}

function base64UrlDecode($data) {
    return base64_decode(strtr($data, '-_', '+/'));
}

// -----------------------------------------------------------------------------
// Game Rules & Formula Helpers
// -----------------------------------------------------------------------------
$LOTS = [
    'dollar'  => ['baseDifficulty' => 1.00, 'parTime' => 40,  'fastTime' => 14],
    'strip'   => ['baseDifficulty' => 1.35, 'parTime' => 70,  'fastTime' => 20],
    'mall'    => ['baseDifficulty' => 1.75, 'parTime' => 110, 'fastTime' => 26],
    'stadium' => ['baseDifficulty' => 2.25, 'parTime' => 150, 'fastTime' => 35]
];

$MOD_BONUS = [
    'carts'      => 0.25,
    'badParkers' => 0.30,
    'goose'      => 0.35
];

$QUALITY_MULT = [
    'PREMIUM'            => 1.65,
    'EXCELLENT'          => 1.35,
    'ACCEPTABLE'         => 1.05,
    'TECHNICALLY_LEGAL'  => 0.80,
    'DEEPLY_UNFORTUNATE' => 0.55
];

$OUTCOMES = [
    'CLEAN'           => ['penalty' => 0,   'deductible' => 0],
    'AWKWARD'         => ['penalty' => 35,  'deductible' => 0],
    'CART_COLLISION'  => ['penalty' => 160, 'deductible' => 100],
    'FENDER_BENDER'   => ['penalty' => 240, 'deductible' => 200],
    'SERIOUS_MISHAP'  => ['penalty' => 380, 'deductible' => 300]
];

function canonicalModifiers($mods) {
    global $MOD_BONUS;
    if (!is_array($mods)) return null;
    $valid = array_keys($MOD_BONUS);
    $seen = [];
    foreach ($mods as $m) {
        if (!in_array($m, $valid, true) || in_array($m, $seen, true)) return null;
        $seen[] = $m;
    }
    sort($seen);
    return implode(',', $seen);
}

function recomputeFinalScore($lotId, $mods, $qualityId, $outcomeId, $unlocatedHazards, $elapsedSeconds) {
    global $LOTS, $MOD_BONUS, $QUALITY_MULT, $OUTCOMES;
    if (!isset($LOTS[$lotId]) || !isset($QUALITY_MULT[$qualityId]) || !isset($OUTCOMES[$outcomeId])) return null;
    if (!is_int($elapsedSeconds) || $elapsedSeconds < 0 || $elapsedSeconds > 7200) return null;
    if (!is_int($unlocatedHazards) || $unlocatedHazards < 0 || $unlocatedHazards > 8) return null;
    if ($unlocatedHazards > 0 && $outcomeId !== 'AWKWARD') return null;

    $lot = $LOTS[$lotId];
    $modBonus = 0.0;
    foreach ($mods as $m) {
        if (isset($MOD_BONUS[$m])) $modBonus += $MOD_BONUS[$m];
    }
    $diffMult = round(($lot['baseDifficulty'] + $modBonus) * 100) / 100;

    // Time efficiency
    $fastTime = $lot['fastTime'];
    $parTime  = $lot['parTime'];
    $slowCap  = $parTime * 2.5;
    $t = max(0, $elapsedSeconds);

    if ($t <= $fastTime) {
        $timeMult = 1.35;
    } elseif ($t <= $parTime) {
        $ratio = ($t - $fastTime) / max(1, $parTime - $fastTime);
        $timeMult = 1.35 - $ratio * 0.35;
    } elseif ($t <= $slowCap) {
        $ratio = ($t - $parTime) / max(1, $slowCap - $parTime);
        $timeMult = 1.00 - $ratio * 0.45;
    } else {
        $timeMult = 0.55;
    }
    $timeMult = round($timeMult * 100) / 100;

    $base = 1000;
    $gross = (int)round($base * $QUALITY_MULT[$qualityId] * $diffMult * $timeMult);
    $outcome = $OUTCOMES[$outcomeId];
    $penalty = $outcome['penalty'] + ($outcomeId === 'AWKWARD' ? $unlocatedHazards * 160 : 0);
    $deductible = $outcome['deductible'];

    return [
        'finalScore' => max(50, $gross - $penalty - $deductible),
        'difficultyMultiplier' => $diffMult
    ];
}

// -----------------------------------------------------------------------------
// Route Parsing
// -----------------------------------------------------------------------------
$uri = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$method = $_SERVER['REQUEST_METHOD'];

// Trim leading /api or /parkinglot/api or script path
$path = preg_replace('#^.*?/api/?#i', '', $uri);
$path = trim($path, '/');

// -----------------------------------------------------------------------------
// Endpoint 1: GET /api/health
// -----------------------------------------------------------------------------
if ($path === 'health' || $path === '') {
    jsonResponse(['ok' => true, 'service' => 'ParkingLot Leaderboard API (PHP)', 'version' => '1.1.0']);
}

// -----------------------------------------------------------------------------
// Endpoint 2: POST /api/sessions
// -----------------------------------------------------------------------------
if ($path === 'sessions' && $method === 'POST') {
    $raw = file_get_contents('php://input');
    $body = json_decode($raw, true);

    if (!is_array($body) || empty($body['lotId']) || !isset($LOTS[$body['lotId']])) {
        jsonError('Unsupported lot type', 'invalid_lot', 400);
    }
    $modsKey = canonicalModifiers($body['modifiers'] ?? []);
    if ($modsKey === null) {
        jsonError('Unsupported or duplicate modifier selection', 'invalid_modifiers', 400);
    }

    $nowMs = (int)round(microtime(true) * 1000);
    $payload = [
        'v' => 1,
        'n' => bin2hex(random_bytes(16)),
        'l' => $body['lotId'],
        'm' => $modsKey,
        't' => $nowMs
    ];
    $payloadJson = json_encode($payload);
    $b64Body = base64UrlEncode($payloadJson);
    $sig = hash_hmac('sha256', $b64Body, $secret, true);
    $token = $b64Body . '.' . base64UrlEncode($sig);

    jsonResponse([
        'token' => $token,
        'expiresAt' => $nowMs + (3 * 3600 * 1000)
    ]);
}

// -----------------------------------------------------------------------------
// Endpoint 3: POST /api/scores
// -----------------------------------------------------------------------------
if ($path === 'scores' && $method === 'POST') {
    $raw = file_get_contents('php://input');
    $body = json_decode($raw, true);

    if (!is_array($body)) {
        jsonError('Malformed JSON payload', 'invalid_json', 400);
    }

    $token = $body['token'] ?? '';
    if (!is_string($token) || strlen($token) > 500 || !str_contains($token, '.')) {
        jsonError('Session token is missing or forged.', 'invalid_token', 401);
    }
    [$b64Body, $b64Sig] = explode('.', $token, 2);
    $expectedSig = hash_hmac('sha256', $b64Body, $secret, true);
    if (!hash_equals(base64UrlDecode($b64Sig), $expectedSig)) {
        jsonError('Session token signature is invalid.', 'invalid_token', 401);
    }

    $sess = json_decode(base64UrlDecode($b64Body), true);
    if (!is_array($sess) || ($sess['v'] ?? 0) !== 1) {
        jsonError('Session token payload is invalid.', 'invalid_token', 401);
    }

    $nowMs = (int)round(microtime(true) * 1000);
    if ($nowMs - $sess['t'] > (3 * 3600 * 1000)) {
        jsonError('Session token has expired.', 'token_expired', 401);
    }

    $lotId = $body['lotId'] ?? '';
    $mods = $body['modifiers'] ?? [];
    $modsKey = canonicalModifiers($mods);
    if ($modsKey === null || $sess['l'] !== $lotId || $sess['m'] !== $modsKey) {
        jsonError('Session does not match claimed lot or modifiers.', 'token_mismatch', 400);
    }

    $nickname = trim($body['nickname'] ?? '');
    if (strlen($nickname) < 1 || strlen($nickname) > 16 || preg_match('/[<>&"\';]/', $nickname)) {
        jsonError('Nickname must be between 1 and 16 characters and contain no special symbols.', 'invalid_nickname', 422);
    }

    $qualityId = $body['qualityId'] ?? '';
    $outcomeId = $body['outcomeId'] ?? '';
    $unlocated = (int)($body['unlocatedHazards'] ?? 0);
    $elapsed = (int)($body['elapsedSeconds'] ?? 0);

    // Wall-clock duration check
    $wallMs = $nowMs - $sess['t'];
    if ($wallMs < 2000 || ($elapsed * 1000) > ($wallMs + 5000)) {
        jsonError('Timing validation failed.', 'invalid_timing', 400);
    }

    $calc = recomputeFinalScore($lotId, $mods, $qualityId, $outcomeId, $unlocated, $elapsed);
    if ($calc === null || $calc['finalScore'] !== (int)($body['score'] ?? 0)) {
        jsonError('Submitted score does not match official calculation rules.', 'score_mismatch', 422);
    }

    $sessionId = $sess['n'];

    try {
        $insertStmt = $pdo->prepare("
            INSERT INTO scores (session_id, nickname, score, lot_id, modifiers, difficulty_multiplier, elapsed_seconds, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ");
        $insertStmt->execute([
            $sessionId,
            $nickname,
            $calc['finalScore'],
            $lotId,
            $modsKey,
            $calc['difficultyMultiplier'],
            $elapsed,
            $nowMs
        ]);
        $rowId = (int)$pdo->lastInsertId();
    } catch (PDOException $e) {
        if (str_contains($e->getMessage(), 'UNIQUE') || str_contains($e->getMessage(), 'session_id')) {
            jsonError('This game session has already been submitted.', 'duplicate', 409);
        }
        jsonError('Could not save score: ' . $e->getMessage(), 'db_error', 500);
    }

    // Rank Calculation
    $rankCond = '(score > ? OR (score = ? AND created_at < ?) OR (score = ? AND created_at = ? AND id < ?))';

    $stmtGlobal = $pdo->prepare("SELECT COUNT(*) FROM scores WHERE $rankCond");
    $stmtGlobal->execute([$calc['finalScore'], $calc['finalScore'], $nowMs, $calc['finalScore'], $nowMs, $rowId]);
    $globalRank = (int)$stmtGlobal->fetchColumn() + 1;

    $stmtLot = $pdo->prepare("SELECT COUNT(*) FROM scores WHERE lot_id = ? AND $rankCond");
    $stmtLot->execute([$lotId, $calc['finalScore'], $calc['finalScore'], $nowMs, $calc['finalScore'], $nowMs, $rowId]);
    $lotRank = (int)$stmtLot->fetchColumn() + 1;

    $stmtCat = $pdo->prepare("SELECT COUNT(*) FROM scores WHERE lot_id = ? AND modifiers = ? AND $rankCond");
    $stmtCat->execute([$lotId, $modsKey, $calc['finalScore'], $calc['finalScore'], $nowMs, $calc['finalScore'], $nowMs, $rowId]);
    $catRank = (int)$stmtCat->fetchColumn() + 1;

    jsonResponse([
        'entry' => [
            'nickname' => $nickname,
            'score' => $calc['finalScore'],
            'lotId' => $lotId,
            'modifiers' => $modsKey === '' ? [] : explode(',', $modsKey),
            'difficultyMultiplier' => $calc['difficultyMultiplier'],
            'elapsedSeconds' => $elapsed,
            'createdAt' => $nowMs
        ],
        'ranks' => [
            'global' => $globalRank,
            'lot' => $lotRank,
            'category' => $catRank
        ]
    ], 201);
}

// -----------------------------------------------------------------------------
// Endpoint 4: GET /api/leaderboard
// -----------------------------------------------------------------------------
if ($path === 'leaderboard' && $method === 'GET') {
    $lot = $_GET['lot'] ?? 'all';
    $mods = $_GET['mods'] ?? 'all';
    $limit = max(1, min(50, (int)($_GET['limit'] ?? 25)));
    $offset = max(0, min(10000, (int)($_GET['offset'] ?? 0)));

    $where = [];
    $params = [];

    if ($lot !== 'all' && isset($LOTS[$lot])) {
        $where[] = 'lot_id = ?';
        $params[] = $lot;
    }

    if ($mods !== 'all') {
        if ($mods === 'standard') {
            $where[] = "modifiers = ''";
        } elseif ($mods === 'any_mods') {
            $where[] = "modifiers != ''";
        } else {
            $canonical = canonicalModifiers(explode(',', $mods));
            if ($canonical !== null) {
                $where[] = 'modifiers = ?';
                $params[] = $canonical;
            }
        }
    }

    $whereClause = count($where) > 0 ? ('WHERE ' . implode(' AND ', $where)) : '';

    $countStmt = $pdo->prepare("SELECT COUNT(*) FROM scores $whereClause");
    $countStmt->execute($params);
    $total = (int)$countStmt->fetchColumn();

    $query = "SELECT * FROM scores $whereClause ORDER BY score DESC, created_at ASC, id ASC LIMIT ? OFFSET ?";
    $paramsWithLimit = array_merge($params, [$limit, $offset]);
    $listStmt = $pdo->prepare($query);
    $listStmt->execute($paramsWithLimit);
    $rows = $listStmt->fetchAll();

    $entries = [];
    foreach ($rows as $i => $r) {
        $entries[] = [
            'rank' => $offset + $i + 1,
            'nickname' => $r['nickname'],
            'score' => (int)$r['score'],
            'lotId' => $r['lot_id'],
            'modifiers' => $r['modifiers'] === '' ? [] : explode(',', $r['modifiers']),
            'difficultyMultiplier' => (float)$r['difficulty_multiplier'],
            'elapsedSeconds' => (int)$r['elapsed_seconds'],
            'createdAt' => (int)$r['created_at']
        ];
    }

    jsonResponse([
        'entries' => $entries,
        'total' => $total,
        'page' => (int)floor($offset / $limit) + 1,
        'pageSize' => $limit,
        'filter' => [
            'lot' => $lot,
            'mods' => $mods
        ]
    ]);
}

// Fallback 404
jsonError('Unknown API endpoint', 'not_found', 404);
