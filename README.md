# Community Pulse for Levellr

A chatbot for a game studio's Community & Marketing Manager: ask what the Veil of Ages Discord is excited about,
frustrated by, or saying about an update, and get an answer grounded in the messages, each claim linked to the
message behind it and checked, or a plain "the data cannot answer that".

**Live:** https://levellr-take-home.vercel.app (public; every question spends the brief's capped Gemini key)

## The unit, and what it cannot count

- **A message** is one Discord message (channel, pseudonymous author, UTC time, reactions, reply parent). It is what
  answers cite.
- **A conversation** is a piece of one channel's activity: split at 15-minute pauses; a session over 40 messages is
  cut at its longest pause 20-40 messages in, repeatedly, and the last piece keeps the remainder. It is what the agent
  searches, reads, labels and counts. Every message is in exactly one conversation. **2,362 conversations**: median 4
  messages, p90 33, max 40.
- **Now** is the last message, 2026-09-27 19:30 UTC. "The last 3 days" means 09-24 19:30 to 09-27 19:30 UTC.
- **It cannot count:** anything outside these 11 channels (Reddit, Steam reviews, sales, revenue), anything before
  2026-09-13, readers who never wrote, reach (reactions are on 4.5% of messages, at most 8), or intent beyond the
  words. A count of conversations is not a count of people; answers say which unit a number is in.

The data profile is in [docs/DATA.md](docs/DATA.md): 25,555 messages, 795 authors, 11 channels, two weeks.

## Run it

```bash
npm install
# .env.local needs:
#   DATABASE_URL, DATABASE_URL_UNPOOLED   Neon Postgres with pgvector (vercel env pull .env.local)
#   GOOGLE_GENERATIVE_AI_API_KEY          the brief's Gemini key: agent, embeddings, bulk text, eval judge
#   OPENROUTER_API_KEY                    Jev (typesafe/jev-1.13): labels, rerank, scan, claim check
#   AI_MODEL=gemini-2.5-flash             the agent model (optional)

# build the dataset (Python 3.12 + uv), from data/messages.json
cd ingest
uv run python build.py ../datasets/levellr.json                          # normalize + group into conversations
uv run --env-file ../.env.local python enrich.py --concurrency 16        # Jev labels: topics, sentiment, flags
uv run --env-file ../.env.local python embed.py                          # gemini-embedding-2, 768 dims
uv run --env-file ../.env.local python load.py                           # COPY into Neon, build indexes
cd ..
npm run db:app                  # the app's tables: saved chats, topic edits, relabel jobs, spend
npm run labels -- seed-spend    # once per build: ingest's cost counts against the same $3 cap as relabels

# topics edited in Explore live in the taxonomies table; load.py labels from data/work/topics.json. Before a reload,
# write the active set there, then run enrich.py and load.py as above (a changed set is asked again):
npm run labels -- export

npm run dev                     # http://localhost:3000
npm run check                   # types, lint, unit tests
npm run eval:retrieval          # retrieval arms -> eval/results/retrieval.json
npm run eval:agent              # end to end (spends agent quota) -> eval/results/agent.json
npm run eval:report             # eval/results/report.md
```

## How it works

```
data/messages.json
  -> ingest/ (Python)  normalize -> group into conversations -> Jev labels (probabilities) -> embeddings -> Neon
Neon Postgres: messages, conversations (labels, engagement, tsvector, vector(768)), dataset_meta

browser -> /api/chat -> ToolLoopAgent (Gemini Flash, step cap with a forced final answer)
             tools: overview · scan (Jev reads a whole slice) · find (keyword + vector, RRF, Jev rerank)
                    aggregate (SQL counts) · read_conversation · voices · out_of_scope
          -> claim check: each cited sentence -> id exists, read this turn, Jev says it supports -> one rewrite if weak
          -> streamed answer, citation chips, "what the agent did", verification, evidence panel (thread with cited
             messages lit)
```

## Key decisions

All with alternatives and reasons in [DECISIONS.md](DECISIONS.md). The short version:

