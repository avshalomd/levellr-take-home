# Levellr take-home

A timed build: **90 minutes, Sun 2026-09-27, 21:30-23:00 Oslo.** When the clock starts, an email brings the brief,
a dataset of community messages and a capped Gemini API key. The deliverable is this repository's URL, with a
README written inside the 90 minutes. AI tools are allowed. What the reviewers weigh most is **how the chatbot
works, above all retrieval and answer quality**. The UI is a thin layer, so the minutes go to the LLM path:
grouping, retrieval, grounded answers with citations, and saying when the data cannot answer.

## The reference app, and how to use it

A full rehearsal of this task was built beforehand on real community data: **Community Pulse**, at
`~/projects/community-pulse`, frozen at commit `90f193d`.

- **Copy its code freely, exactly as it is, wherever it fits.** Nothing in the task rules this out, and it is the
  fastest route to a working build. Copy whole files (data layer, tools, agent, verification, components, ingest
  scripts) and change only what tonight's brief and data require. Two conditions: the result does what *their*
  brief asks, and every copied piece is explained in `DECISIONS.md`.
- **Re-check its decisions against tonight's brief and data.** The brief may ask for something else, and the data
  may have different fields, platforms or size. For each decision you carry over, check that its reason still
  holds, and write it for this repo in `DECISIONS.md`.
- **Copy only what the build uses.** Leave out code for features that are not built tonight, so the repo holds no
  dead code nobody can explain.
- **Never copy its numbers.** Every figure in its docs (counts, costs, eval scores, audit results) describes the
  rehearsal data. In this repo, each number is measured again on their data, or left out.

Where to read, by topic (D-numbers are the sections of `~/projects/community-pulse/docs/DECISIONS.md`):

| topic | decisions | files in the reference |
|---|---|---|
| **Data design** | D2 one Postgres (Neon) for retrieval, labels and counts · D7 the conversation is the unit · D8 older parents are context, not data · D12 labels stored as probabilities · D46 several topics per conversation · D47 one unit, and the agent says what it cannot count | `docs/DATA.md`, `db/schema.sql` (messages, conversations, dataset_meta), `db/indexes.sql`, `db/app.sql` (chats, taxonomies, relabel jobs, spend) |
| **Ingestion** | D1 Python ingest, TypeScript app · D5 closed judgments go to Jev · D6 embeddings · D17 topics discovered per community · D18 one pipeline, a manifest and an adapter per platform · D46 onboarding in seven steps | `ingest/` (normalize, group, build, sample, suggest, onboard, enrich, embed, load, budget), `datasets/pubg.json` (the manifest), `docs/DATA.md` |
| **Retrieval** | D9 two tools: scan for "what are people saying", find for a named thing · D10 embeddings kept because the eval said so | `src/lib/data/` (scan, search, aggregate, read, voices, filters, embed, profile), `eval/retrieval.ts`, `docs/EVAL.md` |
| **The agent** | D3 data only through typed tools · D13 a step cap that always ends in an answer · D14 citation handles the app owns · D26, D39, D43 numbers come from code | `src/lib/agent/` (agent, tools, instructions, finish, for-model, scope, off-topic), `src/lib/llm/` (agent, decide = Jev, extract, errors) |
| **Claim check** | D11 every answer verified · D15 a weak claim corrected once · D22 how many conversations back a claim · D41, D45 every specific rests on a cited message | `src/lib/agent/` (verify, revise, grounding, corroborate) |
| **App design** | D16 built for a community team, not an analyst · D21 what the agent did: one line, steps a click away, one chart · D24 a chat survives a reload · D27 the evidence panel · D36 what the reader is told matches what was read | `docs/DESIGN.md`, `docs/UX.md`, `src/components/chat/`, `src/components/evidence/`, `src/app/page.tsx`, `src/app/c/[id]/`, `src/app/api/` (chat, chats, thread, messages, overview, health) |
| **Explore and relabel** | D17 the team owns the topics · D19 editing is open, paid calls are fenced · D32, D35 Explore QA | `src/components/insights/`, `src/lib/data/insights*.ts`, `src/lib/labels/`, `src/app/api/taxonomy/` (propose, edit, backfill, suggest), `scripts/labels.ts` |
| **Evals and scaling** | D10, and the eval notes in D47 | `eval/` (questions.jsonl, retrieval.ts, agent.ts), `docs/EVAL.md`, `docs/SCALING.md` |

## Scope for tonight

**Must: the chat page, with the full agent.** Everything on the reference's Ask page and in its chat data layer:

1. **Data, ingested, labeled and embedded.** Conversations grouped from the messages, Jev labels stored as
   probabilities (topics discovered from the data, sentiment, a few flags), embeddings, all loaded into Neon.
2. **The agent and its tools.** A ToolLoopAgent on Gemini Flash with typed tools over that data: an overview of
   the dataset, `scan` (Jev reads every conversation in a slice, for "what are people saying about X"), `find`
   (hybrid keyword + vector search with a Jev rerank, for a named thing), `aggregate` (counts from SQL),
   `read_conversation`, `voices`, and an out-of-scope answer. Plain JSON results, a step cap with a forced
   answer, and a "too broad" branch.
3. **The claim check.** Citations as short handles the app owns; every cited claim verified (the id exists, it was
   read this turn, Jev says the message supports the sentence); weak claims rewritten once and kept only if better.
4. **The chat page.** Streaming answer with citation chips; one line saying what the agent did, with its steps a
   click away; the verification shown; and the evidence panel that opens a cited conversation as a thread tree
   with the cited messages lit.

**If time allows: Explore.** The topic x time grid, and above all the topic editing with a priced relabel and
backfill (D17, D19), which is what lets a team make the labels their own.

**Always, whatever is cut:** a README and a `DECISIONS.md` written during the build, and an eval that ships with
numbers, even a small one.

