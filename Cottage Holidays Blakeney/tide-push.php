<?php
// RETIRED. The tide-timed push was removed from the code in June 2026, but the deploy
// never deletes files on the host, so the old endpoint went on running there (found by
// the server file check). This replaces it: anything still calling it gets a plain 410.
http_response_code(410);
header('Content-Type: application/json');
echo json_encode(['error' => 'The tide notification has been removed from the site.']);
