# Design: how it works

How the pieces fit together. Why each piece is the way it is lives in [DECISIONS.md](../DECISIONS.md) (the D-numbers
below); the data and its labels are profiled in [DATA.md](DATA.md).

## The whole path

```
data/messages.json
  -> ingest/ (Python)  normalize -> group into conversations -> Jev labels -> embeddings -> load
Neon Postgres: messages, conversations (labels, engagement, tsvector, vector(768)), dataset_meta, chats

browser -> /api/chat -> the last 6 answered exchanges + the new question
          -> ToolLoopAgent (Gemini Flash, at most 8 steps, at most 6 distinct calls a step,
             the last step forced to answer)
             tools: dataset_overview · scan · find · aggregate · read_conversation · voices · out_of_scope
          -> after the answer: scope net if no tool and no citation -> cite pass if uncited -> claim check
             -> one rewrite of weak claims -> corroboration
          -> the page: streamed answer, citation chips, "what the agent did", verification bar, evidence panel
browser -> /explore -> /api/insights: topic x time grid over the same labels
```

## Ingest (`ingest/`, Python 3.12 with uv)

Run from the laptop, straight into Neon (D15). The dataset is described by a manifest (`datasets/levellr.json`).

| step | file | what it does | writes |
|---|---|---|---|
| normalize | `normalize.py` | the Discord export into one message shape | `data/work/messages.jsonl` |
| group | `group.py` | 15-minute sessions per channel, long ones cut into pieces; reply parents from earlier pieces attached as context (D3, D4) | `conversations.jsonl` |
| sample, suggest | `sample.py`, `suggest.py` | a channel-stratified sample of 300, a label set suggested by Flash-Lite, then revised and approved before labelling (D6, D17) | `suggested.json`, `topics.json` |
| enrich | `enrich.py`, `flags.py` | one Jev request per conversation: a probability per topic, sentiment, six flags (D6, D7, D8, D16, D17) | `labels.jsonl` |
| embed | `embed.py` | each transcript with `gemini-embedding-2`, 768 dimensions, L2-normalised (D21) | `embeddings.jsonl` |
| load | `load.py` | `COPY` into Neon, then indexes (`db/indexes.sql`) and `dataset_meta` | Neon |
| budget | `budget.py` | a ledger of every paid call | `spend.json` |

`build.py` runs normalize and group in one go. `enrich.py` and `embed.py` cache by content hash, so a re-run pays
only for what changed.

## Schema (`db/schema.sql`, `db/app.sql`)

- `messages`: `id`, `ref` (cited as `msgN`), `channel`, `reply_to`, `conversation_id`, `author`, `author_id`, `ts`,
  `text`, `reactions` (jsonb), `n_reactions`, a generated `tsv`.
- `conversations`: `id`, `ref` (`convN`), `channel`, `kind`, `session_id`, `piece`, `n_pieces`, `started_at`,
  `ended_at`; `n_messages`, `n_authors`, `n_replies`, `n_reactions`, `engagement` (D5), `context_ids[]`,
  `transcript`; `topic_p` with `topics[]`, `topic`, `topic_conf` derived from it by `pulse_topics()` (the one copy of
  the 0.5 rule); `sentiment`; `p_excited`, `p_frustrated`, `p_bug`, `p_feature`, `p_help`, `p_noise`; `labels`,
  `label_model`, `embedding vector(768)`, `tsv`.
- `dataset_meta`: the window, counts, channels, topics, and "now" (D2).
- `chats` (`db/app.sql`, apart from the build tables so a data reload keeps them): saved chats, owned by an anonymous
  cookie id (D18).

## The agent (`src/lib/agent/`)

`/api/chat` builds the agent with `makeAgent` (`agent.ts`), the one place it is put together, so the route and the eval
run the same thing. The instructions (`instructions.ts`) carry the dataset's profile, "now", and the topics by name and
key. The model is `chatModel()` (`model.ts`), Gemini 2.5 Flash unless `AI_MODEL` says otherwise (D9).

The tools (`tools.ts`), each a typed call over `src/lib/data/` that returns plain JSON (`for-model.ts` shapes it):

| tool | data layer | what it returns |
|---|---|---|
| `dataset_overview` | `read.ts` | the community, window, counts, channels, and the topics with how many conversations touch each |
| `scan` | `scan.ts` | Jev reads every conversation in a slice (time, topic, channel, flag) and keeps the relevant ones; over 2,500 it refuses with a breakdown to narrow by (D10) |
| `find` | `search.ts` | keyword and vector search in one SQL statement, fused by reciprocal rank (k = 60), 24 candidates reranked by Jev, top 8 (D10) |
| `aggregate` | `aggregate.ts` | counts of conversations, messages, people and reactions, engagement scores (D19), sentiment and label shares, by day, week, month, topic or channel, from SQL (D11) |
| `read_conversation` | `read.ts` | one conversation in full, by its `convN` handle |
| `voices` | `voices.ts` | the most active people in a slice, with what they wrote and started and the reactions they drew |
| `out_of_scope` | `off-topic.ts`, `scope.ts` | ends the turn with a reply written in code, if the scope check agrees the data cannot answer |

Which tool a question goes to is set in the instructions (D10): a broad question about a topic scans that topic, a
named thing goes to `find`, and only a question with no subject reads the whole window. For what excites or
frustrates people, what resonates and what to post, `scan` also asks Jev, in the same call, whether the conversation
is about the community's own games (`dataset_meta.mood_target`), and leaves out and counts apart the ones that are
not (D35). A post read ranks the relevant conversations by engagement (D13). A count or read over a period outside the
data says so first (D44).

