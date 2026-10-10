<?php
// ============================================================
//  test-requires.php — every function a request can reach is LOADED by it.
//  DEV/CI only, deploy-excluded with the other test-*.php.
//
//      php test-requires.php
//
//  photos.php called get_rate() without requiring pricing.php, so every guest photo
//  upload died with "Something went wrong on our side" — and nothing could see it:
//  PHPStan analyses every file as ONE set (the function exists somewhere), `php -l`
//  never resolves a call, and only the paths a suite exercises are ever run.
//
//  For each PHP file run as a request, this follows the code that can execute — the
//  file's own top level and the top level of everything it requires, then every app
//  function those reach — and fails on a call to a function that is neither PHP's
//  own nor defined in a file that request loads. Requires are read statically
//  (`require … __DIR__ . '/x.php'`), conditional ones counted as loaded, so it can
//  miss a require that never runs but never cries wolf about one that does.
// ============================================================

$dir = __DIR__;
$fails = 0;
function rqc($name, $cond, $extra = '')
{
    global $fails;
    if ($cond) {
        echo "  \xE2\x9C\x93 $name\n";
    } else {
        $fails++;
        echo "  \xE2\x9C\x97 $name" . ($extra !== '' ? " — $extra" : '') . "\n";
    }
}

// ---- Parse one file: its requires, its global functions (each with the calls in
// its body), the calls made by its top-level code, and the names it guards with
// function_exists() / is_callable().
/** @return array{requires: string[], functions: array<string, string[]>, top: string[], guarded: string[]} */
function rq_parse(string $src): array
{
    $toks = token_get_all($src);
    $sig = [];
    foreach ($toks as $t) {
        if (is_array($t) && in_array($t[0], [T_WHITESPACE, T_COMMENT, T_DOC_COMMENT, T_OPEN_TAG, T_CLOSE_TAG, T_INLINE_HTML], true)) {
            continue;
        }
        $sig[] = $t;
    }
    $requires = [];
    $functions = [];
    $top = [];
    $guarded = [];
    $depth = 0;           // brace depth
    $fnStack = [];        // [name, depth at its body's opening brace]
    $classDepth = null;   // depth at which a class body opened (its methods are not global functions)
    $pendingFn = null;    // a named global function whose body has not opened yet
    $pendingClass = false;
    $n = count($sig);
    $tname = fn($t) => is_array($t) ? $t[0] : $t;
    for ($i = 0; $i < $n; $i++) {
        $t = $sig[$i];
        $id = $tname($t);
        if ($id === T_REQUIRE || $id === T_REQUIRE_ONCE || $id === T_INCLUDE || $id === T_INCLUDE_ONCE) {
            // require[_once] (__DIR__ . '/x.php')
            for ($k = $i + 1; $k < min($n, $i + 6); $k++) {
                if ($tname($sig[$k]) === T_CONSTANT_ENCAPSED_STRING) {
                    $lit = trim($sig[$k][1], "'\"");
                    if (preg_match('~^/?([A-Za-z0-9_.-]+\.php)$~', $lit, $m)) {
                        $requires[] = $m[1];
                    }
                    break;
                }
                if ($tname($sig[$k]) === ';') {
                    break;
                }
            }
            continue;
        }
        if ($id === T_CLASS || $id === T_TRAIT || $id === T_INTERFACE || (defined('T_ENUM') && $id === T_ENUM)) {
            // `::class` and `new class` are not declarations of a named class body we track separately — both still open a body we must not read as global functions.
            if ($i > 0 && $tname($sig[$i - 1]) === T_DOUBLE_COLON) {
                continue;
            }
            if ($classDepth === null) {
                $pendingClass = true;
            }
            continue;
        }
        if ($id === T_FUNCTION) {
            $next = $sig[$i + 1] ?? null;
            if ($tname($next) === '&') {
                $next = $sig[$i + 2] ?? null;
            }
            if ($tname($next) === T_STRING && $classDepth === null) {
                $pendingFn = strtolower($next[1]);
            }
            continue;
        }
        if ($id === '{' || $id === T_CURLY_OPEN || $id === T_DOLLAR_OPEN_CURLY_BRACES) {
            $depth++;
            if ($pendingClass) {
                $classDepth = $depth;
                $pendingClass = false;
            } elseif ($pendingFn !== null) {
                $fnStack[] = [$pendingFn, $depth];
                $functions[$pendingFn] = $functions[$pendingFn] ?? [];
                $pendingFn = null;
            }
            continue;
        }
        if ($id === '}') {
            if ($fnStack && end($fnStack)[1] === $depth) {
                array_pop($fnStack);
            }
            if ($classDepth !== null && $classDepth === $depth) {
                $classDepth = null;
            }
            $depth--;
            continue;
        }
        if ($id === ';' && $pendingFn !== null) {
            $pendingFn = null; // an abstract / interface signature
            continue;
        }
        // A call: a bare name followed by "(" that is not a method, a static call,
        // a declaration or a class being made.
        $name = null;
        if ($id === T_STRING) {
            $name = $t[1];
        } elseif (defined('T_NAME_FULLY_QUALIFIED') && $id === T_NAME_FULLY_QUALIFIED && substr_count($t[1], '\\') === 1) {
            $name = ltrim($t[1], '\\');
        }
        if ($name !== null && $tname($sig[$i + 1] ?? null) === '(') {
            $prev = $tname($sig[$i - 1] ?? null);
            $skip = [T_OBJECT_OPERATOR, T_DOUBLE_COLON, T_FUNCTION, T_NEW, T_CONST];
            if (defined('T_NULLSAFE_OBJECT_OPERATOR')) {
                $skip[] = T_NULLSAFE_OBJECT_OPERATOR;
            }
            if (!in_array($prev, $skip, true) && $prev !== '&') {
                $lc = strtolower($name);
                if ($lc === 'function_exists' || $lc === 'is_callable') {
                    $arg = $sig[$i + 2] ?? null;
                    if ($tname($arg) === T_CONSTANT_ENCAPSED_STRING) {
                        $guarded[] = strtolower(trim($arg[1], "'\""));
                    }
                }
                if ($classDepth !== null && !$fnStack) {
                    // a method body inside a class: its calls belong to the class, which
                    // is reached through `new`, so count them with the top level
                    $top[] = $lc;
                } elseif ($fnStack) {
                    $functions[end($fnStack)[0]][] = $lc;
                } else {
                    $top[] = $lc;
                }
            }
        }
    }
    return ['requires' => array_values(array_unique($requires)), 'functions' => $functions, 'top' => array_values(array_unique($top)), 'guarded' => array_values(array_unique($guarded))];
}

