<?php
// ============================================================================
//  backup-crypt.php — encrypting the weekly database backup before it leaves.
//
//  WHY THIS EXISTS. backup.php emails the gzipped dump to the owner so a copy
//  lives off the host. That dump is every guest's name, email, phone, address,
//  postcode, booking history and chat messages — and once emailed it lives in a
//  mailbox for ever, synced to every device signed into it. The off-site copy
//  is worth having; the plaintext is not.
//
//  THE FORMAT IS OPENSSL'S OWN, ON PURPOSE. A backup you cannot open is not a
//  backup, and the owner may need this in five years on a machine that has
//  never heard of this app. So the output is byte-for-byte what
//
//      openssl enc -aes-256-cbc -pbkdf2 -iter 10000 -md sha256 -salt
//
//  produces — "Salted__", an 8-byte salt, then AES-256-CBC ciphertext, with the
//  key and IV derived by PBKDF2-HMAC-SHA256. Recovery is one standard command
//  on any Mac or Linux box (stated in the email itself), with no PHP, no this
//  app, and nothing to install. test-backup-crypt.php proves that by decrypting
//  with the REAL openssl binary rather than with a mirror of this code — the
//  same discipline test-webpush.php follows against RFC 8291's own vectors.
//
//  Pure: no database, no mail, no globals. Everything here is decidable from
//  its arguments, so the gate can drive it directly.
// ============================================================================

// PBKDF2 parameters. These are openssl's own defaults for `enc -pbkdf2`, and
// they are STATED rather than left implicit because the recovery command in the
// email names them — if they ever change here, that sentence must change too.
const BACKUP_ENC_CIPHER = 'aes-256-cbc';
const BACKUP_ENC_ITER = 10000;
const BACKUP_ENC_MD = 'sha256';
const BACKUP_ENC_MAGIC = 'Salted__';

// Is encryption actually possible on this host? A backup must never be attached
// in plaintext because an extension is missing — the caller withholds the
// attachment instead, so "we couldn't encrypt" can never silently become "here
// is everything about your guests".
function backup_crypt_available()
{
    return function_exists('openssl_encrypt')
        && function_exists('hash_pbkdf2')
        && in_array(BACKUP_ENC_CIPHER, openssl_get_cipher_methods(), true);
}

// A passphrase good enough to be worth the trouble. Deliberately a LENGTH rule
// and nothing else: character-class rules push people toward "Passw0rd!" while
// a long phrase they can actually remember is stronger. Refused reasons are
// sentences because the owner reads them.
function backup_pass_problem($pass)
{
    $p = (string) $pass;
    if (trim($p) === '') {
        return 'No passphrase set yet.';
    }
    if (mb_strlen(trim($p)) < 12) {
        return 'That passphrase is too short — use at least 12 characters. A few unrelated words is ideal.';
    }
    return '';
}

// Encrypt $plain under $pass, in openssl's container format.
// Returns the bytes, or '' when it could not be done — never a partial or
// unencrypted result, because the caller decides what to send from this.
// $salt is injectable ONLY so the gate can pin a known vector; production
// always takes a fresh random 8 bytes.
function backup_encrypt($plain, $pass, $salt = null)
{
    if (!backup_crypt_available() || backup_pass_problem($pass) !== '') {
        return '';
    }
    if ($salt === null) {
        try {
            $salt = random_bytes(8);
        } catch (\Throwable $e) {
            return ''; // no CSPRNG → no encryption → no attachment
        }
    }
    if (!is_string($salt) || strlen($salt) !== 8) {
        return '';
    }
    // 48 bytes: a 32-byte key followed by the 16-byte IV, which is exactly how
    // `openssl enc -pbkdf2` derives them.
    $dk = hash_pbkdf2(BACKUP_ENC_MD, (string) $pass, $salt, BACKUP_ENC_ITER, 48, true);
    if (!is_string($dk) || strlen($dk) !== 48) {
        return '';
    }
    $cipher = openssl_encrypt(
        (string) $plain,
        BACKUP_ENC_CIPHER,
        substr($dk, 0, 32),
        OPENSSL_RAW_DATA,
        substr($dk, 32, 16),
    );
    if ($cipher === false || $cipher === '') {
        return '';
    }
    return BACKUP_ENC_MAGIC . $salt . $cipher;
}

// The mirror image, so the app can prove its own output opens — used by the
// gate and by the back office's "check my passphrase" button. Returns null on
// any failure (wrong passphrase, truncated file, not our container), never a
// half-decoded string.
function backup_decrypt($blob, $pass)
{
    $b = (string) $blob;
    if (!backup_crypt_available() || strlen($b) <= 16 || strncmp($b, BACKUP_ENC_MAGIC, 8) !== 0) {
        return null;
    }
    $salt = substr($b, 8, 8);
    $dk = hash_pbkdf2(BACKUP_ENC_MD, (string) $pass, $salt, BACKUP_ENC_ITER, 48, true);
    $out = openssl_decrypt(
        substr($b, 16),
        BACKUP_ENC_CIPHER,
        substr($dk, 0, 32),
        OPENSSL_RAW_DATA,
        substr($dk, 32, 16),
    );
    return $out === false ? null : $out;
}

// THE RECOVERY COMMAND, STATED ONCE. It travels in the backup email itself,
// because instructions that live only in the app are the instructions you
// cannot reach when the app is the thing that is gone. Never carries the
// passphrase — that is the whole point of the exercise.
function backup_recovery_command($filename = 'chb-backup.sql.gz.enc')
{
    $f = preg_replace('/[^A-Za-z0-9._-]/', '', (string) $filename) ?: 'chb-backup.sql.gz.enc';
    $out = preg_replace('/\.enc$/', '', $f);
    return 'openssl enc -d -' . BACKUP_ENC_CIPHER . ' -pbkdf2 -iter ' . BACKUP_ENC_ITER
        . ' -md ' . BACKUP_ENC_MD . ' -in ' . $f . ' -out ' . $out;
}
