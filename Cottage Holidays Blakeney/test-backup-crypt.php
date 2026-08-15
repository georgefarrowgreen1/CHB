<?php
// ============================================================================
//  test-backup-crypt.php — the weekly backup leaves the host encrypted, and
//  the owner can open it again years later without this app.
//
//  THE CENTRAL CHECK IS INTEROPERABILITY, NOT SELF-CONSISTENCY. Encrypting and
//  then decrypting with our own function only proves the two halves agree; if
//  both are wrong the backup is unopenable and nobody finds out until the day
//  it matters. So the round trip here runs through the REAL `openssl` binary
//  using the exact command the backup email prints — the same discipline
//  test-webpush.php follows by decrypting with RFC 8291's own vectors.
//
//  Dev/CI only (deploy-excluded). No database, no mail, no network.
// ============================================================================
require_once __DIR__ . '/backup-crypt.php';

$pass = 0;
$fail = 0;
// NAMED bck(), not chk(): PHPStan analyses every test file as ONE set, and two
// other suites already declare a 2-argument chk() — the collision CLAUDE.md
// records. A unique name is the fix, not a matching signature.
function bck($label, $cond, $detail = '')
{
    global $pass, $fail;
    if ($cond) {
        $pass++;
        echo "  \u{2713} $label\n";
    } else {
        $fail++;
        echo "  \u{2717} $label" . ($detail !== '' ? " — $detail" : '') . "\n";
    }
}

echo "== backup encryption ==\n";

// ---- §1 the container is openssl's own ------------------------------------
$secret = "-- CHB database dump\nINSERT INTO bookings VALUES ('Sarah Pemberton','sarah@example.com','07700 900123');\n";
$phrase = 'quay lane samphire tideline';
$blob = backup_encrypt($secret, $phrase);
bck('§1 something comes out', $blob !== '', 'empty');
bck('§1 it opens with openssl\'s Salted__ magic', strncmp($blob, 'Salted__', 8) === 0, bin2hex(substr($blob, 0, 8)));
bck('§1 …followed by an 8-byte salt and a whole number of AES blocks',
    strlen($blob) > 16 && (strlen($blob) - 16) % 16 === 0, 'len ' . strlen($blob));
bck('§1 the plaintext is GONE from the output', strpos($blob, 'Sarah Pemberton') === false
    && strpos($blob, 'sarah@example.com') === false);
// Two runs must differ — a fixed salt would leak that two backups are identical.
bck('§1 a second run salts differently', backup_encrypt($secret, $phrase) !== $blob);

// ---- §2 THE REAL openssl BINARY OPENS IT ----------------------------------
// This is the check the feature exists for. It runs the command the email
// prints, so the instructions and the file cannot drift apart.
$openssl = trim((string) @shell_exec('command -v openssl 2>/dev/null'));
if ($openssl === '') {
    echo "  ! openssl binary not on this box — the interoperability check is SKIPPED\n";
    echo "    (CI has it; a green run here without this line is not full coverage)\n";
} else {
    $tmp = sys_get_temp_dir() . '/chb-backup-crypt-' . getmypid() . '.enc';
    file_put_contents($tmp, $blob);
    // Exactly the parameters backup_recovery_command() names.
    $cmd = escapeshellcmd($openssl) . ' enc -d -aes-256-cbc -pbkdf2 -iter 10000 -md sha256 -in '
        . escapeshellarg($tmp) . ' -pass ' . escapeshellarg('pass:' . $phrase) . ' 2>/dev/null';
    $out = (string) @shell_exec($cmd);
    bck('§2 the REAL openssl binary decrypts it back, byte for byte', $out === $secret,
        strlen($out) . ' bytes back of ' . strlen($secret));
    // …and refuses the wrong passphrase rather than returning rubbish.
    $bad = (string) @shell_exec(escapeshellcmd($openssl) . ' enc -d -aes-256-cbc -pbkdf2 -iter 10000 -md sha256 -in '
        . escapeshellarg($tmp) . ' -pass ' . escapeshellarg('pass:not the passphrase') . ' 2>/dev/null');
    bck('§2 …and gives nothing useful for a wrong passphrase', $bad !== $secret);
    // The printed command must BE the command that worked — assert the string,
    // not a paraphrase of it, so editing one without the other fails here.
    $printed = backup_recovery_command('chb-backup-20260815-030000.sql.gz.enc');
    foreach (['-aes-256-cbc', '-pbkdf2', '-iter 10000', '-md sha256'] as $bit) {
        bck("§2 the email's own command names $bit", strpos($printed, $bit) !== false, $printed);
    }
    bck('§2 …and it writes out a .sql.gz, not the .enc', strpos($printed, '-out chb-backup-20260815-030000.sql.gz') !== false, $printed);
    @unlink($tmp);
}

