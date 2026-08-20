-- The web AI chat's conversation becomes a REAL TABLE. It was one JSON blob
-- in the content table (key `mac-chat`), rewritten whole on every append —
-- which meant cards addressed by POSITION (a rotated thread had to 409),
-- last-write-wins between two devices, and a hard 40-message memory. Rows
-- give every message an id: cards address by id, appends cannot overwrite,
-- and the cap becomes retention. The `mac-chat` content key SURVIVES carrying
-- the standing instruction (and its old msgs are adopted into rows on the
-- first read after this migration — nothing already said is lost).
CREATE TABLE IF NOT EXISTS ownerchat_msgs (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    who         VARCHAR(8)   NOT NULL,            -- 'you' | 'mac'
    text        MEDIUMTEXT   NOT NULL,
    think       MEDIUMTEXT   NULL,
    used        VARCHAR(120) NULL,                -- JSON list of tool names
    model       VARCHAR(80)  NULL,
    stopped     TINYINT      NOT NULL DEFAULT 0,
    act         TEXT         NULL,                -- JSON, validated both ways
    act_done    VARCHAR(12)  NULL,                -- 'done' | 'dismissed'
    act_done_at VARCHAR(8)   NULL,
    img         VARCHAR(80)  NULL,                -- chat photo ref (minted shape)
    file        VARCHAR(80)  NULL,                -- an attached document's name
    at          VARCHAR(16)  NOT NULL DEFAULT '',
    created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
