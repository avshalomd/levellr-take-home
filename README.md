# Veil of Ages community chatbot (Levellr take-home)

A chatbot for a game studio's Community & Marketing Manager: ask what the Veil of Ages Discord is excited about,
frustrated by, or saying about an update, and get an answer grounded in the messages, each claim linked to the
message behind it and checked, or a plain "the data cannot answer that".

**How it works, visually:** [the anatomy page](https://avshalomd.github.io/levellr-take-home/anatomy.html) walks
through the key design decisions, the grouping of messages into conversations, the labels, the two retrieval flows
(`scan`, and `find`: hybrid search with a Jev rerank), the claim check and the evals, with the real data
(source: [`docs/anatomy.html`](docs/anatomy.html)).

**Live:** https://levellr-take-home.vercel.app (public; every question spends the brief's capped Gemini key). It runs
release tag [`v1.0`](https://github.com/avshalomd/levellr-take-home/tree/v1.0) (commit `2ae6130`): the chat, and Explore's topic x time grid,
read-only. Commits after the tag change docs only.

## The unit, and what it cannot count

- **A message** is one Discord message (channel, pseudonymous author, UTC time, reactions, reply parent). It is what
  answers cite.
- **A conversation** is a piece of one channel's activity: split at 15-minute pauses; a session over 40 messages is
  cut at its longest pause 20-40 messages in, repeatedly, and the last piece keeps the remainder. It is what the agent
  searches, reads, labels and counts, dated by its first message. Every message is in exactly one conversation.
  **2,362 conversations**: median 4 messages, p90 33, max 40.
- **Now** is the last message, 2026-09-27 19:30 UTC. "The last 3 days" means 09-24 19:30 to 09-27 19:30 UTC.
- **It cannot count:** anything outside these 11 channels (Reddit, Steam reviews, sales, revenue), anything before
  2026-09-13, readers who never wrote, reach (reactions are on 4.5% of messages, at most 8), or intent beyond the
  words. A count of conversations is not a count of people; answers say which unit a number is in.

The data profile, the label set and the label audit are in [docs/DATA.md](docs/DATA.md): 25,555 messages, 795
authors, 11 channels, two weeks.

## Run it

```bash
npm install
# .env.local needs:
#   DATABASE_URL, DATABASE_URL_UNPOOLED   Neon Postgres with pgvector (vercel env pull .env.local)
#   GOOGLE_GENERATIVE_AI_API_KEY          the brief's Gemini key: agent, embeddings, bulk text, eval judge
#   OPENROUTER_API_KEY                    Jev (typesafe/jev-1.13): labels, rerank, scan, claim check
#   AI_MODEL=gemini-2.5-flash             the agent model (optional; this is the default)

# build the dataset (Python 3.12 + uv), from data/messages.json
cd ingest
uv run python build.py ../datasets/levellr.json                          # normalize + group into conversations
uv run --env-file ../.env.local python enrich.py --concurrency 16        # Jev labels: topics, sentiment, flags
uv run --env-file ../.env.local python embed.py                          # gemini-embedding-2, 768 dims
uv run --env-file ../.env.local python load.py                           # COPY into Neon, build indexes
cd ..
npm run db:app                  # the app's own table: saved chats

npm run dev                     # http://localhost:3000
npm run check                   # types, lint, unit tests
npm run eval:retrieval          # retrieval arms -> eval/results/retrieval.json
npm run eval:agent              # end to end (spends agent quota) -> eval/results/agent.json
AI_MODEL=gemini-3.8-flash npm run eval:agent -- --concurrency 3 --out eval/results/models/gemini-3.8-flash.json
npm run eval:report             # eval/results/report.md
```

## How it works

Python ingest groups the messages into conversations, labels each once with Jev (a probability per topic, sentiment,
flags), embeds it and loads it into Neon. A Gemini Flash agent answers through typed tools over that data (`scan`
reads a whole slice, `find` searches for a named thing, `aggregate` counts in SQL). After it answers, every cited
claim is checked against the message it cites, and weak ones are rewritten once. The page streams the answer with
citation chips, what the agent did, the check's result, and an evidence panel with the cited messages lit. The full
walk-through is in [docs/DESIGN.md](docs/DESIGN.md).

## Key decisions

Each with its alternative and reason in [DECISIONS.md](DECISIONS.md).

1. **A Python ingest, a TypeScript app, one Postgres** for search, labels and counts (D1).
2. **The unit is a pause-split conversation piece:** a 15-minute pause starts a session, and a long session is cut
   at its best silence into 20-40 messages. A plain 30-message cut was the first design; it split exchanges (D3).
3. **"Resonating" = authors + replies + reactions**, because reactions alone are too sparse (D5).
4. **Labels are probabilities** from Jev, over 12 topics discovered in the data (D6), sentiment towards the games
   and their developer (D7), and flags such as `excited` and `frustrated` (D8) that mean a main thread, not one
   remark (D16). Topics and flags are two axes, and no topic duplicates a flag (D17).
5. **Two retrieval tools**: `scan` reads a whole slice for "what are people saying"; `find` searches for a named
   thing. A question about a topic reads only that topic (D10). Numbers come from SQL, never from the model (D11).
6. **Every cited claim is checked**, weak ones rewritten once (D12), follow-ups checked against the whole chat (D24),
   and a weak result shown as a warning (D27). A citation opens its conversation as a reply tree (D32).
7. **Models:** agent on Gemini 2.5 Flash, to protect the capped key, kept after a measured comparison with 3.8 Flash
   (D9); closed judgments on Jev, through the builder's own OpenRouter key, stated openly (D9).
8. **Topic editing is held back:** built on a branch, and kept off the production database until it can be tested
   on another one (D31).

## Eval

35 questions written from this data (`eval/questions.jsonl`): 6 lookups with hand-checked gold messages, 5 temporal,
2 excited, 3 frustrated, 2 what-to-post, 7 aggregates graded against SQL, 4 false premises, 5 out of scope, 1
voices, with two paraphrase pairs. The judge is Gemini 3.5 Flash-Lite, a different model from the agent and from Jev,
and it reads every step's tool outputs and the cited messages in full.

**End to end, model comparison** (both models on the same code, commit `96f625f`, concurrency 3, no fallback model,
same judge; [`eval/results/models/`](eval/results/models/)):

| | Gemini 2.5 Flash | Gemini 3.8 Flash |
|---|---|---|
| judged correct | 34/35 (one false premise wrong) | 35/35 |
| abstained when it should | 8/9 | 9/9 |
| abstained when it should not | 0/26 | 0/26 |
| invented figures | 0 | 0 |
| cited claims backed | 129/131 (98.5%) | 130/136 (95.6%) |
| invalid / not-retrieved citations | 0 / 0 | 0 / 0 |
| latency p50 / p90 | 6.7 s / 12.3 s | 19.4 s / 27.0 s |
| tool calls (all questions) | 42 | 68 |

2.5 Flash's miss is X03: asked about a Tides Remastered "beta test" nobody mentions, it described one. Both models
gave the same verdict to each paraphrase pair. **Production stays on 2.5 Flash** (D9): quality is
near equal, 2.5 is about three times faster with fewer tool calls, and it is the model the key's email named. 3.8
Flash is one env var away (`AI_MODEL`).

**Read it with care:** the questions and rubrics were written by the builder after reading the data, there is one LLM
judge, and each model ran once. The numbers show direction and catch regressions; they are not a benchmark. An
earlier 18-question run on 2.5 Flash (`eval/results/agent.json`), before the lookup-routing and period fixes and
before the judge saw the tool outputs, scored 11 correct, 4 partial and 3 wrong.

**Retrieval** (the 6 lookups, top 8; relevance pooled across the six arms and judged blind by Flash-Lite; "gold
found" = a conversation holding a hand-picked gold message is in the top 8; `eval/results/report.md`):

| arm | precision@8 | recall@8 | nDCG@8 | gold found | MRR | median time |
|---|---|---|---|---|---|---|
| keyword | 46% | 49% | 0.46 | 5/6 | 0.47 | 0.1 s |
| vector | 38% | 30% | 0.29 | 4/6 | 0.17 | 0.4 s |
| hybrid | 54% | 53% | 0.59 | 5/6 | 0.71 | 0.5 s |
| keyword + Jev rerank | 64% | 57% | 0.75 | 5/6 | 0.67 | 0.6 s |
| vector + Jev rerank | 75% | 59% | 0.69 | 5/6 | 0.58 | 0.9 s |
| **hybrid + Jev rerank (production)** | **74%** | **59%** | **0.78** | 5/6 | **0.75** | 0.9 s |

Fusion beats either retriever alone (nDCG 0.59 against 0.46 and 0.29), and the Jev rerank adds the most (precision
54% to 74%) for about 0.4 s. Vectors alone are the weakest arm: short Discord lines carry little meaning, and names
like "Ebontide" are exact keyword hits. They stay because hybrid beats keyword on every quality column. Six questions
show direction, not a benchmark.

## Label audit

30 conversations (10 per size band, fixed seed) read against their labels, plus 10 random pricing ones: **topics
right 21/30** (6 miss a clear topic), **fired flags right 37/41**, **sentiment direction 30/30**. Pricing fired on any
buying word and was right in 5 of 10; its description was fixed and every conversation relabelled (D23), and pricing
fell from 15.9% to 7.3%. Details in [docs/DATA.md](docs/DATA.md#label-audit).

## Cost

The build's paid calls, from the `budget.py` ledger (`data/work/spend.json`, re-runs included):
**$0.88 in total**.

| kind | model | calls | input tokens | cost |
|---|---|---|---|---|
| labels (every run and re-run) | Jev via OpenRouter | 7,366 | 17.6 M | $0.74 |
| embeddings | gemini-embedding-2 | 32 batches | 0.66 M | $0.13 |
| topic suggestion | Gemini Flash-Lite | 1 | 35 K | $0.004 |

One full labelling run of the 2,362 conversations cost $0.23 to $0.24 (`data/work/labels.jsonl`). Embeddings are
priced at list price (the API returns no usage figure). The agent's and the eval's Gemini calls and the app's Jev
calls (rerank, scan, claim check) are not in the ledger; they were not measured.

## Known limits

- Conversation pieces are cut at pauses, not at subject changes; a piece can still hold two subjects.
- Labels were audited on a small sample, read by hand by the builder, and the pricing fix was not re-audited at
  scale. Topics miss a clear subject in about 1 of 5 conversations, so topic counts run low; the agent follows a
  topic read with a search.
- Reactions are too sparse to measure reach; engagement is a proxy.
- The eval is small and written by the builder (above).
- Explore is read-only on `main`: topic editing is built but held back on a branch (roadmap, item 1).
- No login: each browser sees its own saved chats. No Discord permalinks: the export has none.
- Jev runs on a key outside the one provided, through OpenRouter's shared pool, which rate-limits under load (D28).

**Found by the production QA of `v1.0`**, left open because production is frozen ([docs/QA.md](docs/QA.md)):

- **Explore's "Busiest conversations" rows return an empty answer (P1).** A row asks the chat about an internal
  handle ("What did people say in conv1268 ...?"); the model returns nothing, and the page says the answer was not
  finished. The handle also shows in the chat's title.
- **The claim check can pass an off-topic citation (P2).** A frustrations answer built its pricing section from
  #off-topic talk about GTA 6 prices, and all its claims passed. The check asks only whether the message supports
  the sentence, and here it did.
- **A follow-up can answer without reading (P3).** "Which of those are bugs?" answered "none are bugs" with no tool
  call, no citations and no check, although the data has a `bug` flag and other answers found bugs in the same week.
- **Post suggestions are thin (P4).** "What should we post about this week?" gave three ideas, each on one message,
  with no engagement measure behind them.
- **A long chat stops answering (P18).** From the 7th question on, the route sends the model a history that can
  open on an earlier answer's tool call, which Gemini refuses; that question, and "Try again", end in an error, and
  so does each later question whose history is cut the same way. A new chat works.
- **Dates written in messages disagree with the timestamps (P8).** The export looks time-shifted
  ([docs/DATA.md](docs/DATA.md#profile)), so an answer can quote "a 9 July launch" as upcoming on 27 September.

## Roadmap

In priority order.

1. **Finish and merge topic editing.** Built on
   [`explore-topic-editing`](https://github.com/avshalomd/levellr-take-home/tree/explore-topic-editing), held back
   because it writes labels and the only database is production's (D31). In Explore, the team adds, renames,
   redefines, combines or removes topics; adding or redefining one shows a price, then Jev re-asks that one topic of
   every conversation and backfills the probabilities. This is a main reason Jev was chosen (D6): re-asking one topic
   of all 2,362 conversations is priced at about $0.06 (a formula, not yet run; a full labelling run cost $0.23 to
   $0.24), cheap enough for the team to start a relabel whenever it wants, without an engineer. To finish:
   1. make a Neon branch and point `.env.local` at it;
   2. `npm run db:app` (taxonomies, relabel jobs, spend);
   3. `npm run labels -- seed-spend`, so ingest's cost is recorded beside the relabels;
   4. in the app, price, run and remove a topic; check that the grid and the agent read the new labels;
   5. merge, then deploy.
2. **Fix what the production QA found** ([docs/QA.md](docs/QA.md)): open an Explore row's conversation in the
   evidence panel, and let an empty model turn fall through to the forced answer (P1); ask in the claim check, or in
   the scan, whether a cited message is about this community's games (P2); start the model's history at a question,
   or load it on the server from the saved chat, so a long chat keeps answering (P18); make a follow-up that asks for
   a slice call a tool (P3); rank post ideas by engagement and ground each in more than one conversation, or say the
   evidence is thin (P4); quote dates from messages as written (P8).
3. **Drive topic rules from data, not names.** The prompt and the chart code name the general topics ("other", other
   games) to leave them out of excitement and resonance rankings (D20), and the prompt's examples name the Domains and
   Ebontide. After a relabel those names can be gone. A `general` flag on a topic should drive the exclusion, and the
   examples should come from the active topic set.
4. **Re-audit the labels** after the pricing fix, by a person, on a larger sample.
5. **A sturdier eval:** questions written by someone who has not read the data, a second judge, several runs per
   model.
6. **Semantic segmentation:** cut long sessions where the subject changes, not where the pause is longest.
7. **Many communities:** the pipeline reads a manifest per dataset and an adapter per platform (one exists, for this
   Discord export); partition the tables by
   community and move labelling to a queue.
8. **Streaming ingest:** label and embed new messages as they arrive instead of a batch rebuild.

## Time spent

From `git log`, Oslo time (UTC+2), Sunday 2026-09-27: the stack was laid before the brief arrived (tag `scaffold`,
20:40). The first commit on the brief is `9d34778` at 21:40, and the delivered commit `2ae6130` (tag `v1.0`) is at
23:01. Commits after it change docs only.
