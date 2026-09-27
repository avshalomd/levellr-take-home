# Design: Community Pulse for Levellr

The design for review, written before the build. It holds the choices; `DECISIONS.md` holds each choice with its
alternative and reason. Statements the build made false are corrected in place, and the last section lists what
changed.

## The user and the questions

A Community & Marketing Manager asks what the community is excited about, what frustrates it, how people feel
about recent updates and events, and what to post this week. Answers must be grounded in the messages. Each
specific statement links to the message behind it. When the data cannot answer a question, the app says so.

## The data, measured (`docs/DATA.md` has the full profile)

- **Size and span:** 25,555 Discord messages from one community. They run from 2026-09-13 19:44Z to 2026-09-27
  19:30Z, all timestamps in UTC.
- **Channels:** 11. The game is a renamed Assassin's Creed ("Veil of Ages"). The channels map to products:
  - `new-release-*` = Bushido, the current game, which is getting its final content update
  - `remaster-*` = Tides Remastered, which is upcoming
  - `game-chat`, `rpg-chat`, `franchise-discussion`, `upcoming-releases` (Hollow), `looking-for-group`
  - `off-topic`
- **Authors:** 795, all pseudonyms. There are no bots.
- **Replies:** 37% of messages reply to another message. Every reply stays inside its channel, and chains go up to 15
  deep.
- **Reactions:** only 4.5% of messages have one, and no message has more than 8. They are too sparse to measure what
  is "resonating" on their own.
- **Text:** short (median 40 characters). Links appear as `[link]`, spoilers as `||...||`.

## Key decisions

1. **"Now" is the last message, 2026-09-27 19:30Z.** "The last 3 days" is counted back from there. The agent's
   prompt states this, and the answer names the window it used.
2. **The unit is a conversation.** Within each channel, messages are split into sessions wherever the gap between
   two messages is over 15 minutes. A session with more than 40 messages is cut into pieces: each cut goes before
   the longest pause 20–40 messages from the piece's start (ties: the earliest), so pieces end where the talk
   paused, and the last piece keeps the remainder, so some pieces are under 20 (51 of the 553 cut pieces). Each
   piece keeps its session id, its position and the session's piece count, so the agent can read the neighbouring
   pieces. When a reply's
   parent falls in an earlier piece or session, the parent is attached as context: it can be read, but it is not
   counted again.
   - The alternatives, measured: merging the reply trees into the sessions makes a group of 1,989 messages.
     Reply trees alone leave the 63% of messages that are not replies unassigned.
   - This gives 2,362 conversations from 1,933 sessions: median 4 messages, at most 40.
   - What the agent cannot count: people's intent beyond the words, anything said outside these 11 channels, and
     anything before 09-13.
3. **"Resonating" is measured as engagement: distinct authors + replies + reactions per conversation**, not
   reactions alone. The agent is told why.
4. **Labels are stored as probabilities.** Jev reads every conversation once and gives:
   - one probability per topic, for 12 topics plus "other", suggested by Flash-Lite from a 300-conversation sample
     and edited by the human (DECISIONS D6, D17, D23)
   - sentiment towards "the Veil of Ages games and their developer", from 0 to 1 (D7)
   - flags for the brief: `p_excited`, `p_frustrated`, `p_bug`, `p_feature`, `p_help`, `p_noise`; excited,
     frustrated and help ask whether it is a main thread of the conversation, not a passing remark (D16)
   - 30 conversations (plus 10 pricing ones) were audited by hand; the result is in `docs/DATA.md` and the README.
5. **Models.** The agent runs on Gemini 2.5 Flash (chosen over 3.8 Flash to protect the capped key; one env var to
   switch). Bulk text runs on 3.5 Flash-Lite. Embeddings use `gemini-embedding-2` at 768 dimensions: the brief named
   `gemini-embedding-001`, but the key serves both, embedding-2 is the newer model and the one the reference already
   uses (D21). A 768-dimension vector is not unit length, so every vector is L2-normalised in code. Closed yes/no
   judgments go to Jev through OpenRouter: labels, rerank, scan relevance and the claim check. Everything else stays
   on their key.
