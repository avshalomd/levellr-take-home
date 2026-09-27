-- The table the APP writes. The build tables in schema.sql are rebuilt by ingest/load.py, which drops only messages,
-- conversations and dataset_meta, so saved chats survive a reload of the data. From the reference's db/app.sql, chats
-- only (Explore is not built tonight, so no taxonomies, relabel jobs or spend). Idempotent: `npm run db:app`.

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
