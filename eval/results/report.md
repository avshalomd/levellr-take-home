# Eval results

Written by hand from the result files in this folder, with no model calls. `npm run eval:report` regenerates the
retrieval section and an end-to-end section from `agent.json` only; the model comparison below comes from
`models/*.json`. How to read these numbers, and their limits, is in the [README](../../README.md#eval).

## Retrieval arms (`retrieval.json`, 2026-09-27 20:04 UTC, 6 lookup questions, top 8)

Relevance is pooled across the six arms and judged once per conversation by gemini-3.5-flash-lite, blind to the arm.
Recall is against every relevant conversation any arm found. "Gold found" = a conversation holding a hand-picked gold
message is in the top 8.

| arm | precision@8 | recall@8 | nDCG@8 | gold found | MRR | median time |
|---|---|---|---|---|---|---|
| keyword | 46% | 49% | 0.46 | 5/6 | 0.47 | 0.1 s |
| vector | 38% | 30% | 0.29 | 4/6 | 0.17 | 0.4 s |
| hybrid | 54% | 53% | 0.59 | 5/6 | 0.71 | 0.5 s |
| keyword + Jev rerank | 64% | 57% | 0.75 | 5/6 | 0.67 | 0.6 s |
| vector + Jev rerank | 75% | 59% | 0.69 | 5/6 | 0.58 | 0.9 s |
| **hybrid + Jev rerank (production)** | **74%** | **59%** | **0.78** | 5/6 | **0.75** | 0.9 s |

## End to end, model comparison (`models/`, 35 questions, same code `96f625f`, judge gemini-3.5-flash-lite)

| | Gemini 2.5 Flash (production) | Gemini 3.8 Flash |
|---|---|---|
| run at (UTC) | 2026-09-27 20:47 | 2026-09-27 20:49 |
| judged correct | 34/35 (1 wrong) | 35/35 |
| by kind | every kind 100% except false premise, 3/4 | every kind 100% |
| declined or corrected when it should | 8/9 | 9/9 |
| declined when it should not | 0/26 | 0/26 |
| answers with invented facts (judge) | 0 | 0 |
| cited claims supported by their message (Jev) | 129/131 (98.5%) | 130/136 (95.6%) |
| made-up citation ids / cited but never read | 0 / 0 | 0 / 0 |
| paraphrase pairs given the same verdict | 2/2 | 2/2 |
| latency p50 / p90 | 6.7 s / 12.3 s | 19.4 s / 27.0 s |
| tool calls, all questions | 42 | 68 |

The one answer 2.5 Flash got wrong:

| id | question | verdict | judge's reason |
|---|---|---|---|
| X03 | What did players say about the Tides Remastered beta test last week? | wrong | It said players discussed a beta test; nobody in the server mentions one. |

## Earlier run (`agent.json`, 2026-09-27 20:29 UTC, 18 questions, Gemini 2.5 Flash)

Run before the lookup-routing and period fixes, and before the judge saw every step's tool outputs, so its judge
counted computed figures (mood scores, counts) as invented. 11 correct, 4 partial, 3 wrong (score 72%); lookups
0.58; cited claims supported 74/77 (96%); declined when it should 3/4, when it should not 0/14; latency p50 7.9 s,
p90 41.2 s.