// ---- §3 our own decrypt agrees (the back office's "check it" path) --------
bck('§3 backup_decrypt round-trips', backup_decrypt($blob, $phrase) === $secret);
bck('§3 a wrong passphrase returns null, never half a file', backup_decrypt($blob, 'wrong one entirely') === null);
bck('§3 junk that is not our container returns null', backup_decrypt('not encrypted at all', $phrase) === null);
bck('§3 a truncated file returns null', backup_decrypt(substr($blob, 0, 12), $phrase) === null);

// ---- §4 THE REFUSALS — every one of these must yield NO ciphertext, because
// the caller attaches only what comes out of here. A returned '' is what stops
// backup.php sending a plaintext database.
bck('§4 no passphrase → nothing to attach', backup_encrypt($secret, '') === '');
bck('§4 whitespace is not a passphrase', backup_encrypt($secret, "   \n  ") === '');
bck('§4 a short passphrase is refused, with a sentence',
    backup_encrypt($secret, 'letmein') === '' && strpos(backup_pass_problem('letmein'), '12 characters') !== false,
    backup_pass_problem('letmein'));
bck('§4 …and a real phrase is accepted', backup_pass_problem($phrase) === '');
bck('§4 a bad salt length is refused rather than guessed', backup_encrypt($secret, $phrase, 'short') === '');

// ---- §5 the wiring — the gate that would have caught the original defect ---
// backup.php must not have a route back to attaching the raw dump.
$bsrc = (string) file_get_contents(__DIR__ . '/backup.php');
$bnc = implode("\n", array_filter(explode("\n", $bsrc), fn($l) => strpos(ltrim($l), '//') !== 0)); // comments explain the rule; they are not the rule
bck('§5 backup.php encrypts before attaching', strpos($bnc, 'backup_encrypt(') !== false);
bck('§5 …and never attaches the dump file itself',
    strpos($bnc, "'content' => file_get_contents(\$res['file'])") === false, 'the raw dump is still attached');
bck('§5 the attachment list is empty unless there is ciphertext',
    preg_match('/\$atts = \[\];/', $bnc) === 1 && preg_match('/if \(\$blob !== \'\'\)/', $bnc) === 1);
bck('§5 the recovery command travels with it', strpos($bnc, 'backup_recovery_command(') !== false);
bck('§5 the passphrase is NEVER printed into the email',
    !preg_match('/\$encNote\s*=.*\$pass\b/', $bnc) && !preg_match('/backup_report_body\([^)]*\$pass\b/', $bnc));
// A config const must still win, like every other secret in this app.
bck('§5 a config const overrides the stored passphrase', strpos($bnc, 'BACKUP_PASSPHRASE') !== false);

echo "\n== Summary ==\n";
if ($fail) {
    echo "  $fail BACKUP-CRYPT CHECK(S) FAILED \u{274C}\n";
    exit(1);
}
echo "  ALL $pass BACKUP-CRYPT CHECKS PASSED \u{2705}\n";