What the model is sent (`src/app/api/chat/turn.ts`, D34): the last 6 questions that got an answer, each with that
answer, then the new question. The window starts at a question, and a failed turn is left out with its question. Only
the last answer keeps its tool results; earlier ones are their words as shown. The checks after the agent read the
whole window, and the claim check every tool result in the chat.

Loop control (`prepareStep` and the model wrappers in `agent.ts`):

- At most 8 steps. The last step gets no tools and a flattened history (question plus what each tool returned), so it
  must answer in prose from what was read.
- The first step must call a tool when a follow-up names a kind, a topic or a period (any tool but `out_of_scope`),
  when a follow-up asks for more on the last answer (`read_conversation`, `find` or `scan`), or when the question asks
  for a number (any tool) (D36).
- A turn that has only counted may not answer a question about what people say (`grounding.ts`). A turn whose
  `out_of_scope` call the scope check turned down must scan or find on its next step, once.
- A step keeps each distinct tool call once, only calls to offered tools, at most 6 (`oneCallEach`, D39).
- A step with no words and no tool call is asked again once, made to call a tool when it was offered tools
  (`retryEmpty`, D26).

## After the answer (`finish.ts`)

1. The answer is the text after the last tool call (D26). A turn that wrote nothing is answered once from the tool
   results, or, with nothing read, says what it could not establish.
2. An off-topic question gets the reply written in code: one the model sent to `out_of_scope` and the scope check
   agreed with, or a turn that called no tool and cites nothing and that the same check turns away (the scope net,
   `scope.ts` `turnBearsOn`, one Jev call, D37). The check reads the question with the one before it.
3. An answer that read messages but cites none is sent back once to cite them (`citeAnswer`, `revise.ts`).
4. The claim check (`verify.ts`, D12): each cited sentence is split into claims; each citation must exist and have been
   shown by a tool somewhere in the chat (D24); Jev scores whether the message supports the claim with the same
   meaning (D42), a list sentence as a whole (D25), and, for a question kept to the community's own games, whether the
   message is about something else, in which case it backs nothing (D35). Figures must be in the cited messages or a
   tool result, and a figure tagged `[scan]`, `[aggregate]` or `[voices]` fails unless that tool ran in this turn
   (D11, D38). A Jev call refused by a busy pool is retried after 1, 3, 8 and 15 s (`lib/llm/retry.ts`, D40).
5. Weak claims, and figures tagged from another turn, are rewritten once, and the rewrite is kept only if it is
   better (`revise.ts`, D12, D38). Stated rates and directions ("up 51%", D43) are checked against what the tools gave
   (`rates.ts`, `trends.ts`).
6. Corroboration (`corroborate.ts`): each cited claim is put to every conversation the turn found relevant, so the
   answer can say how many back it. Reads retry and run 8 at a time (D28).
7. The verdict and any kept rewrite stream to the page as data parts (`data-verification`, `data-revision`).

## The pages (`src/app/`, `src/components/`)

- **Chat** (`/`, `/c/[id]`; `components/chat/`): the answer streams in with citation chips (`CitationChip`); one line
  says what the agent did, with its steps a click away (`Activity`), and a chart shows when a tool counted
  (`MiniBars`); the verification bar says how many claims are backed, as a warning when fewer than half are (D27).
  The question box stops at 2,000 characters (D29). Chats are saved and listed in the sidebar (`components/shell/`,
  D18).
- **Evidence panel** (`components/evidence/`): a citation chip opens its conversation as a reply tree (`ThreadMap`,
  `thread-tree.ts`, D32) with the cited messages lit. The export has no Discord permalinks, so a citation opens the message
  in the app.
- **Explore** (`/explore`; `components/insights/`, `lib/data/insights*.ts`, `/api/insights`): a topic x time grid
  (days, weeks or months) showing how many conversations or their mood. Selecting cells lists the busiest sessions and
  the voices in them and prefills a question for the chat. A busiest-session row opens that session in the evidence
  panel's reply tree, one conversation at a time (D41). Read-only on `main`; topic editing is on a branch (D31).
- API routes: `chat`, `chats` (saved chats), `thread/[id]` and `messages` (the evidence panel), `overview` (the
  welcome page), `insights` (Explore), `health` (it reports the deployed commit, D22).
- A failed turn shows one plain line. "Try again" is offered once where sending again could change the answer; if it
  fails the same way, "New chat" replaces it. A question over the cap goes back in the box to shorten.

## Eval (`eval/`)

- `questions.jsonl`: 39 questions written from this data, by type: lookup, temporal, excited, frustrated,
  what-to-post, aggregate, false premise, out of scope, voices; two paraphrase pairs check that the same question
  asked twice gets the same verdict. A question with `before` asks its earlier questions first in the same chat,
  passing their tool results as the chat route does; only the last is timed and graded (F03 follows F02).
- `retrieval.ts`: the six retrieval arms (keyword, vector, hybrid, each with and without the Jev rerank) on the lookup
  questions, relevance pooled across arms and judged blind by Flash-Lite.
- `agent.ts`: every question end to end through `makeAgent` and `afterAgent`; a Flash-Lite judge reads the answer,
  the rubric, SQL truth for counts, every step's tool outputs and the cited messages in full. `--out` writes a run to
  its own file, as for the model comparison in `results/models/`.
- `report.ts` writes `results/report.md` from `results/agent.json` and `results/retrieval.json`. The numbers, with
  the v1.1 runs and the model comparison from `results/models/`, are in the README.