1. **Reused my rehearsal app** (Community Pulse, built beforehand on other community data) and re-checked each of
   its decisions against this data (D1).
2. **The unit is a pause-split conversation piece**, chosen after measuring reply trees and fixed windows (D3).
3. **"Resonating" = authors + replies + reactions**, because reactions alone are too sparse (D5).
4. **Labels are probabilities** from Jev, over 12 topics discovered in the data and edited by hand (D6), with
   `excited` and `frustrated` flags for the brief (D8). A flag means a main thread of the conversation, not one
   remark (D16), and no topic duplicates a flag (D17).
5. **Two retrieval tools**: `scan` reads a whole slice for "what are people saying"; `find` searches for a named
   thing (D10). Numbers come from SQL, never from the model (D11).
6. **Every cited claim is checked**, and weak ones rewritten once (D12).
7. **Models:** agent on Gemini 2.5 Flash (to protect the capped key), bulk text on Flash-Lite, embeddings on
   gemini-embedding-2, closed judgments on Jev through my own OpenRouter key, stated openly (D9).

## Eval

18 questions written from this data (`eval/questions.jsonl`): 6 lookups with hand-checked gold messages, 2
temporal, 1 excited, 1 frustrated, 1 what-to-post, 3 aggregates graded against SQL, 2 false premises, 2 out of scope.
The judge is Gemini Flash-Lite, a different model from the agent and from Jev.

**Retrieval** (run 2026-09-27 on the 6 lookups, 2,362 conversations; top 8; relevance pooled across the six arms and
judged blind by Flash-Lite; "gold found" = a conversation holding a hand-picked gold message is in the top 8):

| arm | precision@8 | recall@8 | nDCG@8 | gold found | MRR | median time |
|---|---|---|---|---|---|---|
| keyword | 46% | 49% | 0.46 | 5/6 | 0.47 | 0.1 s |
| vector | 38% | 30% | 0.29 | 4/6 | 0.17 | 0.4 s |
| hybrid | 54% | 53% | 0.59 | 5/6 | 0.71 | 0.5 s |
| keyword + Jev rerank | 64% | 57% | 0.75 | 5/6 | 0.67 | 0.6 s |
| vector + Jev rerank | 75% | 59% | 0.69 | 5/6 | 0.58 | 0.9 s |
| **hybrid + Jev rerank (production)** | **74%** | **59%** | **0.78** | 5/6 | **0.75** | 0.9 s |

Reading it: fusion beats either retriever alone (nDCG 0.59 vs 0.46 and 0.29), and the Jev rerank adds the most
(precision 54% to 74%, nDCG 0.59 to 0.78) for about 0.4 s. Vectors alone are the weakest arm here: short Discord
lines carry little meaning per message, and names like "Ebontide" are exact keyword hits. They stay because hybrid
beats keyword on every quality column (gold found ties). L02 (Domains difficulty) is the gold miss in five arms: its
gold messages sit in many small pieces of update-night chat, and the arms returned other relevant Domains
conversations instead (precision 100% in five arms).
Six questions is a small sample: these show direction, not a benchmark.

**End to end** (18 questions in `eval/questions.jsonl`, agent on Gemini 2.5 Flash, judged by Flash-Lite; `npm run eval:agent`):

| measure | first run | after the premise and topic-slice prompt fixes |
|---|---|---|
| answers correct | 11 of 18, 1 partial, 6 wrong (0.64) | 11 of 18, 4 partial, 3 wrong (0.72) |
| false premise | 0 of 2 | 2 of 2 |
| declined when it should (premise + out of scope) | 1 of 4 | 3 of 4 |
| declined when it should not | 0 of 14 | 0 of 14 |
| lookup (6) | 0.92 | 0.58 (regression, being fixed: named things went to a topic scan instead of search) |
| aggregate (3) / temporal (2) | 0.67 / 0.5 | 0.83 / 0.75 |
| cited claims supported | 68 of 72 (94%), 0 invalid | 74 of 77 (96%), 0 invalid |
| latency p50 / p90 | 8.1 s / 18.3 s | 7.9 s / 41.2 s |

