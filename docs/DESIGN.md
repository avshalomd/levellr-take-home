# Design: how it works

How the pieces fit together. Why each piece is the way it is lives in [DECISIONS.md](../DECISIONS.md) (the D-numbers
below); the data and its labels are profiled in [DATA.md](DATA.md).

## The whole path

```
data/messages.json
  -> ingest/ (Python)  normalize -> group into conversations -> Jev labels -> embeddings -> load
Neon Postgres: messages, conversations (labels, engagement, tsvector, vector(768)), dataset_meta, chats

browser -> /api/chat -> ToolLoopAgent (Gemini Flash, at most 8 steps, the last one forced to answer)
             tools: dataset_overview · scan · find · aggregate · read_conversation · voices · out_of_scope
          -> after the answer: cite pass if uncited -> claim check -> one rewrite of weak claims -> corroboration
          -> the page: streamed answer, citation chips, "what the agent did", verification bar, evidence panel
browser -> /explore -> /api/insights: topic x time grid over the same labels
```

## Ingest (`ingest/`, Python 3.12 with uv)

Run from the laptop, straight into Neon (D15). The dataset is described by a manifest (`datasets/levellr.json`).

| step | file | what it does | writes |
|---|---|---|---|
| normalize | `normalize.py` | the Discord export into one message shape | `data/work/messages.jsonl` |
| group | `group.py` | 15-minute sessions per channel, long ones cut into pieces; reply parents from earlier pieces attached as context (D3, D4) | `conversations.jsonl` |
| sample, suggest | `sample.py`, `suggest.py` | a channel-stratified sample of 300, a label set suggested by Flash-Lite, then edited by hand (D6) | `suggested.json`, `topics.json` |
| enrich | `enrich.py`, `flags.py` | one Jev request per conversation: a probability per topic, sentiment, six flags (D6, D7, D8, D16) | `labels.jsonl` |
| embed | `embed.py` | each transcript with `gemini-embedding-2`, 768 dimensions, L2-normalised (D21) | `embeddings.jsonl` |
| load | `load.py` | `COPY` into Neon, then indexes (`db/indexes.sql`) and `dataset_meta` | Neon |
| budget | `budget.py` | a ledger of every paid call, with a $3 cap | `spend.json` |

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

Loop control: at most 8 steps. The last step gets no tools and a flattened history (question plus what each tool
returned), so it must answer in prose from what was read. A turn that has only counted may not answer a question
about what people say (`grounding.ts`).

## After the answer (`finish.ts`)

1. The answer is the text after the last tool call (D26). A turn that used tools and wrote nothing is answered once
   from the tool results.
2. An answer that read messages but cites none is sent back once to cite them (`citeAnswer`, `revise.ts`).
3. The claim check (`verify.ts`, D12): each cited sentence is split into claims; each citation must exist and have been
   shown by a tool somewhere in the chat (D24); Jev scores whether the message supports the claim, a list sentence as a
   whole (D25); figures must be in the cited messages or a tool result, and a figure tagged with a tool that never ran
   fails (D11).
4. Weak claims are rewritten once, and the rewrite is kept only if it is better (`revise.ts`, D12). Stated rates are
   checked against the rates the tools gave (`rates.ts`, `trends.ts`).
5. Corroboration (`corroborate.ts`): each cited claim is put to every conversation the turn found relevant, so the
   answer can say how many back it. Reads retry and run 8 at a time (D28).
6. The verdict and any kept rewrite stream to the page as data parts (`data-verification`, `data-revision`).

## The pages (`src/app/`, `src/components/`)

- **Chat** (`/`, `/c/[id]`; `components/chat/`): the answer streams in with citation chips (`CitationChip`); one line
  says what the agent did, with its steps a click away (`Activity`), and a chart shows when a tool counted
  (`MiniBars`); the verification bar says how many claims are backed, as a warning when fewer than half are (D27).
  The question box stops at 2,000 characters (D29). Chats are saved and listed in the sidebar (`components/shell/`,
  D18).
- **Evidence panel** (`components/evidence/`): a citation chip opens its conversation as a reply tree (`ThreadMap`,
  `thread-tree.ts`) with the cited messages lit. The export has no Discord permalinks, so a citation opens the message
  in the app.
- **Explore** (`/explore`; `components/insights/`, `lib/data/insights*.ts`, `/api/insights`): a topic x time grid
  (days, weeks or months) showing how many conversations or their mood. Selecting cells lists the busiest sessions and
  the voices in them and prefills a question for the chat. Read-only on `main`; topic editing is on a branch (D31).
- API routes: `chat`, `chats` (saved chats), `thread/[id]` and `messages` (the evidence panel), `overview` (the
  welcome page), `insights` (Explore), `health`.

## Eval (`eval/`)

- `questions.jsonl`: 35 questions written from this data, by type: lookup, temporal, excited, frustrated,
  what-to-post, aggregate, false premise, out of scope, voices; two paraphrase pairs check that the same question
  asked twice gets the same verdict.
- `retrieval.ts`: the six retrieval arms (keyword, vector, hybrid, each with and without the Jev rerank) on the lookup
  questions, relevance pooled across arms and judged blind by Flash-Lite.
- `agent.ts`: every question end to end through `makeAgent` and `afterAgent`; a Flash-Lite judge reads the answer,
  the rubric, SQL truth for counts, every step's tool outputs and the cited messages in full. `--out` writes a run to
  its own file, as for the model comparison in `results/models/`.
- `report.ts` writes `results/report.md`. The numbers are in the README.
