# Decisions

Each choice, the alternative, and why. Where a first design was replaced, the entry says what changed and why. Every
number is measured on this dataset ([docs/DATA.md](docs/DATA.md)). How the pieces fit together is in
[docs/DESIGN.md](docs/DESIGN.md).

The decisions that shape the answers most: the unit (D3), labels as probabilities from Jev (D6), flags that mean a
main thread (D16), topics and flags as two axes (D17), two retrieval tools and how a question is routed between them
(D10), numbers from code (D11), and the claim check (D12). The agent model and why it stayed on 2.5 Flash after a
measured comparison are in D9; why topic editing is held back from production is in D31.

D34 to D44 are the decisions of release `v1.1`, made to fix what the QA passes found ([docs/QA.md](docs/QA.md)): the
model's history window (D34), answers kept to the community's own games (D35), the first-step read rules (D36), one
scope check on every turn (D37), counted figures from this turn only (D38), and the rest. Where one changes an earlier
decision, the earlier entry says so.

## D1. A Python ingest, a TypeScript app, one Postgres

- **Choice:** the dataset is built by a Python pipeline run from the laptop (normalize, group, sample, suggest,
  enrich, embed, load, with a spend ledger), and served by a Next.js app in TypeScript. Both use one Neon Postgres
  with pgvector: messages, conversations, labels, vectors and a full-text index in the same tables.
- **Alternative:** one language for both; a separate vector store beside the database.
- **Why:** ingest is batch data work that must resume and cache between runs, which Python and JSONL files do
  simply; the app is a streaming chat on Vercel, which the AI SDK serves in TypeScript. One database means a search,
  a label filter and a count are one SQL query over the same rows, with nothing to keep in sync. Only what is built
  and has run goes on `main`: the chat, then the Explore grid; topic editing waits on a branch (D31).

## D2. "Now" is the last message

- **Choice:** now = 2026-09-27 19:30Z, the last message in the export. "The last 3 days" = 09-24 19:30Z to 09-27
  19:30Z, to the minute (the first prompt counted calendar days, which gave four). The agent's instructions state it,
  and answers name the window they used.
- **Alternative:** the server's clock.
- **Why:** the export is a snapshot; against the wall clock every relative question would come back empty or wrong
  the day after it was sent.
- **Since v1.1:** dates written inside messages do not match the timestamps (docs/DATA.md, QA P8), so the
  instructions say to quote such a date as the message writes it, add no year, and never call it upcoming or past
  against now. This is a prompt rule only. A period asked for outside the data is D44.

## D3. The unit: pause-split sessions, long ones cut at the best silence

- **Choice:** inside each channel, a new conversation starts after a 15-minute pause. A session over 40 messages
  is cut into pieces: each cut goes at the longest pause between 20 and 40 messages from the piece's start, and the
  last piece keeps the remainder (51 of the 553 cut pieces are under 20; `ingest/group.py`). The result: 1,933
  sessions, 2,362 conversations, median 4 messages, at most 40.
- **History:** the first design cut long sessions every 30 messages. A plain cut splits exchanges mid-way, so
  labelling waited until the grouping rule was settled. The session shapes were measured and examples read, and the
  rule became: a 15-minute pause starts a session, and where a long session has no 15-minute silence, it is cut at
  the next best silence into pieces of 20 to 40 messages.
- **Alternatives, measured:**
  - Reply trees only: 63% of messages are not replies, so they would belong to no conversation.
  - Reply trees merged into the sessions: replies link sessions into chains, and the largest group holds 1,989
    messages, too big to read or label.
  - Fixed windows of 30 messages (the first design): cuts through the middle of an exchange and leaves stubs.
- **Why:** 159 sessions over 30 messages hold 67% of all messages, and the subject drifts about every 30 minutes
  inside them (docs/DATA.md). Pieces cut at the longest pause follow the natural breaks, stay small enough for one
  Jev read, and keep each message in exactly one conversation, so counts never double.
- **Why 15 minutes:** a silence of more than 15 minutes starts a new session; 15 minutes or less keeps it going
  (`gap > 15 * 60` in `ingest/group.py`). 15 is a common default for chat and was not tuned; it was
  measured afterwards on the 25,555 messages (docs/DATA.md § Why a 15-minute silence). Inside a channel, 90% of the
  gaps between one message and the next are under 10 minutes (median 0.4), and only 7.5% of gaps run over 15 minutes
  (1,922 of 25,544), so such a silence usually means the talk stopped. Replies come fast: half within 1.3 minutes of their parent, 75% within 7.3.
  At 15 minutes 14.1% of replies land in another session from their parent (they carry it as context, D4). At 5
  minutes that is 24.2% and single-message sessions nearly triple (1,663 against 619); at 30 or 60 minutes, 74% or
  87% of messages sit in sessions over 40 that get cut at a pause anyway, so a longer threshold mostly glues separate
  subjects together. The curve has no sharp elbow: 15 is a reasonable middle, not an optimum, and it was not tested
  against answer quality.

## D4. Reply parents from an earlier piece are context, not data

