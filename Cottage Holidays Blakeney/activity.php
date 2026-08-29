<?php
// ============================================================
//  activity.php — RETIRED. The "recent events strip" it powered was replaced
//  by the Today workspace (Needs-you + timeline) and the full Activity log
//  (activity-log.php); no client has called this endpoint since. The file
//  stays as a guarded 410 because the deploy never deletes remote files — an
//  emptied repo copy is the only way to retire the live one. require_admin()
//  stays so the auth-posture registration remains true.
// ============================================================
require_once __DIR__ . '/db.php';
require_admin();
json_out(['error' => 'This endpoint has been retired — the Activity log lives at activity-log.php.'], 410);
