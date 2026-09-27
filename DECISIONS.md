# Decisions

Each choice, the alternative, and why. Written during the 90-minute build. Where the human overruled or changed what
the coding agent proposed, it says so. The numbers are measured on this dataset (docs/DATA.md), none are carried over
from the rehearsal.

## D1. Reuse the rehearsal app's code

- **Choice:** copy code from Community Pulse, an app I built beforehand to rehearse this exact task on other
  community data (a subreddit), frozen at commit `90f193d`. Copied: the Python ingest pipeline (normalize, group,
  sample, suggest, enrich, embed, load, budget), the data layer and its tools, the agent, the claim check, the chat
  page and the eval runners. Changed only what this brief and this data need: a Discord adapter, reactions instead
  of votes, this community's topics, flags for "excited" and "frustrated", Gemini instead of OpenRouter models.
- **Alternative:** write it fresh in 90 minutes.
- **Why:** the brief scores choices and a working, grounded chatbot; 90 minutes buys a thin slice from scratch. The
  rehearsal's pieces were already debugged against real questions. Every carried-over decision below was re-checked
  against this data, and code for features not built tonight (Explore, relabelling) was left out, so the repo holds
  nothing nobody can explain. Saved chats were cut at first and have been restored (D18).

## D2. "Now" is the last message

- **Choice:** now = 2026-09-27 19:30Z, the last message in the export. "The last 3 days" = 09-24 19:30Z to 09-27
  19:30Z. The agent's instructions state it, and answers name the window they used.
- **Alternative:** the server's clock.
- **Why:** the export is a snapshot; against the wall clock every relative question would come back empty or wrong
  the day after it was sent.

## D3. The unit: pause-split sessions, long ones cut into pieces (chosen by the human)

- **Choice:** inside each channel, a new conversation starts after a 15-minute pause. A session over 40 messages
  is cut into pieces: each cut goes at the longest pause between 20 and 40 messages from the piece's start, and the
  last piece keeps the remainder (51 of the 553 cut pieces are under 20; `ingest/group.py`). The result: 1,933 sessions,
  2,362 conversations, median 4 messages, at most 40. **The human chose this** after reviewing the session shapes the
  coding agent measured.
- **Alternatives, measured:**
  - Reply trees only: 63% of messages are not replies, so they would belong to no conversation.
  - Reply trees merged into the sessions: replies link sessions into chains, and the largest group holds 1,989
    messages, too big to read or label.
  - Fixed windows of 30 messages (the first design): cuts through the middle of an exchange and leaves stubs.
- **Why:** 159 sessions over 30 messages hold 67% of all messages, and the subject drifts about every 30 minutes
  inside them (docs/DATA.md). Pieces cut at the longest pause follow the natural breaks, stay small enough for one
  Jev read, and keep each message in exactly one conversation, so counts never double.
- **Next step:** semantic segmentation (cut where the subject changes, not where the pause is longest).

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
  removed** bugs and performance (D17), leaving 12 topics plus "other" (`data/work/topics.json`).
- **The pricing topic was tightened after the hand audit** (D23). The final set, with each description and share, is
  in "Label set" below.
- **Alternative:** one topic per conversation as a hard verdict, or free-text tags from an LLM.
- **Why:** a conversation often touches two subjects; a verdict hides how sure the label is; free tags cannot be
  counted. Kept from the reference (D12, D17, D46).

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

- **Agent model, chosen by the human:** Gemini 2.5 Flash over 3.8 Flash, to protect the capped key's quota. One env
  var (`AI_MODEL`) switches it.
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
  The "too broad" branch refuses a slice over 2,500 conversations with a breakdown by topic and week; this dataset
  has 2,362, so on it the branch never fires, and it is there for a bigger export.
  Whether each half of hybrid and the rerank earn their place is measured in `eval/retrieval.ts` (README, Eval).
  End to end (`eval/results/agent.json`, 18 questions, agent Gemini 2.5 Flash, judge Flash-Lite): 11 correct, 1
  partial, 6 wrong, score 0.64; lookups 0.92, frustrated 1, what-to-post 1, aggregates 0.67, temporal 0.5, excited 0,
  false premises 0 of 2, out of scope 0.5. It declined 1 of the 4 questions it should have, and none of the 14 it
  should not. Latency p50 8.1 s, p90 18.3 s. Abstention is the weak spot.

## D11. Numbers come from code

- **Choice:** the agent reaches data only through typed tools; every count it states comes from SQL. Aggregate
  questions in the eval are graded against SQL run at eval time: in the end-to-end run of 2026-09-27
  (`eval/results/agent.json`) the three aggregates scored 0.67.
- **Also:** after the answer, every figure in a cited claim that neither its messages nor any tool this turn contains
  is flagged (`unbackedFigures` in `src/lib/agent/verify.ts`).
- **Why:** models miscount; a community manager will repeat the number in a meeting.

## D12. The claim check