- **Choice:** when a reply's parent sits in an earlier conversation, the parent is attached as context: shown when
  the conversation is read, never counted in it.
- **Alternative:** move the parent in, or ignore it.
- **Why:** a reply without its parent is often unreadable ("yes exactly"), but counting the parent twice would inflate
  every count. It matters here: 37% of messages are replies.

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
  (`data/work/suggested.json`). It was revised by hand: Bushido split into the final update, Domains, and Ebontide
  and new quests; bugs and performance and pricing and editions added; "general franchise" became series direction;
  a generic "community chat" topic dropped. The list was fixed before any paid labelling. Bugs and performance was
  later removed, because no topic may sit close to a flag (D17),
  leaving 12 topics plus "other" (`data/work/topics.json`). Descriptions were tightened with "only when ..." and
  "not ..." clauses after the first labels (D16), and pricing again after the hand audit (D23). The final set, with
  descriptions and shares, is in [docs/DATA.md](docs/DATA.md#label-set).
- **Alternative:** one topic per conversation as a hard verdict, or free-text tags from an LLM.
- **Why:** a conversation often touches two subjects; a verdict hides how sure the label is; free tags cannot be
  counted.
- **Why Jev:** Jev answers the closed judgments (D9), and its main advantage here is that relabelling becomes so
  cheap that a user can start it whenever they want, so the team can make the topics its own without an engineer. Because a label is one yes/no
  probability per topic, changing one topic re-asks only that one question. On this data one full labelling run
  (every topic, flag and sentiment for all 2,362 conversations) cost $0.23 to $0.24; re-asking one topic is priced
  at about $0.06 (D31). The editing that uses this is built but not merged (D31).

## D7. Sentiment towards the games and their developer

- **Choice:** sentiment is measured towards "the Veil of Ages games and their developer", 0 to 1.
- **Alternatives:** general mood of the conversation; the suggestion step's target, "Veil of Ages Bushido Final
  Update and Tides Remastered changes" (too narrow: it leaves out the rest of the series and the studio); a wider
  wording, "the Veil of Ages games and the studio behind them: their updates, releases and decisions".
- **Why:** this is a game's Discord, so sentiment should be towards the games or their developer, and the extra words
  in the longer wording added nothing. The user is the studio's community team: a
  cheerful meme thread about another game says nothing about how players feel about theirs.

## D8. Flags for the brief: excited and frustrated

- **Choice:** `p_excited` and `p_frustrated` per conversation, beside `p_bug`, `p_feature`, `p_help`, `p_noise`.
- **Alternative:** derive excitement from sentiment.
- **Why:** the brief's questions are literally "excited about" and "frustrated about"; high sentiment is not the same
  as hype, and a bug report can be calm. Direct flags make these slices one filter each.

## D9. Models

| role | model | key |
|---|---|---|
| agent | `gemini-2.5-flash` | the provided key (`GOOGLE_GENERATIVE_AI_API_KEY`) |
| bulk text (topic suggestion, answer rewrite) | `gemini-3.5-flash-lite` | the provided key |
| embeddings | `gemini-embedding-2`, 768 dimensions, L2-normalised | the provided key |
| closed judgments: labels, rerank, scan relevance, claim support | Jev, `typesafe/jev-1.13` via OpenRouter | the builder's own OpenRouter key |
| eval judge | `gemini-3.5-flash-lite` | the provided key |

- **Which models the key serves:** the email with the key named Gemini 2.5 Flash, Flash-Lite and
  `gemini-embedding-001`. Before choosing, the key was probed: it also serves `gemini-3.8-flash`,
  `gemini-3.5-flash-lite` and `gemini-embedding-2`.
- **Agent model:** Gemini 2.5 Flash. The alternative was 3.8 Flash, likely better at using tools. 2.5 Flash was
  chosen so as not to hit the key's cap through 3.8's higher cost, with 3.8 kept one setting away. After the build
  both ran the same 35 questions on the same code, the `v1.0` code at `96f625f` (README, Eval). 3.8 Flash was judged
  right on 35 of 35 against 34 of 35, but took about three times as long (median 19.4 s against 6.7 s) and made twice
  as many tool calls (110 against 55). Production stays on 2.5 Flash: the quality is near equal, it is faster, and it
  spends less of the capped key. The 3.8 run stays in the eval docs as the comparison; it was not rerun on the `v1.1`
  code. One env var (`AI_MODEL`) switches it.
- **Jev for closed judgments, outside the provided key, stated openly.** Jev answers closed
  questions with calibrated probabilities and writes no text, which is what labels, rerank and the claim check need;
  the alternative is thousands of Flash calls on a capped key, parsed from prose. Its low price also makes relabelling
  cheap enough for a user to start (D6). Everything written (the answer, suggestions) stays on the provided key.
- **Embeddings are L2-normalised in code**, on the ingest side and the query side, so cosine search compares unit
  vectors whatever length the API returns at 768 dimensions.

## D10. Two retrieval tools: scan and find

- **Choice:** `scan` has Jev read every conversation in a slice (time window, topic, channel, flag) and keep the
  relevant ones: for "what are people saying / excited / frustrated about". `find` is hybrid keyword + vector search
  fused by reciprocal rank, then a Jev rerank: for a named thing ("Ebontide", "fall damage"). Beside them:
  `aggregate` (counts from SQL), `read_conversation`, `voices`, a dataset overview and an out-of-scope answer.
- **Alternative:** one vector search for everything.
- **Why:** "what are people frustrated about" has no keyword to search for; top-k similarity samples the slice
  instead of reading it. A named thing is the opposite: search is exact and cheap.
  Whether each half of hybrid and the rerank earn their place is measured in `eval/retrieval.ts` (README, Eval).
  The "too broad" branch refuses a slice over 2,500 conversations with a breakdown by topic and week; this dataset
  has 2,362, so on it the branch never fires, and it is there for a bigger export.
- **Routing, changed after a review of the answers:** an answer about one topic had read every conversation in the
  database, because the agent scanned the whole window without the topic. The instructions now
  route by the question's shape: a broad question about a topic scans that topic's slice only (for multiplayer and
  co-op, the 4.1% of conversations carrying that topic instead of all 2,362); a specific thing inside a topic
  (Ebontide, fall damage) goes to `find`; only a question with no subject ("what are people excited about") reads
  the whole window. A topic read of under 150 conversations is followed by a `find` for recall, because a label
  misses a clear topic in about 1 of 5 conversations (docs/DATA.md). The first
  version of the rule also sent named things to a topic scan, and the lookup questions got worse in the eval
  (`eval/results/agent.json`: lookup 0.58); sending named things to `find` fixed it (6/6 lookups right in the
  35-question run).

## D11. Numbers come from code

- **Choice:** the agent reaches data only through typed tools; every count it states comes from SQL. Aggregate
  questions in the eval are graded against SQL run at eval time.
- **Checked after the answer:** every figure in a cited claim that neither its messages nor any tool result contains
  is flagged (`unbackedFigures` in `src/lib/agent/verify.ts`). A figure the answer tags `[aggregate]`, `[scan]` or
  `[voices]` must come from that tool having run in this turn; if it did not, the claim fails and the figure is named
  under the answer (`sourcelessFigures` in `rates.ts`). Added after the eval caught "60/100 [aggregate]" in an answer
  that had made no tool call. In `v1.0` a tool run anywhere in the chat was enough; D38 narrowed it to this turn.
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
- **Why:** the brief asks for answers grounded in the messages, and a citation that does not support its sentence
  is worse than none.
- **Changed in v1.1:** for a question kept to the community's own games, the same Jev call also asks whether each
  cited message is about something else, and such a citation backs nothing (D35). The support question fails a claim
  that changes or adds to the message's meaning (D42). A figure tagged as counted must come from this turn's tools
  (D38). A Jev call refused by a busy pool is retried with longer waits (D40).
- **Known gap in v1.1** (docs/QA.md, P9): a claim that says more than its cited message can still pass. In the
  release-candidate QA, "pre-ordering and expressing excitement for new game plus, new pets" passed on "pre order
  done 😍"; the next message, not cited, named the other two.

## D13. "What should we post?" is answered as suggestions

- **Choice:** post ideas rest on cited, recent, high-engagement, excited conversations, and are labelled as
  suggestions, not findings.
- **Alternative:** answer it as a finding, like any other question.
- **Why:** the data shows what people talk about; what to post is a judgement the tool can support, not a fact.
- **Changed in v1.1** (docs/QA.md, P4: in `v1.0` three ideas rested on one message each, with no engagement measure
  behind them): a post read ranks the relevant excited conversations by engagement, most engaged first (`scan.ts`,
  `rank: "engagement"`). The instructions ask for a count of engagement by topic first, then that read, top 15; each
  idea rests on messages from at least two conversations, or its own line ends "(only one conversation shows this)".
  A topic's engagement score is given once, for that topic only, never to two ideas. The count is asked for, not
  forced: forcing it produced over a thousand repeated calls in one step (D39).
- **Known gap in v1.1:** the thin marker is a prompt rule only, added after the release-candidate QA, where two of
  four ideas still rested on one message each.

## D14. UI scope

- **Built:** the chat page (streaming answer, citation chips, the one-line "what the agent did" with steps a click
  away, the verification, the evidence panel as a reply tree, D32), saved chats (D18), and Explore's topic x time
  grid, read-only (D31).
- **Cut:** login; topic editing is not on `main` (D31).
- **Why:** the brief asks for a useful answer grounded in the messages, and calls anything more a bonus; the minutes
  went to the answer path (retrieval, grounding, the claim check), and the UI shows what that path did.

## D15. Data stays out of git

- **Choice:** `data/messages.json` and everything derived from it (`data/work/`) are gitignored; the pipeline reads
  and writes them locally and loads Neon directly from the laptop.
- **Alternative:** commit the data, or load it through the app.
- **Why:** the messages are the client's, even pseudonymised. Loading from the laptop also avoids the 4.5 MB request
  limit of a Vercel function.

## D16. Flags mean a main thread, not anyone

- **Choice:** `excited`, `frustrated` and `help` ask whether that feeling or request is a main thread of the
  conversation (more than a passing remark; in a one- or two-message conversation, the message itself), not whether
  anyone in it shows it. `help` counts a practical question that someone answers, even in a longer chat; opinion
  questions and banter do not. `bug` covers defects, crashes and performance. The wording is in `ingest/flags.py`
  (v4).
- **Alternative:** the first wording (v1), "does anyone ...".
- **History:** the first labels saturated on long pieces. A relabel is fast and cheap (D6), so the wording was
  iterated on a fixed set of 60 conversations. The "main thread" wording (v2) improved on v1, and two more rounds on
  the same 60 (v3, v4) caught an answered help question that v2 missed and stopped opinion fights from counting as
  help. v4 was then run on every conversation.
- **Why, measured:** under v1 a long chat often holds one happy line and one grumble, so the flags stopped separating
  anything. On the same 60 conversations, the ones flagged both excited and frustrated fell from 15 to 1 going from v1
  to v4. On the full run of 2,362: both flags from 20.1% to 0.7%, excited 35.0% to 10.3%, frustrated 42.2% to 19.4%,
  help 51.1% to 36.3% (after the pricing relabel, D23: both 0.9%, excited 10.2%). A slice like "what are people
  frustrated about" now holds the conversations that are about it. The hand audit (docs/DATA.md) found 37 of 41 fired
  flags right.

## D17. Topics and flags stay two axes, and no topic duplicates a flag

- **Choice:** topics say what a conversation is about; flags say what kind of conversation it is (a bug report, a
  request, excitement, frustration, help, noise). Both are yes/no probabilities from the same Jev request. No topic
  may sit close to a flag, so the "bugs and performance" topic is removed (bugs are the `bug` flag only), and "Other
  games and off-topic" became "Other games", a subject only, leaving off-topic chatter to the `noise` flag.
- **Alternatives:** one flat list of labels, where a bug report is a label like any subject; or both axes with the
  overlapping topics kept, as first designed.
- **Why:** a question like "frustrations about Domains" crosses a subject with a kind, and a flat list has no subject
  axis to group by. Overlap is the other risk: two labels for one question disagree at the edges, and the agent then
  has two answers to "how many bug reports". The change was tested on 60 conversations before everything was
  relabelled.

## D18. Saved chats and a list of past chats, after a UX review

- **Choice:** a chat is saved and survives a reload through its URL (`/c/[id]`), with past chats listed in a
  sidebar. The `chats` table is in `db/app.sql`, apart from the build tables, so reloading the data keeps saved
  chats. The owner is an anonymous cookie id: no accounts, each browser sees its own history.
- **Alternative:** the first cut: no history, a chat lost on reload.
- **Why:** a review of the page as its user found no list of previous conversations. A community manager returns to an answer to quote it, and an answer that vanishes on reload cannot be shared or
  checked again.

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
- **Known debt:** the rule names the topics ("other", other games) in the prompt and the chart code, and the
  prompt's examples name the Domains and Ebontide. A relabel which renames or removes those topics would break the
  rule. The topic list the agent sees is read from the data on every
  request; the rule should read a "general" flag on the topic in the same way (README, Roadmap).
- **Held by code since v1.1:** production QA of `v1.0` found other games in an excitement answer (P6), GTA 6
  pricing in a frustrations answer (P2), and "other" and other games ranked in the frustrations chart (P5). The rule
  now holds in the scan and the claim check, not only in the prompt (D35), and the chart filter also covers
  frustration questions (`activity-words.ts`). A topic the label set leaves unnamed is shown by a name made from its
  key ("Other"), never the bare key (QA N6).

## D21. Embeddings: gemini-embedding-2, not embedding-001

- **Choice:** `gemini-embedding-2` at 768 dimensions on the provided key, documents as RETRIEVAL_DOCUMENT, questions
  as RETRIEVAL_QUERY, every vector L2-normalised in code (`ingest/embed.py`, `src/lib/data/embed.ts`).
- **Alternative:** `gemini-embedding-001`, the model the key's email named.
- **Why:** the key was probed on the newer models before choosing (D9). It serves both, and embedding-2 is the newer
  model; the ingest and query sides use the same model
  and settings. 768 dimensions keeps the index small. The two were not compared on this data.

## D22. Deploys are by hand, and production runs a tagged release

- **Choice:** Vercel git deploys are off (`vercel.json`); a production deploy is `vercel deploy --prod`, run by hand.
  Checked work was deployed until a freeze just before delivery; then production was frozen and tagged: `v1.0` is the
  deployed commit `2ae6130`. The fixes from its QA went out as release `v1.1`, commit `58a906f`. Commits after a tag
  change docs only.
- **The deployed commit is readable (since v1.1):** `/api/health` reports it, from `APP_COMMIT` set at deploy time
  (`vercel deploy --prod --yes --env APP_COMMIT=$(git rev-parse --short HEAD)`) or Vercel's own
  `VERCEL_GIT_COMMIT_SHA`, else "local" (`src/app/api/health/commit.ts`). Production reports `"commit":"58a906f"`.
  In `v1.0` every CLI deploy said "local", and the production QA could not tell which build it had tested (P16).
- **Alternative:** deploy on every push to `main`.
- **Why:** the capped key pays for every question the live app answers; nothing reaches it by accident on a push.
  The tag lets a reviewer read the exact code the live app runs, and the health check shows it is that code.

## D23. The pricing topic tightened after the hand audit

- **Choice:** `pricing-and-editions` counts only when the price or value of something is itself the subject; the
  description now says what does not count: a passing mention of buying, "DLC" as a name, in-game currency earned by
  playing, money idioms, money talk only in a context message. Every conversation was relabelled.
- **Alternative:** keep the audited description and call pricing counts an upper bound.
- **Why, measured:** the audit (docs/DATA.md) found 5 of 10 random pricing conversations right. The earlier, stricter
  wording had listed "purchases ... store items", Jev read the list as trigger words, and the share rose from 11.9%
  (v1) to 15.9%. With the exclusions spelled out it is 7.3%. The flag shares barely moved on the relabel (excited
  10.2%, frustrated 19.4%, help 36.3%, both excited and frustrated 0.9%). The new pricing labels were checked on 40
  conversations, not re-audited.

## D24. A follow-up's citations are checked against the whole chat

- **Choice:** a citation backs a claim if any tool, in this turn or an earlier one in the same chat, showed that
  message to the agent (`chatToolSteps` in `agent.ts`). A message no tool ever showed still backs nothing.
- **Alternative:** this turn's tool results only (the first rule).
- **Why:** QA (docs/QA.md, Q1): "which of those are bugs?" answered from the previous turn's reads, and the check
  failed every claim although the same messages had backed them one turn earlier. The guard that matters, that the
  agent cannot cite what it never saw, holds either way.
- **Changed in v1.1:** in `v1.0` a follow-up that called no tool and cited nothing was not checked at all (P3). Now
  a follow-up that names a slice, or asks for more on something the last answer said, must read on its first step
  (D36), and a turn with no tool call and no citation goes through the scope check (D37). A figure tagged as counted
  still needs a tool in this turn, whatever earlier turns counted (D38).

## D25. A sentence that lists several things must be backed whole

- **Choice:** a sentence that lists (a comma, "and", "or", "plus") is also asked whether one message backs all of it;
  otherwise two or more messages must each back part of it (`sideScore` in `verify.ts`).
- **Alternative:** any cited message that backs one item backs the sentence.
- **Why:** QA (Q3): "excited about pre-orders, New Game Plus, and new pets [msg1]" passed on a message that said only
  "pre order done".

## D26. The answer is the text after the last tool call (reverses an earlier rule)

- **Choice:** text the model writes before a tool call is a draft: it is neither shown nor checked. The page
  (`evidence.ts`) and the check (`finish.ts`) cut at the same place.
- **Alternative:** the earlier rule: show and check every step's text, joined.
- **Why:** that rule fixed claims that were shown but never checked, but it also kept drafts: in the eval (O02),
  "60/100 [aggregate]" written beside an out-of-scope call stayed in the answer, above the answer written after
  reading. Cutting at the last tool call keeps the check's guarantee and drops the draft.
- **Since v1.1, an empty step is asked again** (QA P1): a question opened from Explore came back with no words and no
  tool call, so the loop ended before its forced last step and the page said the answer was not finished; two of
  three runs of that question on Gemini 2.5 Flash were empty. A model step with no words and no tool call is asked
  again once, made to call a tool when it was offered tools (`retryEmpty` in `agent.ts`). A turn that still ends with
  no words is answered once from what the tools returned; with nothing read, that answer says what it could not
  establish.

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
- **Since v1.1:** the retry lives in `lib/llm/retry.ts`, shared with the claim check, which waits longer (D40).

## D29. A question is capped at 2,000 characters

- **Choice:** the text box stops at 2,000 characters and `/api/chat` refuses a longer question with a 413 and one line
  (`lib/question-limit.ts`).
- **Alternative:** no cap.
- **Why:** QA (Q6), found by reading the code: the public deploy would send a pasted 100k-character question to Gemini
  on the provided capped key. 2,000 is room for a question with a quoted message in it, not for a pasted document.

## D30. The community is named "the Veil of Ages Discord"

- **Choice:** prose (the welcome heading, the agent's profile, the out-of-scope reply) says "the Veil of Ages
  Discord"; the export's "(Levellr sample)" is dropped (`lib/community.ts`).
- **Alternative:** the dataset's name as exported.
- **Why:** QA (Q7): "What is Veil of Ages Discord (Levellr sample) talking about?" is a file name, not how the team
  speaks about its community.

## D31. Explore: the grid is live, topic editing is held back on a branch

- **Choice:** Explore's topic x time grid (read-only) is on `main` and in production. Topic editing with a priced
  relabel and backfill is built on the branch
  [`explore-topic-editing`](https://github.com/avshalomd/levellr-take-home/tree/explore-topic-editing) and was held
  back from `main` on purpose.
- **What it does:** in Explore the team adds, renames, redefines, combines or removes topics. A rename or a combine
  applies at once. Adding or redefining a topic shows a price first; on confirm, Jev asks that one topic's yes/no
  question of every conversation and backfills the probabilities, in resumable batches, under a spend cap the team
  sets. Removing a topic is free.
- **What it costs:** the branch prices a relabel before any call as conversations x (state + question + call
  overhead) tokens at Jev's $0.042 per million input tokens (`estimate` in `src/lib/labels/taxonomy.ts` on the
  branch). With this data's mean state of 1,321 characters and the current topic descriptions, re-asking one topic
  of all 2,362 conversations comes to 1.30 to 1.55 million tokens, **about $0.06**, a formula result that no run has
  checked yet. The measured upper bound is a full labelling run, every topic, flag and sentiment in one request per
  conversation: $0.23 to $0.24 for each of the three runs recorded in `data/work/labels.jsonl`.
- **Alternative:** merge it untested, or leave Explore out.
- **History:** the grid went to production first. A check of how the relabel and backfill had been tested found they
  had never run against a database, so all writes to Neon stopped. Adding untested writes to production just before
  delivery was not worth the risk; editing is the first roadmap item instead, with the reason Jev was chosen (D6).
- **Why:** the grid only reads the labels; editing writes them. Its tables (`npm run db:app`) and any relabel would
  run against the one Neon database, which production shares, and no Neon branch could be made to test on before
  delivery. Code that has never run does not go to `main` (D1). The steps to finish it are the first item of the
  README's roadmap.

## D32. The evidence view is a reply tree

- **Choice:** a citation chip opens its conversation drawn as a reply tree: reading order across, reply depth down.
  A session's top-level messages hang from one node for the conversation; replies nest beneath the message they
  answer; the cited messages are numbered like their chips and lit; a parent carried in from an earlier piece (D4) is
  drawn hollow and faint (`ThreadMap.tsx`, `thread-tree.ts`).
- **Alternative:** the first picture, a timeline of dots with arcs for replies. A review of the evidence panel found
  it not good enough, and the reply tree replaced it.
- **Why:** 37% of messages are replies, and one piece often holds several short exchanges. The tree
  shows who answered whom and where the cited message sits in its exchange, which a flat timeline hides.

## D33. The repo and the app are public

- **Choice:** the GitHub repo is public, and the Vercel deployment has Deployment Protection off, so the live URL
  opens without a login.
- **Alternative:** a private repo shared by invitation, and a protected deployment.
- **Why:** this is a take-home, and both can be taken down once the review is done. A reviewer can open the code and ask the live app a question without an account. The cost is that every
  question spends the provided capped key, which the README says next to the URL; the question length cap (D29)
  keeps a pasted document off it.

## D34. The model is sent the last 6 answered exchanges (v1.1)

- **Choice:** with a new question, the model is sent the last 6 questions that got an answer, each followed by that
  answer (`chatWindow` in `src/app/api/chat/turn.ts`). The window always starts at a question. A question whose answer
  has no words (it failed, or was stopped) is left out with it. Only the last answer keeps its tool results in full,
  so "which of those are bugs?" can answer from them; the earlier answers are sent as the words the reader saw
  (`slimWindow`). The checks after the agent still read the whole window with its tool results, and the claim check
  every tool result in the chat (D24). A provider's refusal is shown as one plain line, and its reason is logged.
- **Alternatives:** the `v1.0` rule, the last 12 messages of the chat; or send only the new question and the chat id
  and read the history from the saved chat on the server.
- **Why:** in `v1.0`, from the 7th question on, the 12-message window could open on an answer, and an answer from the
  data opens with a tool call, which Gemini refuses unless a question comes before it (QA P18: questions 7 and 9 of a
  nine-question chat failed, and "Try again" failed the same way). Six exchanges keep the same reach as twelve
  messages. An answer with a scan carries 130 to 530 KB of tool results, and each later request sent them all again
  to the model. Reading the history on the server is the better fix, since it also stops the request from growing;
  it is the second roadmap item, because the client still sends the whole chat (QA N4: 1,264 KB after 12 turns, so
  Vercel's 4.5 MB request limit is about 40 such turns away).

## D35. What excites or frustrates people is kept to the community's own games, in the scan and the check (v1.1)

- **Choice:** for a question about what excites or frustrates people, what resonates, or what to post (unless it
  asks about other games or off-topic talk itself), two reads ask whether the talk is about the community's own games,
  named by `dataset_meta.mood_target`, the sentiment target of D7:
  - the scan asks Jev, in the same call as relevance, whether what the conversation says on the question is about
    those games; one that bears on the question but is about something else is left out and counted apart, and the
    tool output tells the model how many were left out (`scan.ts`);
  - the claim check asks, in the same call per claim, whether each cited message is clearly about something else
    (another game, a film or show, hardware, life outside the games); such a citation backs nothing, and the rewrite
    is told why (`verify.ts`).
  No Jev call is added: each is one more question in a call that was made anyway.
- **Alternatives:** the `v1.0` rule, in the instructions only (D20); or leave out conversations by topic label, for
  example every one labelled "Other games".
- **Why:** the prompt rule did not hold. Production QA of `v1.0` found a frustrations answer whose pricing section
  was built on #off-topic talk about GTA 6 prices, with all 18 claims passed (P2), and an excitement answer that ended
  on other games' releases (P6). A topic label is the wrong filter: a conversation can carry several topics (588 of
  2,362 sit in two or more, docs/anatomy.html), and a topic misses a clear subject in about 1 in 5 conversations (docs/DATA.md). The games are
  read from the data, so this rule adds no topic or game name to the code. In the release-candidate QA, the top
  frustrations answer had no GTA 6 and no pricing section, and the excitement answer said other games were left out.

## D36. Some questions must read on their first step (v1.1)

- **Choice:** the agent's first step is made to call a tool (`prepareStep` in `agent.ts`) when:
  - a follow-up names a kind of conversation, a topic or a period ("which of those are bugs?", "and last week?"):
    any tool but `out_of_scope` (`asksForSlice` in `flags.ts`; P3);
  - a follow-up asks for more on something the last answer said ("tell me more about the second one", "details",
    "why?"): `read_conversation`, `find` or `scan` (`asksForMore`; B1);
  - a question asks for a number ("how many", "share", "average"): any tool, `out_of_scope` included, since revenue
    is a number too (eval A06).
  Two rules act later in the turn: a turn that has only counted must read before it answers a question about what
  people say (from `v1.0`), and a turn whose `out_of_scope` call the scope check turned down must scan or find on its
  next step, once (eval O02). Every way of asking for post ideas names the `excited` kind, so its read is not refused.
- **Alternative:** instructions only, as in `v1.0`.
- **Why:** each rule answers a turn that answered without reading. "Which of those are bugs?" answered "none are
  bugs" with no tool call, no citation and no check (P3). "Tell me more about the second one" restated an earlier
  turn's "56 bug reports" and "47/100" for a slice they did not describe (B1). "How many conversations were about
  pricing last month?" gave a figure tagged `[aggregate]` that nothing had counted (A06). "What is the sentiment on
  Reddit about Tides Remastered?", once the scope check kept it, was answered with no read, a mood tagged
  `[aggregate]` that nothing had counted, and four made-up message handles (O02). The O02 read is forced once: forced
  on every step with every tool offered, a question about DMs called `dataset_overview` six times. The instructions still say the same things; the code makes
  the first step hold. The cost is one read on every follow-up of these kinds, even one the last answer could have
  answered.

## D37. One scope check on every turn, and a net in code (v1.1)

- **Choice:** every turn's scope check reads the question with the reader's question before it (`turnBearsOn` in
  `scope.ts`), so a follow-up ("tell me more", "why?") bears on the conversations as the question it follows did.
  `out_of_scope` goes through it, as before. A net after the agent (`finish.ts`): a turn that called no tool and cites
  nothing is put to the same check, one Jev call, and a question the conversations do not bear on (under 0.5) gets the
  reply written in code, with its three suggested questions, in place of what the model wrote. A check that fails
  leaves the answer as it is. The instructions also say `out_of_scope` is the only way to decline, in every turn.
- **Alternative:** the `v1.0` rule: the check ran only when the model called `out_of_scope`, and the question was
  read alone.
- **Why:** QA N1: after three questions, "Can you write me a poem about pirates?" got a 12-line poem with no tool
  call and no check, and a mid-chat weather question was declined in the model's own words with no suggestions; in a
  fresh chat both got the proper reply. Measured on Jev with the earlier question: follow-ups 0.84 to 0.89; a poem,
  the weather, the World Cup and a code request 0.02 to 0.05. "Thanks!" scored 0.24, so a thank-you answered with no
  tool call gets the out-of-scope reply too.

## D38. A figure tagged as counted is backed only by this turn's tools (v1.1)

- **Choice:** a figure tagged `[scan]`, `[aggregate]` or `[voices]` is backed only when that tool ran in this turn
  (`toolsRan(turn.steps)` in `finish.ts`). Otherwise its claim fails with a note, the one rewrite is told to drop the
  figure or give the one a tool gave this turn, and it is kept only with fewer such figures; what is left is named
  under the answer. Citations from earlier turns still verify (D24).
- **Alternative:** the `v1.0` rule, a tool of that name having run anywhere in the chat (D11).
- **Why:** QA B1: "tell me more about the second one", after a Domains answer, called no tool and wrote "among the 56
  bug reports about the Domains ... 47/100 [scan]". Both numbers came from an earlier read of every topic since 24
  Sep; SQL gives 114 Domains conversations flagged as bugs from 13 to 27 Sep. The tag passed because a scan had run
  in the chat. A tag says "counted for this answer, over the slice it names"; a count carried over from another turn
  is not that.
- **Limit:** a restated figure with no tag is caught only when it sits in a cited claim that neither its messages nor
  a tool result backs (D11).

## D39. A step keeps each tool call once, at most six (v1.1)

- **Choice:** each model step keeps each distinct tool call (same tool, same input) once, only calls to a tool the
  step was offered, and at most 6; the rest are dropped before anything runs, and the drop is logged (`oneCallEach`
  in `agent.ts`). Streamed, a call's input is held until the call arrives, so a dropped call draws nothing.
- **Alternative:** rely on the step cap (8 steps), which bounds steps, not calls in a step.
- **Why:** during the v1.1 eval, with the post question made to call `aggregate` alone on its first step, Gemini 2.5
  Flash wrote 1,085 and then 1,232 `aggregate` calls in one step, two identical calls repeated, and the turn ran four
  minutes. The forced count was removed (D13), and the cap stops any repeat of it. Six is a round bound, not a
  measured one.

## D40. The claim check retries a busy Jev call, with longer waits (v1.1)

- **Choice:** a claim-check call that fails with a rate limit, a server error or a timeout is tried again after 1, 3,
  8 and 15 seconds, each with ±25% jitter (`CHECK_RETRY_MS` in `verify.ts`). The retry helper moved to
  `lib/llm/retry.ts`, shared with corroboration (D28) without an import cycle. A claim still refused is shown as not
  checked, never as unbacked.
- **Alternatives:** no retry, as in `v1.0`; corroboration's shorter waits (0.4, 1.2 and 3 s); a second route to Jev
  (direct TypeSafe is out of credit, so there is none).
- **Why:** every Jev call shares OpenRouter's pool for the model. With no retry, the release-candidate eval run left
  24 of 169 cited claims unchecked. With the short waits, the full v1.1 run still left 18 of 154: the pool's per-minute
  limit outlasted about 5 seconds of retries. With the long waits, a rerun of 11 questions left none unchecked (67 of
  68 backed). The cost: a turn whose check meets a busy pool can wait up to about half a minute longer.

## D41. An Explore row opens its session in the reply tree (v1.1)

- **Choice:** a "Busiest sessions" row in Explore opens that session in the evidence panel's reply tree, one
  conversation at a time with next and previous; Esc or the scrim closes it back to the selection
  (`SelectionPanel.tsx`, `EvidenceSheet.tsx`). The list is headed "Busiest sessions", and a long one says "116
  messages in 4 conversations". The panel's tab names the first cited message, and its heading is labelled as the
  conversation's opening ("Opens with ...").
- **Alternative:** the `v1.0` row, which asked the chat "What did people say in conv1268 in #remaster-discussion?".
- **Why:** QA P1: that question showed an internal handle in the question, the chat title and the sidebar, and the
  model answered it with nothing, two runs out of three. A row is a request to read a session, not a question for the
  agent, so it opens the session directly and spends no model call. The rows were sessions labelled as conversations,
  with up to 195 messages beside a legend that caps a conversation at 40 (P15), and a cited reply read as the
  conversation's first line (P14).

## D42. The support question also fails a changed meaning (v1.1)

- **Choice:** the claim check asks whether the message supports the claim "with the same meaning", and says it does
  not when the claim changes or adds to what the message says: a stronger or different judgement ("too easy" for "not
  a fair challenge"), a reason or detail the message does not give, or the meaning of an abbreviation or a name it
  does not spell out (`SUPPORT_QUESTION` in `verify.ts`).
- **Alternative:** the `v1.0` question, which asked for support and ruled out the opposite and a mere shared subject.
- **Why:** QA P9: paraphrases passed with their meaning shifted: "it isn't challenging" for a message meaning the mode
  is not a fair challenge, and "'BF' (Bushido Final update)", a gloss the message never gives. The release-candidate
  QA still saw a claim that says more than its cited message pass (D12, known gap).

## D43. A change between periods reads "up 51%" (v1.1)

- **Choice:** a count's change between periods reaches the model as a direction word and an unsigned figure ("up
  51%", "down 12%", "no change"), and the instructions say "rose 51%", never "rose by +51%" (`trends.ts`). A chat
  saved with the signed form still parses.
- **Alternative:** the `v1.0` signed figure, "+51%" or "−12%".
- **Why:** QA P17: given "+51%", the answer wrote "rose by +51%". The rate check compares the direction the answer
  states with the one the count gave, so the words must carry it.

## D44. A period outside the data is said to be outside it (v1.1)

- **Choice:** when a count or a read asks for a period outside the conversations (13 to 27 Sep), the tool result
  says first that it is outside them, and that nothing in it could be counted, which is not the same as none
  (`outsideWords` in `for-model.ts`). The answer's first sentence says the conversations do not cover that period, then
  gives the nearest count they do cover, said as such. A period partly outside is answered for the days inside.
- **Alternative:** the `v1.0` behaviour: an empty count, which the model read as zero.
- **Why:** QA P10: "How many conversations were about pricing last month?" was answered "there are no conversations
  about pricing from last month", as if August had been read and found empty. In the release-candidate QA the answer
  was "The conversations do not cover last month. From 13 Sep to 27 Sep, there were 173 conversations about Pricing,
  editions and monetisation."
