# Decisions

Each choice, the alternative, and why. Where the human chose, ruled or overruled what the coding agent proposed, it
says so. Every number is measured on this dataset ([docs/DATA.md](docs/DATA.md)); none is carried over from the
rehearsal. How the pieces fit together is in [docs/DESIGN.md](docs/DESIGN.md).

## D1. Reuse the rehearsal app's code

- **Choice:** copy code from Community Pulse, an app I built beforehand to rehearse this task on other community data
  (a subreddit), frozen at commit `90f193d`. Copied: the Python ingest pipeline (normalize, group, sample, suggest,
  enrich, embed, load, budget), the data layer and its tools, the agent, the claim check, the chat page, the Explore
  grid and the eval runners. Changed only what this brief and this data need: a Discord adapter, reactions instead of
  votes, this community's topics, flags for "excited" and "frustrated", Gemini instead of OpenRouter models.
- **Alternative:** write it fresh in 90 minutes.
- **Why:** the brief scores choices and a working, grounded chatbot; 90 minutes buys a thin slice from scratch. The
  rehearsal's pieces were already debugged against real questions. Every carried-over decision below was re-checked
  against this data. Code is copied only for what is built and running: the chat first, then the Explore grid; topic
  editing waits on a branch until it has been run (D31).

## D2. "Now" is the last message

- **Choice:** now = 2026-09-27 19:30Z, the last message in the export. "The last 3 days" = 09-24 19:30Z to 09-27
  19:30Z, to the minute (the first prompt counted calendar days, which gave four). The agent's instructions state it,
  and answers name the window they used.
- **Alternative:** the server's clock.
- **Why:** the export is a snapshot; against the wall clock every relative question would come back empty or wrong
  the day after it was sent.

## D3. The unit: pause-split sessions, long ones cut into pieces (chosen by the human)

- **Choice:** inside each channel, a new conversation starts after a 15-minute pause. A session over 40 messages
  is cut into pieces: each cut goes at the longest pause between 20 and 40 messages from the piece's start, and the
  last piece keeps the remainder (51 of the 553 cut pieces are under 20; `ingest/group.py`). The result: 1,933
  sessions, 2,362 conversations, median 4 messages, at most 40. **The human chose this** after reviewing the session
  shapes the coding agent measured.
- **Alternatives, measured:**
  - Reply trees only: 63% of messages are not replies, so they would belong to no conversation.
  - Reply trees merged into the sessions: replies link sessions into chains, and the largest group holds 1,989
    messages, too big to read or label.
  - Fixed windows of 30 messages (the first design): cuts through the middle of an exchange and leaves stubs.
- **Why:** 159 sessions over 30 messages hold 67% of all messages, and the subject drifts about every 30 minutes
  inside them (docs/DATA.md). Pieces cut at the longest pause follow the natural breaks, stay small enough for one
  Jev read, and keep each message in exactly one conversation, so counts never double.

## D4. Reply parents from an earlier piece are context, not data

- **Choice:** when a reply's parent sits in an earlier conversation, the parent is attached as context: shown when
  the conversation is read, never counted in it.
- **Alternative:** move the parent in, or ignore it.
- **Why:** a reply without its parent is often unreadable ("yes exactly"), but counting the parent twice would inflate
  every count. Kept from the reference (its D8); the reason holds here, since 37% of messages are replies.

## D5. "Resonating" = engagement: authors + replies + reactions

- **Choice:** engagement per conversation = distinct authors + in-conversation replies + total reactions.
- **Alternative:** reactions alone (the obvious "resonating" signal).
- **Why:** only 4.5% of messages have any reaction and the most any message has is 8. On their own, reactions would
  rank almost every conversation at zero. The agent is told why the measure is what it is.

## D6. Labels are probabilities, from Jev, against topics discovered in the data

- **Choice:** Jev (`typesafe/jev-1.13`) reads every conversation once and returns one yes/no probability per topic
  (so a conversation can carry several), sentiment, and flags. Probabilities are stored; a topic "counts" at 0.5, a
  rule written once in SQL (`pulse_topics`), so thresholds stay a query-time choice.