- **Choice:** citations are short handles the app issues (`[msgN]`). Every cited sentence is checked: the id exists,
  it was read this turn, and Jev says the message supports the sentence (p >= 0.5). Weak sentences are rewritten once
  (Flash-Lite), and the rewrite is kept only if it is at least as well supported, still cites, and states no more
  unmatched figures than before (`revise.ts`). Then every cited claim is put to all the conversations the turn found
  relevant, so the answer can say how many back it, not only the two or three it cites (`corroborate.ts`). The result
  is shown under the answer. In the end-to-end eval (18 questions), 68 of 72 checked citations were supported (94%)
  and none pointed at a message that does not exist.
- **Alternative:** trust the model's citations.
- **Why:** grounding is what the reviewers weigh most, and a citation that does not support its sentence is worse
  than none. Kept from the reference (D11, D14, D15).

## D13. "What should we post?" is answered as suggestions

- **Choice:** post ideas rest on cited, recent, high-engagement, excited conversations, and are labelled as
  suggestions, not findings.
- **Why:** the data shows what people talk about; what to post is a judgement the tool can support, not a fact.

## D14. UI cuts

- **Cut:** Explore (topic x time grid), topic editing and relabelling, login. Saved chats and the chat sidebar were
  cut at first and have been restored (D18).
- **Kept:** the chat page with streaming answer, citation chips, the one-line "what the agent did" with steps a click
  away, the verification, and the evidence panel that opens a cited conversation with the cited messages lit.
- **Why:** the reviewers weigh retrieval and answer quality; the minutes went to the LLM path.

## D15. Data stays out of git

- **Choice:** `data/messages.json` and everything derived from it (`data/work/`) are gitignored; the pipeline reads
  and writes them locally and loads Neon directly from the laptop.
- **Why:** the messages are the client's, even pseudonymised. Loading from the laptop also avoids the 4.5 MB request
  limit of a Vercel function.

## D16. Flags mean a main thread, not anyone

- **Choice:** `excited`, `frustrated` and `help` ask whether that feeling or request is a main thread of the
  conversation (more than a passing remark; in a one- or two-message conversation, the message itself), not whether
  anyone in it shows it. `bug` covers defects, crashes and performance. The wording is in `ingest/flags.py` (v4).
- **Alternative:** the first wording (v1), "does anyone ...".
- **Why, measured:** under v1 a long chat often holds one happy line and one grumble, so the flags
  stopped separating anything. On the same 60 conversations, the ones flagged both excited and frustrated fell from 15
  to 1 going from v1 to v4. On the full run of 2,362: both flags from 20.1% to 0.7%, excited 35.0% to 10.3%,
  frustrated 42.2% to 19.4%, help 51.1% to 36.3%. A slice like "what are people frustrated about" now holds the
  conversations that are about it. The hand audit (docs/DATA.md, on the v4 labels) found 37 of 41 fired flags right.
  After the pricing fix re-ran every label (D23) the flag shares barely moved: both 0.9%, excited 10.2%, frustrated
  19.4%, help 36.3%. **The human chose
  the v4 wording** after this A/B.

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
- **Alternative:** keep the cut from D14 and lose a chat on reload.
- **Why:** reviewing the page as its user, **the human asked for it back**: a community manager returns to an answer to
  quote it, and an answer that vanishes on reload cannot be shared or checked again.

## D19. Engagement is a score, never a count

- **Choice:** the agent writes engagement as "an engagement score of N", with the number of conversations behind it
  taken from the count beside it; the tool output says so on every row (`for-model.ts`, `instructions.ts`).
- **Alternative:** let the model phrase the figure freely.
- **Why:** engagement is authors + replies + reactions summed over conversations (D5). Written bare, the model read it
  as a number of conversations or people, which is a wrong fact a reader would repeat.

## D20. General gaming talk is left out of what excites and what resonates

- **Choice:** for "what are people excited about", "what is resonating" and "what should we post", the agent leaves
  the "other" topic, the "other games" topic and chatter not about the games out of the ranking, unless the question
  asks for them, and may say so in one clause (`instructions.ts`).
- **Alternative:** rank everything the flag or the engagement score picks up.
- **Why:** the user is the studio's team: excitement about another franchise or a hardware purchase is real in the
  data but says nothing about their games, and would crowd the ranking (other games touch 17.1% of conversations).

## D21. Embeddings: gemini-embedding-2, not the brief's embedding-001

- **Choice:** `gemini-embedding-2` at 768 dimensions on the brief's key, documents as RETRIEVAL_DOCUMENT, questions as
  RETRIEVAL_QUERY, every vector L2-normalised in code (`ingest/embed.py`, `src/lib/data/embed.ts`).
- **Alternative:** `gemini-embedding-001`, the model the brief named.
- **Why:** the key serves both; embedding-2 is the newer model and the one the reference pipeline and its query side
  already use, so both carried over unchanged. 768 dimensions keeps the index small. The two were not compared on
  this data; the retrieval eval measures only the model used (README, Eval).

## D22. Deploys are by hand

- **Choice:** Vercel git deploys are off (`vercel.json`); a production deploy is `vercel deploy --prod`, run when
  **the human decides**.
