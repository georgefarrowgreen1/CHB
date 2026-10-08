<?php
// RETIRED. The AI chat and the Mac assistant were removed (owner's ask). The deploy
// never deletes files on the host, so this replaces the old endpoint there: anything
// still calling it (a Mac app left installed) gets a plain 410 and nothing else.
http_response_code(410);
header('Content-Type: application/json');
echo json_encode(['error' => 'The Mac assistant has been removed from the site.']);
