# Eval results

Written by hand from the result files in this folder, with no model calls. `npm run eval:report` regenerates the
retrieval section and an end-to-end section from `agent.json` only; the v1.1 runs and the model comparison below
come from `models/*.json`. How to read these numbers, and their limits, is in the [README](../../README.md#eval).

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

## End to end, v1.1 (Gemini 2.5 Flash, judge gemini-3.5-flash-lite)

39 questions: the 35 of `v1.0` plus F02, F03 (a follow-up to F02 in the same chat), P03 and A06, from the production
QA. The full run is on the v1.1 agent before the claim check's longer waits; the rerun is 11 of the questions on the
release code, after them.

| | full run (`gemini-2.5-flash-v1.1.json`) | rerun (`gemini-2.5-flash-v1.1-retry2.json`) |
|---|---|---|
| run at (UTC) | 2026-09-27 23:12 | 2026-09-27 23:15 |
| questions | 39 | 11 |
| judged correct | 37 correct, 2 partial, 0 wrong | 10 correct, 1 partial, 0 wrong |
| by kind | every kind 100% except lookup, 0.83 (L05, L06 partial) | every kind 100% except aggregate, 0.5 (A02 partial) |
| declined or corrected when it should | 9/9 | 1/1 |
| declined when it should not | 0/30 | 0/10 |
| answers with invented facts (judge) | 0 | 0 |
| cited claims supported, of those checked (Jev) | 125/136 (91.9%) | 67/68 (98.5%) |
| cited claims left unchecked (OpenRouter 429s) | 18 of 154 | 0 of 68 |
| made-up citation ids / cited but never read | 0 / 0 | 0 / 0 |
| paraphrase pairs given the same verdict | 2/2 | not measured (one question of a pair) |
| latency p50 / p90 | 6.1 s / 14.0 s | 8.1 s / 9.7 s |

The rerun's questions: L05, L06, T02, E01, F01, A02, X01, C03, T04, E02, F02. The unchecked claims of the full run
were in L01 (5), L05 (3), L06 (8), C03 (1) and H01 (1). All four of V01's cited claims were checked and not backed: it
lists message counts from `voices` and cites sample messages.

| id | run | verdict | judge's reason |
|---|---|---|---|
| L05 | full | partial | It misses that players on update night said the update was not live yet on Switch, and the complaint that the Switch 2 version lacked it. |
| L06 | full | partial | It gives the boot crashes and memory add-ons, and misses the crashes tied to the Kuroshima DLC, the Ebontide sword and selling tagged items. |
| A02 | rerun | partial | It lists channels beyond the top 3. The same five channels and counts were judged correct in the full run. |

Earlier runs during v1.1, kept beside these (the commit messages say what each checked):

| file | run at (UTC) | questions | result |
|---|---|---|---|
| `gemini-2.5-flash-v1.1-rerun.json` | 2026-09-27 22:37 | 8 | 8 correct; 26/26 cited claims backed (the questions that moved in a full run, after the O02 fix) |
| `gemini-2.5-flash-v1.1-rc.json` | 2026-09-27 22:41 | 39 | 39 correct; 136/145 checked claims backed (93.8%), 24 of 169 unchecked; p50 6.2 s, p90 14.2 s |
| `gemini-2.5-flash-v1.1-rc-retry.json` | 2026-09-27 22:43 | 9 | 9 correct; 38/40 backed, 0 unchecked (the claim check's first retry) |
| `gemini-2.5-flash-v1.1-rc-fix.json` | 2026-09-27 23:07 | 9 | 9 correct; 41/41 backed (after the B1, N1 and N6 fixes) |

## End to end, model comparison on the `v1.0` code (`models/`, 35 questions, same code `96f625f`, judge gemini-3.5-flash-lite)

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
| tool calls, all questions | 55 | 110 |

Tool calls are counted from each run's `tools` list. An earlier version of this report gave 42 and 68, the
`tool_use` field, which counts the questions that used each tool, summed.

The one answer 2.5 Flash got wrong:

| id | question | verdict | judge's reason |
|---|---|---|---|
| X03 | What did players say about the Tides Remastered beta test last week? | wrong | It said players discussed a beta test; nobody in the server mentions one. |

## Earlier run (`agent.json`, 2026-09-27 20:29 UTC, 18 questions, Gemini 2.5 Flash)

Run before the lookup-routing and period fixes, and before the judge saw every step's tool outputs, so its judge
counted computed figures (mood scores, counts) as invented. 11 correct, 4 partial, 3 wrong (score 72%); lookups
0.58; cited claims supported 74/77 (96%); declined when it should 3/4, when it should not 0/14; latency p50 7.9 s,
p90 41.2 s.
