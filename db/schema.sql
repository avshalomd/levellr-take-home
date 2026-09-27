-- One Postgres (Neon) holds the messages, the conversations built from them, their Jev labels and their embeddings.
-- Adapted from the reference (Community Pulse). Applied by ingest/load.py, which drops and recreates these tables: the
-- data is a build output of the pipeline, never edited by hand. App tables (chats, ...) are not touched here.

CREATE EXTENSION IF NOT EXISTS vector;

DROP TABLE IF EXISTS messages, conversations, dataset_meta CASCADE;

-- One row per Discord message. The citable unit.
CREATE TABLE messages (
  id              text PRIMARY KEY,          -- msg_000123 from the export
  ref             integer NOT NULL UNIQUE,   -- short citable number, cited as [msg<ref>]; 1.. in (ts, id) order
  channel         text NOT NULL,
  reply_to        text,                      -- the parent message's id, when the message is a Discord reply
  conversation_id text NOT NULL,             -- the one conversation it is a member of (every message is in one)
  author          text NOT NULL,             -- pseudonymous handle from the export
  author_id       text NOT NULL,             -- stable account id (handles can repeat)
  ts              timestamptz NOT NULL,
  text            text NOT NULL,
  reactions       jsonb NOT NULL DEFAULT '[]', -- [{emoji, count}] as exported
  n_reactions     integer NOT NULL DEFAULT 0,  -- total reactions: the engagement signal (there is no score)
  tsv             tsvector GENERATED ALWAYS AS (to_tsvector('english', text)) STORED
);

-- The retrieval and judgement unit: a 15-minute session inside one channel, windowed when long.
CREATE TABLE conversations (
  id              text PRIMARY KEY,          -- <first message id>:w<window>
  ref             integer NOT NULL UNIQUE,   -- short handle for the agent, conv<ref>
  channel         text NOT NULL,
  kind            text NOT NULL,             -- session
  started_at      timestamptz NOT NULL,
  ended_at        timestamptz NOT NULL,
  n_messages      integer NOT NULL,
  n_authors       integer NOT NULL,
  n_replies       integer NOT NULL,          -- replies whose parent is in the same conversation
  n_reactions     integer NOT NULL,
  engagement      integer NOT NULL,          -- see ingest/group.py
  context_ids     text[] NOT NULL DEFAULT '{}', -- reply parents from outside, shown for context, not counted here
  transcript      text NOT NULL,             -- what the agent reads: header + [msg<ref>] author · time: text

  -- enrichment (Jev). Probabilities are kept, not only the verdict, so thresholds are a query-time choice.
  -- One Jev yes/no per topic of the approved label set: a conversation can carry several topics. topic_p holds every
  -- topic's probability; topics/topic/topic_conf are derived from it by pulse_topics() below, the one membership rule.
  topic_p         jsonb,                     -- {topic key: probability}, "other" never included
  topics          text[] NOT NULL DEFAULT '{}', -- member topics, p >= 0.5, highest first; {other} when none clears it
  topic           text,                      -- the primary topic = topics[1]
  topic_conf      real,                      -- p of the primary topic; for "other", 1 - the highest p
  sentiment       real,                      -- 0 (very negative) .. 1 (very positive), probability-weighted
  p_excited       real,                      -- excitement or hype about the games, an update, an event
  p_frustrated    real,                      -- frustration with the games, an update, or the studio
  p_bug           real,                      -- reports a defect
  p_feature       real,                      -- asks for a change or addition
  p_help          real,                      -- asks the community for help
  p_noise         real,                      -- jokes, memes, off-topic: no signal for the community team
  labels          jsonb,                     -- the rest of the Jev answer (sentiment distribution), for audit
  label_model     text,                      -- e.g. typesafe/jev-1.13-20260917

  embedding       vector(768),               -- gemini-embedding-2, L2-normalised
  tsv             tsvector GENERATED ALWAYS AS (
                    setweight(to_tsvector('english', channel), 'A') ||
                    setweight(to_tsvector('english', transcript), 'B')) STORED
);

-- Facts the agent states about the dataset itself (source, window, "now", counts, channels, topics), from the loader.
CREATE TABLE dataset_meta (
  key   text PRIMARY KEY,
  value jsonb NOT NULL
);

-- Topic membership from probabilities: the single copy of the rule, so ingest and any relabel in the app agree.
CREATE OR REPLACE FUNCTION pulse_topics(p jsonb) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p IS NULL THEN '{}'::text[] ELSE coalesce(
    (SELECT array_agg(key ORDER BY value::float8 DESC, key) FROM jsonb_each_text(p) WHERE value::float8 >= 0.5),
    '{other}'::text[]) END
$$;
-- The primary topic's confidence: its probability, or for "other" how sure we are that no topic applies.
CREATE OR REPLACE FUNCTION pulse_topic_conf(p jsonb) RETURNS real LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p IS NULL THEN NULL
    WHEN (SELECT max(value::float8) FROM jsonb_each_text(p)) >= 0.5 THEN (SELECT max(value::float8) FROM jsonb_each_text(p))::real
    ELSE (1 - coalesce((SELECT max(value::float8) FROM jsonb_each_text(p)), 0))::real END
$$;