The run overlapped a relabel of the pricing topic, so a few answers read the older labels. The false-premise misses are the next thing to fix: asked about a "patch 1.2" that does not exist, the agent described reactions to it; asked why Ebontide was "cancelled" (it shipped), it explained the anger. The judge also marks tool-computed figures (engagement scores, mood) as invented because it does not see the tool results, so the "invented" count overstates.

Full tables: `eval/results/report.md`.

## Label audit

30 conversations (10 per size band, fixed seed) read against their final labels, plus 10 random pricing ones
(docs/DATA.md): **topics right 21/30** (6 miss a clear topic, 4 carry a wrong pricing), **fired flags right 37/41**
(whole conversation 24/30), **sentiment direction 30/30**. **Pricing is over-assigned**: 5 of 10 random pricing
conversations are right; it fires on any buying word in passing, "value for my money", "DLC" as a name, in-game
currency, and context messages. Its stricter description listed "purchases ... store items", and Jev read the list
as trigger words: the share rose from 11.9% to 15.9%. **Fixed after the audit:** the description now says the price or
value must itself be the subject, and names what does not count; pricing fell to 7.3%. On a 40-conversation check,
about 10 of the 13 it kept are right (not re-audited at scale).

**Label shares** (final run, 2,362 conversations, p >= 0.5):

| flags | | topics | | | |
|---|---|---|---|---|---|
| help | 36.3% | lore and story | 17.7% | Domains | 9.4% |
| noise | 35.2% | other games | 17.1% | pricing and editions | 7.3% |
| frustrated | 19.4% | series direction | 13.1% | Bushido final update | 6.1% |
| bug | 14.0% | classic games | 10.7% | RPG-era games | 4.3% |
| feature | 13.3% | Tides Remastered | 10.0% | multiplayer and co-op | 4.1% |
| excited | 10.2% | *no topic* | 36.4% | Ebontide and new quests | 1.2% |
| | | | | Hollow and future titles | 0.8% |

A conversation can carry several topics and flags, so the columns do not sum to 100%.

## Cost

The build's paid calls, from the `budget.py` ledger (`data/work/spend.json`, cap $3.00, re-runs included):
**$0.88 in total**.

| kind | model | calls | input tokens | cost |
|---|---|---|---|---|
| labels (every run and re-run) | Jev via OpenRouter | 7,366 | 17.6 M | $0.74 |
| embeddings | gemini-embedding-2 | 32 batches | 0.66 M | $0.13 |
| topic suggestion | Gemini Flash-Lite | 1 | 35 K | $0.004 |

Embeddings are priced at list price (the API returns no usage figure). The agent's and the eval's Gemini calls
(agent, rewrite, judge) and the app's Jev calls (rerank, scan, claim check) are not in the ledger; they were not
measured tonight.

## Known limits

- Conversation pieces are cut at pauses, not at subject changes; a piece can still hold two subjects.
- Jev labels were audited on a small sample only (above); topics miss a clear subject in about 1 of 5 conversations, so topic counts run low and the agent follows a topic read with a search.
- Reactions are too sparse to measure reach; engagement is a proxy.
- The eval's questions and rubrics were written by the builder, who had read the data: they show direction and
  regressions, not a benchmark score. One judge model.
- No saved chats, no Explore view, no topic editing (D14). No Discord permalinks: the export has none.
- Jev runs on a key outside the one provided.

## What I would do next

1. **Semantic segmentation**: cut long sessions where the subject changes, not where the pause is longest.
2. **Explore and relabel**: the topic x time grid, and topic editing with a priced relabel and backfill, so the
   community team owns the labels.
3. **Many communities**: one pipeline with a manifest and an adapter per platform is already the shape; partition by
   community, and move labelling to a queue.
4. **Streaming ingest**: label and embed new messages as they arrive instead of a batch rebuild.

## Time spent

TODO: 90 minutes, Sun 2026-09-27 21:30-23:00 Oslo. Where the minutes went.
