import { beforeEach, describe, expect, it, vi } from "vitest";

// The relabel's rules as the SQL and the Jev calls the store makes (D46). No database here: `query` and `transaction`
// are fakes that answer by the statement's shape and record what was sent, and decide() records every request.
// db/schema.sql's pulse_topics() and pulse_topic_conf() are the membership rule; these tests pin that the store only
// ever reaches the derived columns through them.

type Stmt = [string, unknown[]?];
const db = vi.hoisted(() => ({
  job: null as null | Record<string, unknown>,
  batch: [] as { id: string; transcript: string }[],
  left: 0,
  queries: [] as { text: string; params: unknown[] }[],
  transactions: [] as Stmt[][],
  decides: [] as { state: unknown; questions: Record<string, { type: string; instructions: string }> }[],
}));

vi.mock("@/lib/data/db", () => ({
  query: async (text: string, params: unknown[] = []) => {
    db.queries.push({ text, params });
    if (/UPDATE relabel_jobs SET lease = now\(\)/.test(text)) return db.job ? [db.job] : [];
    if (/UPDATE relabel_jobs SET status = 'running'/.test(text)) return db.job ? [{ ...db.job, status: "running" }] : [];
    if (/SELECT \* FROM relabel_jobs WHERE id/.test(text)) return db.job ? [db.job] : [];
    if (/SELECT c\.id, c\.transcript FROM conversations/.test(text)) return db.batch;
    if (/AS left FROM conversations/.test(text)) return [{ left: db.left }];
    if (/sum\(usd\)/.test(text)) return [{ usd: 0 }];
    if (/key = 'source'/.test(text)) return [{ value: { community: "Example", about: "a game community" } }];
    if (/key = 'mood_target'/.test(text)) return [{ value: "the game" }];
    return [];
  },
  transaction: async (statements: Stmt[]) => {
    db.transactions.push(statements);
  },
}));
vi.mock("@/lib/llm/decide", () => ({
  decide: async (args: { state: unknown; questions: Record<string, { type: string; instructions: string }> }) => {
    db.decides.push(args);
    const answers = Object.fromEntries(Object.keys(args.questions).map((k, i) => [k, { type: "noul", noul: i === 0 ? 0.9 : 0.2 }]));
    return { answers, modelId: "jev", usage: { inputTokens: 1000 } };
  },
}));

import { finishStatements, mergeStatements, start, step } from "./store";
import { normalizeLabels, STATE_CHARS } from "./taxonomy";

const labels = normalizeLabels([
  { key: "bugs", name: "Bugs", description: "something behaves wrongly" },
  { key: "esports", name: "Esports", description: "tournaments" },
  { key: "pricing", name: "Pricing", description: "prices" },
]);
const jobRow = (runKeys: string[]) => ({
  id: "j1",
  status: "running",
  done: 0,
  total: 2,
  cost_usd: 0,
  estimate_usd: 0.01,
  error: null,
  skipped: 0,
  labels,
  run_keys: runKeys,
});
const sqlOf = (statements: Stmt[]) => statements.map(([t]) => t).join("\n");

beforeEach(() => {
  db.job = null;
  db.batch = [];
  db.left = 0;
  db.queries = [];
  db.transactions = [];
  db.decides = [];
});