## Minute zero

1. Read the brief twice. Write down what it asks for, what it scores, and any question worth asking back early.
2. **Probe the key**: which models answer, and the rate limit and quota (the free tier can be ~20 requests a day on
   Flash). Bulk work goes to Jev or Flash-Lite, never to the key's Flash quota.
3. **Read the data's shape** before any code: fields, platform, size, date range. Is there a reply field (group by
   the reply tree) or not (group by time gaps inside a channel)? A score or reactions field (engagement) or not?
   Bots, removed messages?
4. Write the unit at the top of the README: what one row is, what date it carries, and what the agent cannot count.

## Models and keys

| role | model | key (env var) |
|---|---|---|
| agent | `gemini-3.8-flash` | `GOOGLE_GENERATIVE_AI_API_KEY` (the key from the brief) |
| bulk text work, if any | no higher than `gemini-3.5-flash-lite` | same |
| embeddings | `gemini-embedding-2`, 768 dimensions | same |
| closed judgments: labels, rerank, scan relevance, claim support | Jev (`typesafe/jev-1.13` via OpenRouter) | `OPENROUTER_API_KEY` (TypeSafe direct is out of credit) |

Keys live in `.env.local` and in the Vercel project's environment, never in git. Check `git diff --cached` for a
key before every commit.

## Setting up the Vercel project and the database

**Done on 2026-09-27, before the clock:** the private GitHub repo, the Vercel project (linked), Neon in fra1
(pgvector 0.8.6 enabled), and `.env.local` with the database URLs, `TYPESAFE_API_KEY`, `OPENROUTER_API_KEY`,
`AI_GATEWAY_API_KEY` and `AI_MODEL`. The same keys are set on Vercel for production and development.
**Left for 21:30:** paste the Gemini key into `GOOGLE_GENERATIVE_AI_API_KEY` in `.env.local` and add it on Vercel
(the `vercel env add` line below). **Jev route:** direct TypeSafe has no credits left (HTTP 402), and Jev
through OpenRouter answers (`typesafe/jev-1.13` at `https://openrouter.ai/api/alpha/decisions`). The reference's
`src/lib/llm/decide.ts` already tries OpenRouter first.

The commands, for the record:

```bash
cd ~/projects/levellr-take-home
gh repo create avshalomd/levellr-take-home --private --source . --push
vercel project add levellr-take-home
vercel link --yes --project levellr-take-home
vercel integration add neon --name levellr-take-home-db --plan free_v3 -m region=fra1   # the terms step may need a click
vercel env pull .env.local --yes                                  # DATABASE_URL and DATABASE_URL_UNPOOLED
printf '%s' "$KEY" | vercel env add GOOGLE_GENERATIVE_AI_API_KEY production --force   # once the key arrives
printf '%s' "$JEV" | vercel env add TYPESAFE_API_KEY production --force
```

`vercel.json`, with the functions in the database's region:

```json
{ "framework": "nextjs", "git": { "deploymentEnabled": false }, "regions": ["fra1"] }
```

The app stack is the reference's: Next.js 16, React 19, TypeScript, Tailwind v4 + shadcn/ui, Neon serverless
Postgres, Zod 4, AI SDK 7 (`@ai-sdk/google`, `@ai-sdk/react`), Vitest. A clean kit of it is
`~/projects/takehome-harness/template/.claude/scaffold/`, with the Jev client in `src/lib/llm/decide.ts`; its
`scripts/scaffold.sh` lays it and proves it with `npm run check`.
**Laid on 2026-09-27 before the clock** (tag `scaffold`), `npm run check` green. Two changes from the kit: the
chat-page packages are added (`@ai-sdk/react`, `motion`, `react-markdown`, `remark-gfm`), and `src/lib/llm/`
`decide.ts` and `errors.ts` come from the reference, so Jev goes through OpenRouter first (checked live: a call
through `decide()` answered from `typesafe/jev-1.13`).

**Deploy only when he asks:** `vercel deploy --prod --yes`, then open the URL and ask one question. Git deploys
are off on purpose. On Hobby a function runs at most 300 s and takes at most 4.5 MB per request, so data is
loaded from the laptop straight into Neon, never through a function.

## Building the dataset

Python 3.12 with `uv` in `ingest/`, the same order as the reference (its `README.md` § Run it has the commands):

1. **Normalize** the export into one message shape, through an adapter per platform (D18), described by a small
   manifest in `datasets/`.
2. **Group** messages into conversations: by reply tree where there is one, by 15-minute gaps inside a channel
   where there is not (`group.py` has both). Long conversations are windowed with their root carried as context.
3. **Discover topics** from a sample (`sample.py`, `suggest.py`), then label every conversation with one Jev
   request: topic probabilities, sentiment, flags. Store probabilities, not verdicts (D12).
4. **Embed** each conversation's transcript.
5. **Load** into Neon with `DATABASE_URL_UNPOOLED`: messages, conversations with their labels, vectors and a
   full-text index, and the dataset's metadata.
6. **Audit the labels** by hand on a small sample before any count leans on them, and write the result in the
   README.
7. **Cap the spend** (`budget.py`) and write what the build cost.

## Build rules

- The agent reaches data only through typed tools; every number it states comes from code, not from the model.
- Write `DECISIONS.md` as you go: each choice, the alternative, and why. Where he overruled the coding agent, say
  so.
- Commit small and often; the git history is read.
- Keep `private` material, salary figures and anything confidential out of every file in this repo.
- If a measurement looks impossible (a good model scoring zero), debug the harness before reporting the number.

## At the end

README: what it does, how to run it, the unit and what it cannot count, the key decisions, the eval numbers, known
limits, and what it would take at scale. Push, check that the repo URL opens, and send it.