// ---- The app's PHP files. Tests and the PHPStan baseline are not requests.
$files = [];
foreach (glob($dir . '/*.php') as $f) {
    $b = basename($f);
    if (strpos($b, 'test-') === 0 || $b === 'config.php') {
        continue;
    }
    $files[$b] = rq_parse((string) file_get_contents($f));
}
// config.php holds defines only; parse it if present so a call there would count.
if (is_file($dir . '/config.php')) {
    $files['config.php'] = rq_parse((string) file_get_contents($dir . '/config.php'));
}

$closure = function (string $entry) use (&$files): array {
    $seen = [];
    $todo = [$entry];
    while ($todo) {
        $f = array_pop($todo);
        if (isset($seen[$f]) || !isset($files[$f])) {
            continue;
        }
        $seen[$f] = true;
        foreach ($files[$f]['requires'] as $r) {
            $todo[] = $r;
        }
    }
    return array_keys($seen);
};

echo "\n== 1. The scanner reads the code it is given ==\n";
// (db.php, a file that exists: smoke-test reads every require in the source as one.)
$probe = rq_parse("<?php\nrequire_once __DIR__ . '/db.php';\nfunction a() { b(); \$x->m(); X::s(); new Y(); }\nclass Z { public function q() { c(); } }\nif (!function_exists('d')) { d(); }\n\$f = function () { e(); };\nf();\n");
rqc('a require is read', $probe['requires'] === ['db.php'], json_encode($probe['requires']));
rqc('a function and the calls in its body', isset($probe['functions']['a']) && $probe['functions']['a'] === ['b'], json_encode($probe['functions']));
rqc('a method is not a global function, and ->m() X::s() new Y() are not calls', !isset($probe['functions']['q']) && !in_array('m', $probe['top'], true) && !in_array('s', $probe['top'], true) && !in_array('y', $probe['top'], true));
rqc('a closure\'s calls belong to the code around it', in_array('e', $probe['top'], true) && in_array('f', $probe['top'], true), json_encode($probe['top']));
rqc('a function_exists() guard is noted', $probe['guarded'] === ['d'], json_encode($probe['guarded']));
rqc('the app files were read (vacuity guard: ≥80)', count($files) >= 80, (string) count($files));
$defs = 0;
foreach ($files as $p) {
    $defs += count($p['functions']);
}
rqc('…and their functions (vacuity guard: ≥800)', $defs >= 800, (string) $defs);

echo "\n== 2. Every function a request reaches is loaded by it ==\n";
$problems = [];
$checkedCalls = 0;
foreach (array_keys($files) as $entry) {
    $set = $closure($entry);
    $defined = [];
    $guarded = [];
    foreach ($set as $f) {
        foreach ($files[$f]['functions'] as $fn => $_) {
            $defined[$fn] = $f;
        }
        foreach ($files[$f]['guarded'] as $g) {
            $guarded[$g] = true;
        }
    }
    // Reachability: every file's top level runs when it is loaded; from there,
    // follow calls into the app's functions.
    $queue = [];
    foreach ($set as $f) {
        foreach ($files[$f]['top'] as $c) {
            $queue[] = [$c, $f . ' (top level)'];
        }
    }
    $visited = [];
    while ($queue) {
        [$c, $from] = array_pop($queue);
        if (isset($visited[$c])) {
            continue;
        }
        $visited[$c] = true;
        $checkedCalls++;
        if (isset($defined[$c])) {
            foreach ($files[$defined[$c]]['functions'][$c] as $cc) {
                $queue[] = [$cc, $c . '() in ' . $defined[$c]];
            }
            continue;
        }
        if (function_exists($c) || isset($guarded[$c])) {
            continue;
        }
        // Defined somewhere in the app, but not in anything this request loads.
        $where = '';
        foreach ($files as $fname => $p) {
            if (isset($p['functions'][$c])) {
                $where = $fname;
                break;
            }
        }
        if ($where !== '') {
            $problems[] = "$entry reaches $c() (from $from), which is in $where — not loaded";
        }
    }
}
rqc('calls followed across every request (vacuity guard: ≥5000)', $checkedCalls >= 5000, (string) $checkedCalls);
rqc('no request calls an app function it never loads', !$problems, implode("\n      ", array_slice($problems, 0, 25)));

echo "\n== Summary ==\n";
if ($fails) {
    echo "  $fails CHECK(S) FAILED \xE2\x9D\x8C\n\n";
    exit(1);
}
echo "  EVERY REQUEST LOADS WHAT IT CALLS \xE2\x9C\x85\n\n";
exit(0);