describe("combining topics (instant)", () => {
  it("gives the combined topic the highest of its parts' probabilities, drops the parts, and recomputes through SQL", () => {
    const [merge, recompute] = mergeStatements(["bugs", "performance"], "technical-issues");
    expect(merge[0]).toMatch(/topic_p - \$1::text\[\]/); // the parts' own entries go
    expect(merge[0]).toMatch(/jsonb_build_object\(\$2::text,\s+\(SELECT max\(value::float8\) FROM jsonb_each_text\(topic_p\) WHERE key = ANY\(\$1::text\[\]\)\)/);
    expect(merge[0]).toMatch(/WHERE topic_p \?\| \$1::text\[\]/); // only conversations that carried a part
    expect(merge[1]).toEqual([["bugs", "performance"], "technical-issues"]);
    expect(recompute[0]).toMatch(/topics = pulse_topics\(topic_p\), topic = \(pulse_topics\(topic_p\)\)\[1\], topic_conf = pulse_topic_conf\(topic_p\)/);
  });
});

describe("finishing a relabel", () => {
  it("overwrites only the asked topics, drops every key not in the new set, and recomputes every conversation", () => {
    const st = finishStatements("j1", ["bugs", "esports", "other"]);
    expect(st[0][0]).toMatch(/coalesce\(c\.topic_p, '\{\}'::jsonb\) \|\| r\.topic_p/); // the answers win for their keys only
    expect(st[1][0]).toMatch(/WHERE key = ANY\(\$1::text\[\]\)/);
    expect(st[1][1]).toEqual([["bugs", "esports", "other"]]);
    expect(st[2][0]).toMatch(/SET topics = pulse_topics\(topic_p\)/);
    expect(st[2][0]).not.toMatch(/WHERE/); // every conversation, so a removal reaches the ones with no new answer
  });
});

describe("a relabel step", () => {
  it("asks every topic to run in ONE request per conversation, over the shared state, and stores them by key", async () => {
    db.job = jobRow(["bugs", "esports"]);
    db.batch = [
      { id: "c1", transcript: "x".repeat(20000) },
      { id: "c2", transcript: "short" },
    ];
    db.left = 5;
    await step("j1");
    expect(db.decides).toHaveLength(2); // one call per conversation, not one per topic
    const first = db.decides.find((d) => (d.state as { conversation: string }).conversation.startsWith("x"))!;
    expect(first.state).toEqual({ community: "Example: a game community", mood_target: "the game", conversation: "x".repeat(STATE_CHARS) });
    expect(Object.values(first.questions).map((q) => q.type)).toEqual(["noul", "noul"]);
    expect(Object.values(first.questions).map((q) => q.instructions).join()).toMatch(/Bugs \(something behaves wrongly\)[\s\S]*Esports \(tournaments\)/);
    expect(JSON.stringify(first.questions)).not.toMatch(/Pricing/); // an unchanged topic is not asked again
    const insert = db.transactions[0].find(([t]) => /INSERT INTO relabel_results/.test(t))!;
    expect(JSON.parse(insert[1]![1] as string)).toEqual([
      { id: "c1", p: { bugs: 0.9, esports: 0.2 } },
      { id: "c2", p: { bugs: 0.9, esports: 0.2 } },
    ]);
  });

  it("files a conversation Jev keeps refusing with probability 0 for the asked topics", async () => {
    db.job = jobRow(["bugs", "esports"]);
    db.left = 1;
    await step("j1");
    const gaveUp = db.queries.find((q) => /WITH gave_up AS/.test(q.text))!;
    expect(gaveUp.text).toMatch(/jsonb_object_agg\(k, 0\)/);
    expect(gaveUp.params[2]).toEqual(["bugs", "esports"]);
  });

  it("merges into topic_p and recomputes when the last conversation is done", async () => {
    db.job = jobRow(["esports"]);
    db.left = 0;
    await step("j1");
    const done = sqlOf(db.transactions.at(-1)!);
    expect(done).toMatch(/r\.topic_p/);
    expect(done).toMatch(/pulse_topics/);
    expect(done).toMatch(/INSERT INTO taxonomies/);
  });
});

describe("confirming a draft that only removes topics", () => {
  it("is applied at once, with no call to Jev", async () => {
    db.job = { ...jobRow([]), status: "draft", estimate_usd: 0 };
    await start("j1");
    expect(db.decides).toHaveLength(0);
    const done = sqlOf(db.transactions.at(-1)!);
    expect(done).toMatch(/WHERE key = ANY\(\$1::text\[\]\)/);
    expect(done).toMatch(/pulse_topics/);
  });
});