6. **Retrieval uses the reference's two tools**, which is the core of what they score:
   - `scan`: Jev reads every conversation in a slice (a time window, topic, channel or flag) and keeps the relevant
     ones. This serves "what are people saying / excited / frustrated".
   - `find`: keyword and vector search combined, then a Jev rerank. This serves a named thing ("Ebontide",
     "Domains", "Twitch drop").
   - `aggregate`: counts from SQL. `voices`: who is talking. `read_conversation`, `dataset_overview`, and an
     out-of-scope answer.
7. **"What should we post?"** is answered as suggestions. Each suggestion rests on cited high-engagement, excited
   conversations from the last 7 days, and is labelled as a suggestion, not a finding. Talk about other games and
   general chatter is left out of the ranking (D20).
8. **The claim check comes from the reference:**
   - Citations are short handles `[msgN]` that the app issues.
   - Every cited sentence is checked: the id exists, it was read in this turn, and Jev agrees the message supports
     the sentence.
   - A weak sentence is rewritten once, and the rewrite is kept only if it scores better.
9. **The UI is the reference's chat page:**
   - the answer streams in with citation chips
   - one line says what the agent did, with its steps a click away
   - the verification result is shown
   - an evidence panel opens a cited conversation as a thread tree with the cited messages lit
   - Discord wording throughout; there are no permalinks, because the export has none.
10. **Cut:** Explore and relabelling, and login. Saved chats were cut at first and restored after the human's UX
    review: a chat survives a reload through its URL (`/c/[id]`), with past chats in a sidebar (D18).
11. **Data stays out of git.** The loader reads `data/messages.json`.

## Schema (Neon, `db/schema.sql`, adapted from the reference)

- `messages`:
  - `id`, `ref` (cited as `msgN`), `channel`, `reply_to`, `conversation_id`, `author`, `author_id`, `ts`, `text`
  - `reactions` (jsonb) and `n_reactions` (int), which replace the reference's `score`
  - a generated `tsv`
- `conversations`:
  - `id`, `ref` (`convN`), `channel`, `kind` (`session`), `session_id`, `piece`, `n_pieces`, `started_at`, `ended_at`
  - `n_messages`, `n_authors`, `n_replies`, `n_reactions`, `engagement`, `context_ids[]`, `transcript`
  - `topic_p`, `topics[]`, `topic`, `topic_conf`, `sentiment`
  - `p_excited`, `p_frustrated`, `p_bug`, `p_feature`, `p_help`, `p_noise`
  - `labels`, `label_model`, `embedding vector(768)`, `tsv`
- `dataset_meta`: the window, counts, channels, topics, and "now".
- `chats` (in `db/app.sql`, apart from the build tables so a data reload keeps them): saved chats, owned by an
  anonymous cookie id.

## Eval (it ships with numbers)

- 18 questions written from this data (`eval/questions.jsonl`):
  - lookup, e.g. "What do people think of the Ebontide quest?"
  - aggregate
  - temporal ("the last 3 days")
  - "excited" and "frustrated" questions
  - false premise, out of scope
- Two runs:
  - retrieval, keyword vs vector vs hybrid, each with and without the rerank
  - end-to-end, scored on correctness, citations and abstention
- The numbers are in the README (retrieval) and `eval/results/` (both runs).

## What changed during the build

- The unit's last piece keeps the remainder, so some pieces are under 20 messages; the exact counts are measured (D3).
- The topic set was edited by the human; "bugs and performance" was removed so no topic duplicates the `bug` flag
  (D6, D17); the pricing description was tightened after the hand audit (D23).
- The sentiment target was shortened by the human to "the Veil of Ages games and their developer" (D7).
- Flags ask for a main thread, not anyone's passing remark, after an A/B of the wording (D16).
- Saved chats were restored after the human's UX review (D18).
- Engagement is always written as a score, never as a count (D19); other games and chatter are left out of what
  excites and resonates (D20).
- Embeddings: `gemini-embedding-2`, normalised in code, not the brief's `gemini-embedding-001` (D21).
- Deploys are by hand, when the human decides (D22).