- **Topics:** a Gemini Flash-Lite pass over a 300-conversation, channel-stratified sample suggested a label set
  (`data/work/suggested.json`); **the human edited it**: Bushido split into the final update, Domains, and Ebontide
  and new quests; bugs and performance and pricing and editions added; "general franchise" became series direction;
  a generic "community chat" topic dropped; several descriptions tightened ("only when ..."). **The human later
  removed** bugs and performance (D17), leaving 12 topics plus "other" (`data/work/topics.json`). The pricing topic
  was tightened after the hand audit (D23). The final set, with descriptions and shares, is in
  [docs/DATA.md](docs/DATA.md#label-set).
- **Alternative:** one topic per conversation as a hard verdict, or free-text tags from an LLM.
- **Why:** a conversation often touches two subjects; a verdict hides how sure the label is; free tags cannot be
  counted. Kept from the reference (D12, D17, D46).
- **Why Jev, in the human's words, a main reason:** the team should own the topics. Because a label is one yes/no
  probability per topic, changing one topic re-asks only that one question, and Jev's calls are cheap enough that the
  team can start a relabel itself, whenever it wants, without an engineer. On this data one full labelling run (every
  topic, flag and sentiment for all 2,362 conversations) cost $0.24; re-asking one topic is priced at about $0.06
  (D31). The editing that uses this is built but not merged (D31).

## D7. Sentiment towards the games and their developer (simplified by the human)

- **Choice:** sentiment is measured towards "the Veil of Ages games and their developer", 0 to 1.
- **Alternative:** general mood of the conversation, or the suggestion step's target, "Veil of Ages Bushido Final
  Update and Tides Remastered changes" (too narrow: it leaves out the rest of the series and the studio).
- **Why:** the user is the studio's community team: a cheerful meme thread about another game says nothing about how
  players feel about theirs. **The human simplified the target** to this one phrase.

## D8. Flags for the brief: excited and frustrated

- **Choice:** `p_excited` and `p_frustrated` per conversation, beside `p_bug`, `p_feature`, `p_help`, `p_noise`.
- **Alternative:** derive excitement from sentiment.
- **Why:** the brief's questions are literally "excited about" and "frustrated about"; high sentiment is not the same
  as hype, and a bug report can be calm. Direct flags make these slices one filter each.

## D9. Models

| role | model | key |
|---|---|---|
| agent | `gemini-2.5-flash` | the brief's key (`GOOGLE_GENERATIVE_AI_API_KEY`) |
| bulk text (topic suggestion, answer rewrite) | `gemini-3.5-flash-lite` | the brief's key |
| embeddings | `gemini-embedding-2`, 768 dimensions, L2-normalised | the brief's key |
| closed judgments: labels, rerank, scan relevance, claim support | Jev, `typesafe/jev-1.13` via OpenRouter | my own OpenRouter key |
| eval judge | `gemini-3.5-flash-lite` | the brief's key |

- **Agent model, chosen by the human, then ruled on again after a measured comparison:** Gemini 2.5 Flash, the model
  the brief named. It was first picked over 3.8 Flash to protect the capped key's quota. After the build, both ran
  the same 35 questions on the same code (README, Eval): 3.8 Flash was judged right on 35 of 35 against 34 of 35, but
  took about three times as long (median 19.4 s against 6.7 s) and made more tool calls (68 against 42). **The human
  ruled** that production stays on 2.5 Flash, and that the 3.8 Flash run stays in the eval as the comparison. One
  env var (`AI_MODEL`) switches it.
- **Jev is outside the provided key, stated openly.** It answers closed questions with calibrated probabilities and
  writes no text, which is what labels, rerank and the claim check need; the alternative is thousands of Flash calls
  on a capped key, parsed from prose. Everything written (the answer, suggestions) stays on the brief's key.
- **Embeddings are normalised** because Gemini only normalises its full-size output; a 768-dimension vector is not
  unit length, and cosine search would compare unlike things.

## D10. Two retrieval tools: scan and find

- **Choice:** `scan` has Jev read every conversation in a slice (time window, topic, channel, flag) and keep the
  relevant ones: for "what are people saying / excited / frustrated about". `find` is hybrid keyword + vector search
  fused by reciprocal rank, then a Jev rerank: for a named thing ("Ebontide", "fall damage"). Beside them:
  `aggregate` (counts from SQL), `read_conversation`, `voices`, a dataset overview and an out-of-scope answer.
- **Alternative:** one vector search for everything.
- **Why:** "what are people frustrated about" has no keyword to search for; top-k similarity samples the slice
  instead of reading it. A named thing is the opposite: search is exact and cheap. Kept from the reference (D9).
  Whether each half of hybrid and the rerank earn their place is measured in `eval/retrieval.ts` (README, Eval).
  The "too broad" branch refuses a slice over 2,500 conversations with a breakdown by topic and week; this dataset
  has 2,362, so on it the branch never fires, and it is there for a bigger export.

## D11. Numbers come from code

- **Choice:** the agent reaches data only through typed tools; every count it states comes from SQL. Aggregate
  questions in the eval are graded against SQL run at eval time.
- **Checked after the answer:** every figure in a cited claim that neither its messages nor any tool result contains
  is flagged (`unbackedFigures` in `src/lib/agent/verify.ts`). A figure the answer tags `[aggregate]`, `[scan]` or
  `[voices]` must come from that tool having run somewhere in the chat; if it never ran, the claim fails and the
  figure is named under the answer (`sourcelessFigures` in `rates.ts`). Added after the eval caught
  "60/100 [aggregate]" in an answer that had made no tool call.
- **Alternative:** trust the model's arithmetic and its tags.
- **Why:** models miscount; a community manager will repeat the number in a meeting.

## D12. The claim check

- **Choice:** citations are short handles the app issues (`[msgN]`). Every cited sentence is checked: the id exists,
  a tool showed it to the agent (D24), and Jev says the message supports the sentence (p >= 0.5). Weak sentences are
  rewritten once (Flash-Lite), and the rewrite is kept only if it is at least as well supported, still cites, states
  no more unmatched figures than before, and changed some words (`revise.ts`). Then every cited claim is put to all
  the conversations the turn found relevant, so the answer can say how many back it, not only the two or three it
  cites (`corroborate.ts`). The result is shown under the answer (D27).
- **Alternative:** trust the model's citations.
- **Why:** grounding is what the reviewers weigh most, and a citation that does not support its sentence is worse
  than none. Kept from the reference (D11, D14, D15).

## D13. "What should we post?" is answered as suggestions

- **Choice:** post ideas rest on cited, recent, high-engagement, excited conversations, and are labelled as
  suggestions, not findings.
- **Alternative:** answer it as a finding, like any other question.
- **Why:** the data shows what people talk about; what to post is a judgement the tool can support, not a fact.

## D14. UI scope

- **Built:** the chat page (streaming answer, citation chips, the one-line "what the agent did" with steps a click
  away, the verification, the evidence panel), saved chats (D18), and Explore's topic x time grid, read-only (D31).
- **Cut:** login; topic editing is not on `main` (D31).
- **Why:** the reviewers weigh retrieval and answer quality; the minutes went to the LLM path.

## D15. Data stays out of git

- **Choice:** `data/messages.json` and everything derived from it (`data/work/`) are gitignored; the pipeline reads
  and writes them locally and loads Neon directly from the laptop.
- **Alternative:** commit the data, or load it through the app.
- **Why:** the messages are the client's, even pseudonymised. Loading from the laptop also avoids the 4.5 MB request
  limit of a Vercel function.

## D16. Flags mean a main thread, not anyone (the human's call)

- **Choice:** `excited`, `frustrated` and `help` ask whether that feeling or request is a main thread of the
  conversation (more than a passing remark; in a one- or two-message conversation, the message itself), not whether
  anyone in it shows it. `bug` covers defects, crashes and performance. The wording is in `ingest/flags.py` (v4).
- **Alternative:** the first wording (v1), "does anyone ...".
- **Why, measured:** under v1 a long chat often holds one happy line and one grumble, so the flags stopped separating
  anything. On the same 60 conversations, the ones flagged both excited and frustrated fell from 15 to 1 going from v1
  to v4. On the full run of 2,362: both flags from 20.1% to 0.7%, excited 35.0% to 10.3%, frustrated 42.2% to 19.4%,
  help 51.1% to 36.3%. A slice like "what are people frustrated about" now holds the conversations that are about it.
  The hand audit (docs/DATA.md) found 37 of 41 fired flags right. **The human chose the v4 wording** after this A/B.

## D17. No topic duplicates a flag (the human's call)

- **Choice:** the "bugs and performance" topic is removed; bugs are the `bug` flag only.
- **Alternative:** keep both, as first suggested.
- **Why:** two labels for one question disagree at the edges, and the agent then has two answers to "how many bug
  reports". A topic says what a conversation is about, a flag what kind of message it holds. **The human removed the
  topic.**

## D18. Saved chats are restored (the human's call, after a UX review)

- **Choice:** a chat is saved and survives a reload through its URL (`/c/[id]`), with past chats in a sidebar, as in
  the reference. The `chats` table is in `db/app.sql`, apart from the build tables, so reloading the data keeps saved
  chats. The owner is an anonymous cookie id: no accounts, each browser sees its own history.
- **Alternative:** the first cut: lose a chat on reload.
- **Why:** reviewing the page as its user, **the human asked for it back**: a community manager returns to an answer to
  quote it, and an answer that vanishes on reload cannot be shared or checked again.

## D19. Engagement is a score, never a count

- **Choice:** the agent writes engagement as "an engagement score of N", with the number of conversations behind it
  taken from the count beside it; the tool output says so on every row (`for-model.ts`, `instructions.ts`).
- **Alternative:** let the model phrase the figure freely.
- **Why:** engagement is authors + replies + reactions summed over conversations (D5). Written bare, the model read it
  as a number of conversations or people, which is a wrong fact a reader would repeat.

## D20. General gaming talk is left out of what excites, frustrates and resonates

- **Choice:** for "what are people excited about", "what frustrates them", "what is resonating" and "what should we
  post", the agent leaves the "other" topic, the "other games" topic and chatter not about the games out of the
  ranking, unless the question asks for them, and may say so in one clause (`instructions.ts`). A frustration about
  films, other games or real life is not a player frustration. The by-topic chart beside such an answer leaves the
  same rows out (`activity-words.ts`).
- **Alternative:** rank everything the flag or the engagement score picks up.
- **Why:** the user is the studio's team: excitement about another franchise or a hardware purchase is real in the
  data but says nothing about their games, and would crowd the ranking (other games touch 17.1% of conversations).
- **Known debt:** the rule names the topics ("other", other games) in the prompt and the chart code. After a relabel
  it should read a "general" flag on the topic instead (README, Roadmap).

## D21. Embeddings: gemini-embedding-2, not the brief's embedding-001

- **Choice:** `gemini-embedding-2` at 768 dimensions on the brief's key, documents as RETRIEVAL_DOCUMENT, questions as
  RETRIEVAL_QUERY, every vector L2-normalised in code (`ingest/embed.py`, `src/lib/data/embed.ts`).
- **Alternative:** `gemini-embedding-001`, the model the brief named.
- **Why:** the key serves both; embedding-2 is the newer model and the one the reference pipeline and its query side
  already use, so both carried over unchanged. 768 dimensions keeps the index small. The two were not compared on
  this data.

## D22. Deploys are by hand

- **Choice:** Vercel git deploys are off (`vercel.json`); a production deploy is `vercel deploy --prod`, run when
  **the human decides**.
- **Alternative:** deploy on every push to `main`.
- **Why:** the capped key pays for every question the live app answers; nothing reaches it by accident on a push.

## D23. The pricing topic tightened after the hand audit

- **Choice:** `pricing-and-editions` counts only when the price or value of something is itself the subject; the
  description now says what does not count: a passing mention of buying, "DLC" as a name, in-game currency earned by
  playing, money idioms, money talk only in a context message. Every conversation was relabelled.
- **Alternative:** keep the audited description and call pricing counts an upper bound.
- **Why, measured:** the audit (docs/DATA.md) found 5 of 10 random pricing conversations right. The earlier, stricter
  wording had listed "purchases ... store items", Jev read the list as trigger words, and the share rose from 11.9%
  (v1) to 15.9%. With the exclusions spelled out it is 7.3%. The flag shares barely moved on the relabel (excited
  10.2%, frustrated 19.4%, help 36.3%). The new pricing labels were checked on 40 conversations, not re-audited.

## D24. A follow-up's citations are checked against the whole chat

- **Choice:** a citation backs a claim if any tool, in this turn or an earlier one in the same chat, showed that
  message to the agent (`chatToolSteps` in `agent.ts`). A message no tool ever showed still backs nothing.
- **Alternative:** this turn's tool results only (the first rule).
- **Why:** QA (docs/QA.md, Q1): "which of those are bugs?" answered from the previous turn's reads, and the check
  failed every claim although the same messages had backed them one turn earlier. The guard that matters, that the
  agent cannot cite what it never saw, holds either way.

## D25. A sentence that lists several things must be backed whole

- **Choice:** a sentence that lists (a comma, "and", "or", "plus") is also asked whether one message backs all of it;
  otherwise two or more messages must each back part of it (`sideScore` in `verify.ts`).
- **Alternative:** any cited message that backs one item backs the sentence.
- **Why:** QA (Q3): "excited about pre-orders, New Game Plus, and new pets [msg1]" passed on a message that said only
  "pre order done".

## D26. The answer is the text after the last tool call (reverses an earlier rule)

- **Choice:** text the model writes before a tool call is a draft: it is neither shown nor checked. The page
  (`evidence.ts`) and the check (`finish.ts`) cut at the same place.
- **Alternative:** the earlier rule, from the 2026-09-26 review: show and check every step's text, joined.
- **Why:** that rule fixed claims that were shown but never checked, but it also kept drafts: in the eval (O02),
  "60/100 [aggregate]" written beside an out-of-scope call stayed in the answer, above the answer written after
  reading. Cutting at the last tool call keeps the check's guarantee and drops the draft.

## D27. A weak check reads as a warning

- **Choice:** when fewer than half the checked claims are backed, the verification bar shows a warning, never a check
  mark. "Some wording was tightened" appears only when a kept rewrite changed words (D12).
- **Alternative:** one style for every result (the first bar).
- **Why:** QA (Q2): "0 of 3 claims are backed" wore the same check-circle as "all 9 backed", so a failed check looked
  like a pass.

## D28. Corroboration reads retry, eight at a time

- **Choice:** a failed Jev read in the corroboration step is logged; an HTTP 429, a 5xx or a timeout is retried three
  times with backoff; at most 8 reads run at once (`corroborate.ts`).
- **Alternative:** the first setting: 20 at once, a failure dropped without a log line.
- **Why:** QA (Q4): 72 of 80 reads failed with nothing in the log. All were OpenRouter 429s: every Jev call shares
  OpenRouter's pool for the model, and direct TypeSafe is out of credit, so there was no second route. After the change
  a rerun read 80 of 80.

## D29. A question is capped at 2,000 characters

- **Choice:** the text box stops at 2,000 characters and `/api/chat` refuses a longer question with a 413 and one line
  (`lib/question-limit.ts`).
- **Alternative:** no cap.
- **Why:** QA (Q6), found by reading the code: the public deploy would send a pasted 100k-character question to Gemini
  on the brief's capped key. 2,000 is room for a question with a quoted message in it, not for a pasted document.

## D30. The community is named "the Veil of Ages Discord"

- **Choice:** prose (the welcome heading, the agent's profile, the out-of-scope reply) says "the Veil of Ages
  Discord"; the export's "(Levellr sample)" is dropped (`lib/community.ts`).
- **Alternative:** the dataset's name as exported.
- **Why:** QA (Q7): "What is Veil of Ages Discord (Levellr sample) talking about?" is a file name, not how the team
  speaks about its community.

## D31. Explore: the grid is live, topic editing is held back on a branch

- **Choice:** Explore's topic x time grid (read-only) is copied from the reference and is on `main` and in production.
  Topic editing with a priced relabel and backfill (the reference's D17, D19) is built on the branch
  [`explore-topic-editing`](https://github.com/avshalomd/levellr-take-home/tree/explore-topic-editing) and was held
  back from `main` on purpose.
- **What it does:** in Explore the team adds, renames, redefines, combines or removes topics. A rename or a combine
  applies at once. Adding or redefining a topic shows a price first; on confirm, Jev asks that one topic's yes/no
  question of every conversation and backfills the probabilities, in resumable batches, under the build's $3 spend
  cap. Removing a topic is free.
- **What it costs:** the branch prices a relabel before any call as conversations x (state + question + call
  overhead) tokens at Jev's $0.042 per million input tokens (`estimate` in `src/lib/labels/taxonomy.ts` on the
  branch). With this data's mean state of 1,321 characters and the current topic descriptions, re-asking one topic
  of all 2,362 conversations comes to 1.30 to 1.55 million tokens, **about $0.06**, a formula result that no run has
  checked yet. The measured upper bound is a full labelling run, every topic, flag and sentiment in one request per
  conversation: $0.23 to $0.24 for each of the three runs recorded in `data/work/labels.jsonl`.
- **Alternative:** merge it untested, or leave Explore out.
- **Why:** the grid only reads the labels; editing writes them. Its tables (`npm run db:app`) and any relabel would
  run against the one Neon database, which production shares, and no Neon branch could be made to test on before
  delivery. Code that has never run does not go to `main` (D1). The steps to finish it are the first item of the
  README's roadmap.
