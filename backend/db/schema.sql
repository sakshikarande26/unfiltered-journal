-- The index. Not the source of truth.
--
-- Everything here is reconstructible from data/entries/ by server/store/reindex.ts.
-- If you are tempted to add a column that cannot be rebuilt from a file on
-- disk, the column belongs on disk first.

PRAGMA foreign_keys = ON;

-- The prose of a chapter, from entry.json.
--
-- week_id is the primary key rather than a synthetic integer: it is the
-- natural key, it is already the folder name on disk, and as the PK it makes
-- one-entry-per-week a property of the table rather than a separate index
-- someone could later drop.
--
-- There is deliberately no `state` column and no `locked` column. State is
-- derived from published_at plus the clock (see entryState in server/state.ts).
-- A stored state would be wrong the instant the clock crossed Monday 00:00,
-- and keeping it true would need a scheduled job whose only job is to fight
-- the calendar.
CREATE TABLE entries (
  week_id      TEXT PRIMARY KEY,
  title        TEXT NOT NULL DEFAULT '',
  description  TEXT NOT NULL DEFAULT '',
  liked        TEXT NOT NULL DEFAULT '',
  challenging  TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL,
  -- NULL means the entry is still a draft. Set once, at publish. This is the
  -- moment goals freeze.
  published_at TEXT,
  -- The journal timezone in force at creation. Audit only; week math uses the
  -- configured tz, never this column.
  created_tz   TEXT NOT NULL,
  -- From progress.json. Mutable forever, including on a locked entry.
  pinned          INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)),
  archived        INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
  goals_disclosed INTEGER NOT NULL DEFAULT 0 CHECK (goals_disclosed IN (0, 1))
) STRICT;

-- Paths only, never blobs. Files live under data/entries/<week_id>/photos/.
--
-- The 5-photo cap is a table constraint, so it holds even if a future caller
-- forgets to check. Position 0 is the cover.
CREATE TABLE photos (
  week_id        TEXT NOT NULL REFERENCES entries(week_id) ON DELETE CASCADE,
  position       INTEGER NOT NULL CHECK (position BETWEEN 0 AND 4),
  filename       TEXT NOT NULL,
  thumb_filename TEXT NOT NULL,
  width          INTEGER NOT NULL,
  height         INTEGER NOT NULL,
  -- The only AI-written field in the system. User editable until the entry
  -- locks. The AI never writes title, description, liked, challenging or goals.
  ai_description TEXT,
  PRIMARY KEY (week_id, position)
) STRICT;

-- Goal text and goal photos. Frozen at publish, not at lock.
--
-- Insert-only outside of a rebuild. Nothing in this codebase issues
-- `UPDATE goals` or `DELETE FROM goals`; that is greppable precisely because
-- completion lives in its own table below.
--
-- photo_filename refers to data/entries/<week_id>/goal-photos/, a sibling of
-- photos/ so that a handler serving entry photos cannot reach goal photos.
CREATE TABLE goals (
  goal_id        TEXT PRIMARY KEY,
  week_id        TEXT NOT NULL REFERENCES entries(week_id) ON DELETE CASCADE,
  position       INTEGER NOT NULL CHECK (position BETWEEN 0 AND 4),
  text           TEXT NOT NULL,
  photo_filename TEXT,
  UNIQUE (week_id, position)
) STRICT;

-- Goal completion is the one write permitted on a locked entry.
--
-- This is a separate table rather than a nullable completed_at column on
-- goals, because CLAUDE.md requires that completion toggles never consult the
-- entry lock while every other goal write must. As a column both writes would
-- go through `UPDATE goals` and the distinction would be a convention one
-- refactor away from collapsing. As a table, the permitted write and the
-- forbidden writes touch different objects - mirroring the fact that they
-- touch different files on disk.
CREATE TABLE goal_completions (
  goal_id      TEXT PRIMARY KEY REFERENCES goals(goal_id) ON DELETE CASCADE,
  completed_at TEXT NOT NULL
) STRICT;

CREATE TABLE index_meta (
  id             INTEGER PRIMARY KEY CHECK (id = 1),
  schema_version INTEGER NOT NULL,
  indexed_at     TEXT NOT NULL,
  journal_tz     TEXT NOT NULL
) STRICT;

-- The completed count is derived at read time, never stored. A view makes
-- derivation the only way to obtain the number: there is no column that can
-- go stale, and nothing to keep in sync on completion.
--
-- Note for the read model: `total` is the denominator shown as 3/5. Building a
-- shared projection means joining goals for the count WITHOUT selecting
-- goals.text or goals.photo_filename.
CREATE VIEW entry_goal_counts AS
SELECT
  e.week_id                                        AS week_id,
  COUNT(g.goal_id)                                 AS total,
  COUNT(c.goal_id)                                 AS done
FROM entries e
LEFT JOIN goals g            ON g.week_id = e.week_id
LEFT JOIN goal_completions c ON c.goal_id = g.goal_id
GROUP BY e.week_id;

CREATE INDEX idx_goals_week ON goals(week_id);
CREATE INDEX idx_photos_week ON photos(week_id);
