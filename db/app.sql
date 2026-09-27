-- The tables the APP writes. The build tables in schema.sql are rebuilt by ingest/load.py, which drops only messages,
-- conversations and dataset_meta, so saved chats and the topic edits survive a reload of the data. From the
-- reference's db/app.sql: chats, and Explore's topic editing (taxonomies, relabel jobs, spend). The membership rule,
-- pulse_topics(), is in schema.sql here, since load.py applies it. Idempotent: `npm run db:app`.

-- One saved conversation with the chatbot. The owner is an anonymous id from a cookie (src/proxy.ts): there are no
-- accounts, so a browser sees its own history and nobody else's. `messages` is the AI SDK UIMessage array exactly as
-- the client renders it (tool results and verification included), so a reloaded chat shows its evidence unchanged.
CREATE TABLE IF NOT EXISTS chats (
  id         text PRIMARY KEY,
  owner      text NOT NULL,
  title      text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  messages   jsonb NOT NULL DEFAULT '[]',
  turn       text                      -- the question being answered; NULL once its answer is saved (data/chats.ts)
);
CREATE INDEX IF NOT EXISTS chats_owner_idx ON chats (owner, updated_at DESC);

-- The label set, versioned. Exactly one version is active; conversations.topic_p holds keys of the active version.
-- The first read adopts the set ingest labelled with (dataset_meta.topics); every edit after that is a new version, so
-- an edit can be traced. `labels` is [{key, name, description}] with "other" last (src/lib/labels/taxonomy.ts).
-- A data reload (ingest/load.py) labels from data/work/topics.json, so export the active set there first
-- (`npm run labels -- export`), or the reload drops the edits this table still names.
CREATE TABLE IF NOT EXISTS taxonomies (
  version    serial PRIMARY KEY,
  source     text NOT NULL,            -- adopted | edited | relabelled
  note       text NOT NULL DEFAULT '',
  labels     jsonb NOT NULL,
  active     boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS taxonomies_one_active ON taxonomies (active) WHERE active;

-- A relabel (backfill): a draft label set, then every conversation asked again by Jev about the new or redefined
-- topics only (run_keys), in batches the client drives. Results land in relabel_results and merge into
-- conversations.topic_p in one transaction when the last batch is done, so the app never shows a half-relabelled set.
CREATE TABLE IF NOT EXISTS relabel_jobs (
  id           text PRIMARY KEY,
  base         int NOT NULL,             -- the taxonomy version it was drafted from
  labels       jsonb NOT NULL,
  status       text NOT NULL,            -- draft | running | done | failed | cancelled
  total        int NOT NULL,
  done         int NOT NULL DEFAULT 0,
  tokens       bigint NOT NULL DEFAULT 0,
  cost_usd     double precision NOT NULL DEFAULT 0,
  estimate_usd double precision NOT NULL,
  error        text,
  lease        timestamptz,              -- one batch at a time: a step takes the lease, a second caller waits
  run_keys     text[] NOT NULL DEFAULT '{}', -- the topics asked again; a removed topic needs no call
  skipped      int NOT NULL DEFAULT 0,   -- conversations Jev would not answer after MAX_TRIES
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS relabel_results (
  job_id          text NOT NULL,
  conversation_id text NOT NULL,
  topic_p         jsonb NOT NULL,        -- the answers for the job's run_keys only: {key: probability}
  PRIMARY KEY (job_id, conversation_id)
);
-- A conversation Jev keeps refusing must not sink a relabel: after MAX_TRIES failed attempts the asked topics get
-- probability 0 for it, it is counted in the job's `skipped`, and the job carries on.
CREATE TABLE IF NOT EXISTS relabel_failures (
  job_id          text NOT NULL,
  conversation_id text NOT NULL,
  n               int NOT NULL DEFAULT 1,
  error           text,
  PRIMARY KEY (job_id, conversation_id)
);

-- Every paid call the APP makes, plus one 'ingest' row for the build's own ledger (data/work/spend.json, seeded by
-- `npm run labels -- seed-spend`), so the $3 cap (store.ts CAP_USD, ingest/budget.py) holds across both. A relabel is
-- refused before it starts if its estimate would cross the cap.
CREATE TABLE IF NOT EXISTS spend (
  id     serial PRIMARY KEY,
  kind   text NOT NULL,                  -- ingest | jev-relabel
  tokens bigint NOT NULL DEFAULT 0,
  usd    double precision NOT NULL,
  note   text NOT NULL DEFAULT '',
  at     timestamptz NOT NULL DEFAULT now()
);
