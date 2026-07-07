-- Follow-up to migration-zz9: purge the iOS flavour of injected-webview noise.
-- Facebook/Instagram's iOS in-app browser (WKWebView) injects scripts that poke
-- window.webkit.messageHandlers; our code never touches that API, so every such
-- "Front-end error" is third-party. New reports are filtered at both ends —
-- this clears entries logged before the filter shipped. Idempotent.
DELETE FROM activity_log
 WHERE action = 'client.error'
   AND summary LIKE '%webkit.messageHandlers%';
