-- migration-116-night-asks.sql
--
--  THE ASK CHANNEL — the daytime half of the overnight queue.
--
--  The queue only ever flowed one way: the Mac worked at 02:00 and the owner
--  read it in the morning. This table is the site ASKING: the owner, on a
--  screen with an enquiry or a guest question in front of them, files an ask;
--  the Mac polls for open asks while it is running, does the AI work locally,
--  and posts the answer back onto the same row for the screen to collect.
--
--  The site cannot call the Mac (a home network has no inbound door), so the
--  queue IS the conversation: `ask` writes a row, the machine's `asks` read
--  lists open ones with the facts composed server-side — the same brief
--  posture, contact details withheld — and `answer` fills the row in.
--
--  An ask is about a MOMENT, so the TTL is minutes, not days
--  (nightshift-lib.php's NIGHT_ASK_TTL_MIN): the owner waiting at a composer
--  gives up inside two minutes, and a machine must never spend a model run
--  answering a question nobody is still asking. Swept in the endpoint, not
--  by cron — the rows only matter while somebody is looking.
--
--  Guarded the way every migration here is: CREATE TABLE IF NOT EXISTS.
CREATE TABLE IF NOT EXISTS night_asks (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    kind        VARCHAR(24)  NOT NULL,
    entity_id   INT          NOT NULL DEFAULT 0,
    prop_key    VARCHAR(64)  NOT NULL DEFAULT '',
    question    TEXT         NULL,
    status      VARCHAR(16)  NOT NULL DEFAULT 'open',
    answer      MEDIUMTEXT   NULL,
    model       VARCHAR(160) NOT NULL DEFAULT '',
    created_at  DATETIME     NOT NULL,
    answered_at DATETIME     NULL,
    KEY idx_ask_open (status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