- **Why:** the capped key pays for every question the live app answers; nothing reaches it by accident on a push.

## D23. The pricing topic tightened after the hand audit

- **Choice:** `pricing-and-editions` counts only when the price or value of something is itself the subject; the
  description now says what does not count: a passing mention of buying, "DLC" as a name, in-game currency earned by
  playing, money idioms, money talk only in a context message. Every conversation was relabelled.
- **Alternative:** keep the audited description and call pricing counts an upper bound.
- **Why, measured:** the audit (docs/DATA.md) found 5 of 10 random pricing conversations right. The earlier, stricter
  wording had listed "purchases ... store items", Jev read the list as trigger words, and the share rose from 11.9%
  (v1) to 15.9%. With the exclusions spelled out it is 7.3%. The new labels were not re-audited by hand.

## Label set (final labels, 2,362 conversations, p >= 0.5)

Every conversation is labelled once by Jev (D6): a yes/no probability per topic, sentiment, and six flags. Shares
are measured in Neon on the final labels (after the pricing fix, D23). A conversation can carry several topics and
flags, so the shares do not sum to 100%; "other" means no topic reached 0.5.

**Topics** (`data/work/topics.json`)

| topic | key | description | share |
|---|---|---|---|
| Lore and story | `lore-and-story` | The series' narrative, characters, historical settings and modern-day plot, discussed as story. Not gameplay, builds or difficulty that happen to name a character (Kano and Hana are playable characters). | 17.7% |
| Other games | `other-games-off-topic` | Other franchises (GTA, Witcher, etc.), general gaming news, and gaming or PC-hardware talk that is not about Veil of Ages. | 17.1% |
| Series direction | `series-direction` | Only when people argue about where the franchise is going or compare the games as a whole (stealth versus RPG, rankings, tier lists, the studio's choices). Not every mention of an older game. | 13.1% |
| Classic games | `classic-games` | Playing the older titles such as Bastion, Legion, Requiem, Empire and the original Tides. | 10.7% |
| Tides Remastered | `tides-remastered` | The upcoming Tides Remastered: reveals, trailers, changes from the original Tides, release date, pre-orders, the Twitch drop. | 10.0% |
| Domains | `domains` | Bushido's rogue-lite Domains mode: difficulty tiers, domain bosses, runs, builds, perks and gear for Domains. | 9.4% |
| Pricing, editions and monetisation | `pricing-and-editions` | Only when the price or value of something is itself the subject: what it costs, whether it is worth the money, which edition, pack or DLC to buy and what it includes, sales and discounts, microtransactions and the real-money store. Not a passing mention of buying or owning something, not 'DLC' used as a name, not in-game currency earned by playing, not money idioms, and not when the money talk is only in a (context) message. | 7.3% |
| Bushido final update | `bushido-final-update` | The final content update for Veil of Ages Bushido (the current game): what it adds, rewards, patch notes, platform availability such as Switch; not Domains or Ebontide specifically, which have their own topics. | 6.1% |
| RPG-era games | `rpg-era-games` | Playing the RPG-era titles Sands, Hellas and Fjord: levelling, gear, builds, exploration. | 4.3% |
| Multiplayer and co-op | `multiplayer-and-co-op` | Looking for group, co-op sessions and multiplayer in any Veil of Ages game. | 4.1% |
| Ebontide and new quests | `ebontide-and-new-quests` | The Ebontide quest and other new story quests or missions added to Bushido. | 1.2% |
| Hollow and future titles | `hollow-and-future-titles` | Only conversations that name Veil of Ages: Hollow or speculate about games after it. Not Tides Remastered or any other upcoming release that has its own topic. | 0.8% |
| Other | `other` | None of the other topics fits. | 36.4% |

**Flags** (`ingest/flags.py`, the question Jev answers for each)

| flag | question | share |
|---|---|---|
| excited | Is excitement, hype or enthusiasm about the games, an update, an announcement or an event a main thread of this conversation (more than a passing remark; in a one- or two-message conversation, the message itself)? | 10.2% |
| frustrated | Is frustration or dissatisfaction with the games, an update, or the company or people behind them a main thread of this conversation (more than a passing remark; in a one- or two-message conversation, the message itself)? | 19.4% |
| bug | Does anyone report a defect, crash or performance problem (something broken or behaving wrongly), as opposed to disliking a design choice or finding something hard? | 14.0% |
| feature | Does anyone ask for a change or an addition to a game (a feature request or a concrete suggestion)? | 13.3% |
| help | Is asking the community for help, advice or an explanation a main thread of this conversation? A practical question about playing, fixing or finding something that someone answers counts, even in a longer chat; opinion questions, rhetorical questions and banter do not; in a one- or two-message conversation, the message itself. | 36.3% |
| noise | Is this conversation noise for a community manager: jokes, memes, one-word reactions or off-topic chat with no feedback, question or information about the games? | 35.2% |

**Sentiment** is measured towards "the Veil of Ages games and their developer" (D7), 0 to 1.
