-- Purge historic third-party webview noise from the activity log. Android
-- in-app browsers (Instagram/Facebook) inject an iabjs:// instrumentation
-- script whose bridge errors ("Java object is gone") were reported by the
-- client-error capture and cluttered "Needs attention". New reports are now
-- filtered at both ends (app.js + client-error.php); this clears the backlog.
-- Idempotent: deleting already-deleted rows is a no-op.
DELETE FROM activity_log
 WHERE action = 'client.error'
   AND (
        summary LIKE '%Java object is gone%'
     OR summary LIKE '%Java bridge%'
     OR meta LIKE '%iabjs://%'
     OR meta LIKE '%webkit-masked-url%'
   );
