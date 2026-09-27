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
  against this data, and code for features not built tonight (saved chats, Explore, relabelling) was left out, so the
  repo holds nothing nobody can explain.

## D2. "Now" is the last message

- **Choice:** now = 2026-09-27 19:30Z, the last message in the export. "The last 3 days" = 09-24 19:30Z to 09-27
  19:30Z. The agent's instructions state it, and answers name the window they used.
- **Alternative:** the server's clock.
- **Why:** the export is a snapshot; against the wall clock every relative question would come back empty or wrong
  the day after it was sent.

## D3. The unit: pause-split sessions, long ones cut into pieces (chosen by the human)

- **Choice:** inside each channel, a new conversation starts after a 15-minute pause. A long session is cut
  into pieces of 20-40 messages, each cut placed at the longest pause in that range. **The human chose this** after
  reviewing the session shapes the coding agent measured.
- **Alternatives, measured:**
  - Reply trees only: 63% of messages are not replies, so they would belong to no conversation.
  - Reply trees merged into the sessions: groups of up to 2,000 messages, too big to read or label.
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
- **Topics:** a Gemini Flash-Lite pass over a 300-conversation, channel-stratified sample suggested a label set; **the
  human edited it**: Bushido split into the final update, Domains, and Ebontide and new quests; bugs and performance
  and pricing and editions added; a generic "community chat" topic dropped. 13 topics plus "other".
- **Alternative:** one topic per conversation as a hard verdict, or free-text tags from an LLM.
- **Why:** a conversation often touches two subjects; a verdict hides how sure the label is; free tags cannot be
  counted. Kept from the reference (D12, D17, D46).

## D7. Sentiment towards the games and their developer (simplified by the human)

- **Choice:** sentiment is measured towards "the Veil of Ages games and their developer", 0 to 1.
- **Alternative:** general mood of the conversation (the first proposal was more elaborate).
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
  Whether each half of hybrid and the rerank earn their place is measured in `eval/retrieval.ts` (README, Eval).

## D11. Numbers come from code

- **Choice:** the agent reaches data only through typed tools; every count it states comes from SQL. Aggregate
  questions in the eval are graded against SQL run at eval time.
- **Why:** models miscount; a community manager will repeat the number in a meeting.

## D12. The claim check

- **Choice:** citations are short handles the app issues (`[msgN]`). Every cited sentence is checked: the id exists,
  it was read this turn, and Jev says the message supports the sentence. A weak sentence is rewritten once, and the
  rewrite is kept only if it scores better. The result is shown under the answer.
- **Alternative:** trust the model's citations.
- **Why:** grounding is what the reviewers weigh most, and a citation that does not support its sentence is worse
  than none. Kept from the reference (D11, D14, D15).

## D13. "What should we post?" is answered as suggestions

- **Choice:** post ideas rest on cited, recent, high-engagement, excited conversations, and are labelled as
  suggestions, not findings.
- **Why:** the data shows what people talk about; what to post is a judgement the tool can support, not a fact.

## D14. UI cuts

- **Cut:** saved chats and the chat sidebar, Explore (topic x time grid), topic editing and relabelling, login.
- **Kept:** the chat page with streaming answer, citation chips, the one-line "what the agent did" with steps a click
  away, the verification, and the evidence panel that opens a cited conversation with the cited messages lit.
- **Why:** the reviewers weigh retrieval and answer quality; the minutes went to the LLM path.

## D15. Data stays out of git

- **Choice:** `data/messages.json` and everything derived from it (`data/work/`) are gitignored; the pipeline reads
  and writes them locally and loads Neon directly from the laptop.
- **Why:** the messages are the client's, even pseudonymised. Loading from the laptop also avoids the 4.5 MB request
  limit of a Vercel function.
