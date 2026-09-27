# Community Pulse for Levellr

A chatbot for a game studio's Community & Marketing Manager: ask what the Veil of Ages Discord is excited about,
frustrated by, or saying about an update, and get an answer grounded in the messages, each claim linked to the
message behind it and checked, or a plain "the data cannot answer that".

**Live:** TODO-URL

## The unit, and what it cannot count

- **A message** is one Discord message (channel, pseudonymous author, UTC time, reactions, reply parent). It is what
  answers cite.
- **A conversation** is a piece of one channel's activity: split at 15-minute pauses, long sessions cut into 20-40
  message pieces at their longest pause. It is what the agent searches, reads, labels and counts. Every message is in
  exactly one conversation.
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
4. **Labels are probabilities** from Jev, over 13 topics discovered in the data and edited by hand (D6), with
   `excited` and `frustrated` flags for the brief (D8).
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

**End to end:** TODO-NUMBERS (answer score, cited claims supported, declined when it should, invented facts).

Full tables: `eval/results/report.md`.

## Label audit

TODO: ~30 conversations read by hand against their labels (topic, sentiment, excited, frustrated).

## Cost

TODO: the build's spend from `data/work/spend.json` (Jev labels, embeddings, Flash-Lite) and the eval's.

## Known limits

- Conversation pieces are cut at pauses, not at subject changes; a piece can still hold two subjects.
- Jev labels were audited on a small sample only (above).
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
