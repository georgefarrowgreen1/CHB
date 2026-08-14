<?php
// ============================================================
//  test-stub-arity.php — dev/CI only, never deployed.
//
//      php test-stub-arity.php
//
//  WHY THIS EXISTS. Several gates stub the app's own helpers so a pure composer
//  can be driven with no database and no SMTP. Those stubs never load beside the
//  real definitions at RUNTIME — but PHPStan analyses the whole set as ONE
//  program, so it picks a single declaration per function name, and if it picks a
//  stub whose signature is narrower than the real one then every legitimate call
//  site in the app becomes an `arguments.count` error.
//
//  Measured: `function log_activity() {}` in test-emails-render.php turned 95
//  correct four-argument calls across the app into CI failures, while every test
//  and every browser suite stayed green. It was the THIRD time this file had done
//  it (rate_limit and occupancy_limits before it), and each time the only gate
//  that could see it was PHPStan — which has no local runner here, so it is found
//  after a push rather than before one.
//
//  So this check answers the same question cheaply and locally: a stub may be
//  WIDER than the real signature (extra optional parameters are harmless — a
//  caller passing fewer still type-checks) but never NARROWER, and its required
//  count may never exceed the real one either.
// ============================================================
declare(strict_types=1);

$dir = __DIR__;
$fails = 0;
$checks = 0;
function ok(bool $cond, string $msg): void
{
    global $fails, $checks;
    $checks++;
    echo ($cond ? '  ✓ ' : '  ✗ ') . $msg . "\n";
    if (!$cond) {
        $fails++;
    }
}

/**
 * Every top-level function declaration in a file, as name => [total, required].
 * Deliberately a REGEX over the source rather than a reflection load: requiring
 * these files would run them (they are gates and endpoints), and a parameter list
 * is a shape a regex reads reliably at this level.
 *
 * @return array<string, array{int, int}>
 */
function stub_arity_decls(string $path): array
{
    $src = (string) file_get_contents($path);
    // Strip line comments so a commented-out declaration is not counted.
    $src = (string) preg_replace('~^\s*//.*$~m', '', $src);
    $out = [];
    if (!preg_match_all('~^\s*function\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(([^)]*)\)~m', $src, $m, PREG_SET_ORDER)) {
        return $out;
    }
    foreach ($m as $hit) {
        $name = $hit[1];
        $args = trim($hit[2]);
        if ($args === '') {
            $out[$name] = [0, 0];
            continue;
        }
        // Drop empties: a TRAILING COMMA is legal in a PHP parameter list and
        // mailer.php's smtp_send uses one, which the first version of this counted
        // as a tenth parameter and reported a correct 9-arg stub as narrower.
        $parts = array_values(array_filter(array_map('trim', explode(',', $args)), static function (string $p): bool {
            return $p !== '';
        }));
        $total = count($parts);
        $required = 0;
        foreach ($parts as $p) {
            // A default or a variadic makes it optional. Required ones must come
            // first in PHP, so counting them is enough.
            if (strpos($p, '=') !== false || strpos($p, '...') !== false) {
                break;
            }
            $required++;
        }
        $out[$name] = [$total, $required];
    }
    return $out;
}

// The REAL definitions: every deployed PHP file. Anything a stub shadows has to
// be measured against these.
$real = [];
$realWhere = [];
foreach (glob($dir . '/*.php') ?: [] as $path) {
    $base = basename($path);
    if (strpos($base, 'test-') === 0) {
        continue;
    }
    foreach (stub_arity_decls($path) as $name => $arity) {
        // First definition wins, and a duplicate among deployed files is its own
        // problem that PHPStan reports directly.
        if (!isset($real[$name])) {
            $real[$name] = $arity;
            $realWhere[$name] = $base;
        }
    }
}
ok(count($real) > 200, 'read the real signatures out of the deployed files (' . count($real) . ' functions)');

$stubFiles = array_values(array_filter(glob($dir . '/test-*.php') ?: [], static function (string $p): bool {
    return basename($p) !== 'test-stub-arity.php';
}));
ok(count($stubFiles) > 10, 'and found the gates that stub them (' . count($stubFiles) . ' files)');

$shadowed = 0;
$bad = [];
foreach ($stubFiles as $path) {
    $base = basename($path);
    foreach (stub_arity_decls($path) as $name => $arity) {
        if (!isset($real[$name])) {
            continue; // a helper of the gate's own, not a stub of anything
        }
        $shadowed++;
        [$sTotal, $sReq] = $arity;
        [$rTotal, $rReq] = $real[$name];
        // NARROWER is the failure: fewer parameters accepted than real callers
        // pass, or more of them required than the real signature requires.
        if ($sTotal < $rTotal) {
            $bad[] = "$base: $name() takes $sTotal where {$realWhere[$name]}'s takes $rTotal — every real call with more arguments becomes an arguments.count error";
        } elseif ($sReq > $rReq) {
            $bad[] = "$base: $name() requires $sReq where {$realWhere[$name]}'s requires $rReq — real calls with fewer arguments become an arguments.count error";
        }
    }
}
// Vacuity guard, the house rule: if nothing is shadowed the sweep proves nothing.
ok($shadowed > 30, "the gates really do shadow the app's helpers ($shadowed declarations)");
ok($bad === [], 'no stub is NARROWER than the signature it shadows' . ($bad ? ":\n      - " . implode("\n      - ", $bad) : ''));

echo "\n== Summary ==\n";
echo $fails ? "  $fails STUB-ARITY CHECK(S) FAILED ❌\n" : "  ALL $checks STUB-ARITY CHECKS PASSED ✅\n";
exit($fails ? 1 : 0);
