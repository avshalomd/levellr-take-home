# Design: Community Pulse for Levellr

The design for review. It holds the choices; `DECISIONS.md` will hold each choice with its alternative and reason.

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
   two messages is over 15 minutes. A session with more than 40 messages is cut into pieces of 20–40, each cut
   placed before the longest pause in the allowed range (ties: the earliest), so pieces end where the talk paused;
   each piece keeps its session id and position so the agent can read the neighbouring pieces. When a reply's
   parent falls in an earlier piece or session, the parent is attached as context: it can be read, but it is not
   counted again.
   - The alternatives, measured: merging the reply trees into the sessions makes groups of up to 2,000 messages.
     Reply trees alone leave the 63% of messages that are not replies unassigned.
   - This gives about 2k–3k conversations. The exact count gets written down after the build.
   - What the agent cannot count: people's intent beyond the words, anything said outside these 11 channels, and
     anything before 09-13.
3. **"Resonating" is measured as engagement: distinct authors + replies + reactions per conversation**, not
   reactions alone. The agent is told why.
4. **Labels are stored as probabilities.** Jev reads every conversation once and gives:
   - one probability per topic, for a list of 10–14 topics discovered from a sample of the data, which you approve
   - sentiment, from 0 to 1
   - flags for the brief: `p_excited`, `p_frustrated`, `p_bug`, `p_feature`, `p_help`, `p_noise`
   - I'll audit about 30 of these labels by hand and put the result in the README.
5. **Models.** The agent runs on Gemini 2.5 Flash (chosen over 3.8 Flash to protect the capped key; one env var to
   switch). Bulk text runs on 3.5 Flash-Lite. Embeddings use `gemini-embedding-2` at 768 dimensions: the brief named
   `gemini-embedding-001`, but the key serves both, and embedding-2 is the newer model and returns normalized vectors
   at 768 (001 does not at that size). Closed yes/no judgments go to Jev through OpenRouter: labels, rerank, scan
   relevance and the claim check. Everything else stays on their key.
6. **Retrieval uses the reference's two tools**, which is the core of what they score:
   - `scan`: Jev reads every conversation in a slice (a time window, topic, channel or flag) and keeps the relevant
     ones. This serves "what are people saying / excited / frustrated".
   - `find`: keyword and vector search combined, then a Jev rerank. This serves a named thing ("Ebontide",
     "Domains", "Twitch drop").
   - `aggregate`: counts from SQL. `voices`: who is talking. `read_conversation`, `dataset_overview`, and an
     out-of-scope answer.
7. **"What should we post?"** is answered as suggestions. Each suggestion rests on cited high-engagement, excited
   conversations from the last 7 days, and is labelled as a suggestion, not a finding.
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
10. **Cut:** Explore and relabelling, chat history in a sidebar, and login. The chat survives a reload through its
    URL only if the time allows.
11. **Data stays out of git.** The loader reads `data/messages.json`.

## Schema (Neon, `db/schema.sql`, adapted from the reference)

- `messages`:
  - `id`, `ref` (cited as `msgN`), `channel`, `reply_to`, `conversation_id`, `author`, `ts`, `text`
  - `reactions` (jsonb) and `n_reactions` (int), which replace the reference's `score`
  - a generated `tsv`
- `conversations`:
  - `id`, `ref` (`convN`), `channel`, `kind` (`session`), `started_at`, `ended_at`
  - `n_messages`, `n_authors`, `n_replies`, `n_reactions`, `engagement`, `context_ids[]`, `transcript`
  - `topic_p`, `topics[]`, `topic`, `topic_conf`, `sentiment`
  - `p_excited`, `p_frustrated`, `p_bug`, `p_feature`, `p_help`, `p_noise`
  - `labels`, `label_model`, `embedding vector(768)`, `tsv`
- `dataset_meta`: the window, counts, channels, topics, and "now".
- `chats`: only if chat persistence stays in.

## Eval (it ships with numbers)

- About 15 questions written from this data:
  - lookup, e.g. "What do people think of the Ebontide quest?"
  - aggregate
  - temporal ("the last 3 days")
  - "excited" and "frustrated" questions
  - false premise, out of scope
- Two runs:
  - retrieval, keyword vs vector vs hybrid, each with and without the rerank
  - end-to-end, scored on correctness, citations and abstention
- The numbers go in the README.
