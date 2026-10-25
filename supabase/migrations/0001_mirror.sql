-- The sync mirror. The device holds the truth; these tables are what other
-- devices pull from. Every synced row carries a sync_seq from one shared
-- sequence so GET /sync/pull?since=<seq> is a cursor over "anything changed
-- since my last pull", immune to client clock skew.
--
-- Shape follows the local archive: entries are week-keyed, photos are
-- references (bytes live in object storage), goals freeze at publish, and
-- completion lives in its own table so the one post-lock write never shares
-- an UPDATE path with forbidden writes.

CREATE SEQUENCE public.sync_seq;

CREATE TABLE public.users (
  id         uuid PRIMARY KEY,
  email      text NOT NULL DEFAULT '',
  -- The timezone week math runs in. Synced from the device so the server can
  -- evaluate the same entry lock the device does.
  journal_tz text NOT NULL DEFAULT 'UTC',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.entries (
  user_id         uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  week_id         text NOT NULL,
  title           text NOT NULL DEFAULT '',
  description     text NOT NULL DEFAULT '',
  liked           text NOT NULL DEFAULT '',
  challenging     text NOT NULL DEFAULT '',
  created_at      timestamptz NOT NULL,
  -- NULL while a draft. Set once at publish - the moment goals freeze.
  published_at    timestamptz,
  -- State stays writable forever, on any entry, however old.
  pinned          boolean NOT NULL DEFAULT false,
  archived        boolean NOT NULL DEFAULT false,
  goals_disclosed boolean NOT NULL DEFAULT false,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  sync_seq        bigint NOT NULL DEFAULT nextval('public.sync_seq'),
  PRIMARY KEY (user_id, week_id)
);

-- References to object storage only, never blobs. Position 0 is the cover.
CREATE TABLE public.photos (
  user_id            uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  week_id            text NOT NULL,
  position           smallint NOT NULL CHECK (position BETWEEN 0 AND 4),
  storage_path       text NOT NULL,
  thumb_storage_path text NOT NULL,
  width              integer NOT NULL,
  height             integer NOT NULL,
  ai_description     text,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  sync_seq           bigint NOT NULL DEFAULT nextval('public.sync_seq'),
  PRIMARY KEY (user_id, week_id, position),
  FOREIGN KEY (user_id, week_id)
    REFERENCES public.entries(user_id, week_id) ON DELETE CASCADE
);

-- Goal text and goal photos. Frozen at publish, not at lock. Private
-- permanently: nothing outside the owner's sync scope ever reads them.
CREATE TABLE public.goals (
  goal_id            uuid PRIMARY KEY,
  user_id            uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  week_id            text NOT NULL,
  position           smallint NOT NULL CHECK (position BETWEEN 0 AND 4),
  text               text NOT NULL,
  -- Goal photos are private permanently; they sync for the owner only.
  photo_storage_path text,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  sync_seq           bigint NOT NULL DEFAULT nextval('public.sync_seq'),
  UNIQUE (user_id, week_id, position),
  FOREIGN KEY (user_id, week_id)
    REFERENCES public.entries(user_id, week_id) ON DELETE CASCADE
);

-- The one write permitted on a locked entry. changed_at orders last-write-wins
-- so completion can be toggled off as well as on, on any device.
CREATE TABLE public.goal_completions (
  goal_id      uuid PRIMARY KEY REFERENCES public.goals(goal_id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  week_id      text NOT NULL,
  -- NULL means "toggled off" - the row records the latest change, which may
  -- be an un-completion.
  completed_at timestamptz,
  changed_at   timestamptz NOT NULL,
  sync_seq     bigint NOT NULL DEFAULT nextval('public.sync_seq'),
  FOREIGN KEY (user_id, week_id)
    REFERENCES public.entries(user_id, week_id) ON DELETE CASCADE
);

CREATE INDEX entries_pull     ON public.entries          (user_id, sync_seq);
CREATE INDEX photos_pull      ON public.photos           (user_id, sync_seq);
CREATE INDEX goals_pull       ON public.goals            (user_id, sync_seq);
CREATE INDEX completions_pull ON public.goal_completions (user_id, sync_seq);

-- The mirror is only ever reached through the sync API, which authorizes by
-- JWT. RLS is defense in depth for any other path in; the policies themselves
-- live in 0002_supabase.sql because the `authenticated` role only exists on a
-- real Supabase project.
ALTER TABLE public.users            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.entries          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.photos           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.goals            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.goal_completions ENABLE ROW LEVEL SECURITY;
