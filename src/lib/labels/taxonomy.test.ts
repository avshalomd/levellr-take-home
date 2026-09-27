import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import TOPIC_QUESTION from "./topic-question.json";
import {
  applyInstant,
  batchVerdict,
  estimate,
  labelState,
  normalizeLabels,
  OTHER,
  relabelPlan,
  slug,
  STATE_CHARS,
  topicOf,
  topicQuestion,
  topicQuestions,
  type Label,
} from "./taxonomy";

const base: Label[] = normalizeLabels([
  { name: "Performance", description: "FPS, stutter, crashes" },
  { name: "Bugs", description: "something behaves wrongly" },
  { name: "Pricing", description: "prices and spending" },
]);

describe("normalizeLabels", () => {
  it("slugs keys, de-duplicates them, drops blanks and always ends with Other", () => {
    const ls = normalizeLabels([
      { name: "Feature requests", description: "a" },
      { name: "Feature Requests!", description: "b" },
      { name: "  ", description: "c" },
      { key: "other", name: "Other", description: "d" },
    ]);
    expect(ls.map((l) => l.key)).toEqual(["feature-requests", "feature-requests-2", "other"]);
    expect(ls.at(-1)).toEqual(OTHER);
  });

  it("keeps a given key, so an existing label keeps its conversations", () => {
    expect(normalizeLabels([{ key: "perf", name: "Speed", description: "x" }])[0].key).toBe("perf");
    expect(slug("Øl & Mat")).toBe("øl-mat");
  });
});

describe("applyInstant", () => {
  it("renames without moving any conversation", () => {
    const r = applyInstant(base, { op: "rename", key: "pricing", name: "Monetisation" });
    expect(r.labels.find((l) => l.key === "pricing")!.name).toBe("Monetisation");
    expect(r.remap).toEqual({});
  });

  it("combines labels into one, in the first one's place, and says where their conversations go", () => {
    const r = applyInstant(base, { op: "merge", keys: ["bugs", "performance"], name: "Technical issues" });
    expect(r.labels.map((l) => l.key)).toEqual(["technical-issues", "pricing", "other"]);
    expect(r.remap).toEqual({ bugs: "technical-issues", performance: "technical-issues" });
    expect(r.labels[0].description).toContain("FPS");
    expect(r.labels[0].description).toContain("behaves wrongly");
  });

  it("refuses combinations that cannot be answered from the existing labels", () => {
    expect(() => applyInstant(base, { op: "merge", keys: ["bugs"], name: "x" })).toThrow(/two/);
    expect(() => applyInstant(base, { op: "merge", keys: ["bugs", "other"], name: "x" })).toThrow(/Other/);
    expect(() => applyInstant(base, { op: "merge", keys: ["bugs", "nope"], name: "x" })).toThrow(/nope/);
    expect(() => applyInstant(base, { op: "rename", key: "bugs", name: " " })).toThrow(/name/);
  });

  it("a merged name that collides with a remaining key gets a fresh key", () => {
    const r = applyInstant(base, { op: "merge", keys: ["bugs", "performance"], name: "Pricing" });
    expect(r.labels.map((l) => l.key)).toEqual(["pricing-2", "pricing", "other"]);
  });
});

// D46: one question per topic, so a relabel asks only what changed.
describe("relabelPlan", () => {
  it("asks nothing for a rename", () => {
    expect(relabelPlan(base, applyInstant(base, { op: "rename", key: "bugs", name: "Defects" }).labels)).toEqual({ run: [], removed: [] });
  });

  it("asks only the added topic, never the ones already there", () => {
    const next = normalizeLabels([...base.slice(0, 3), { name: "Esports", description: "tournaments" }]);
    expect(relabelPlan(base, next)).toEqual({ run: ["esports"], removed: [] });
  });

  it("asks only the redefined topic", () => {
    const next = base.map((l) => (l.key === "bugs" ? { ...l, description: "only crashes" } : l));
    expect(relabelPlan(base, next)).toEqual({ run: ["bugs"], removed: [] });
  });

  it("a removal asks nothing: it is free", () => {
    expect(relabelPlan(base, normalizeLabels(base.slice(0, 2)))).toEqual({ run: [], removed: ["pricing"] });
  });

  it("a mixed edit asks only what is new or redefined, and never asks about Other", () => {
    const next = normalizeLabels([
      { key: "performance", name: "Performance", description: "FPS and stutter only" },
      { key: "bugs", name: "Bugs", description: "something behaves wrongly" },
      { name: "Esports", description: "tournaments" },
    ]);
    expect(relabelPlan(base, next)).toEqual({ run: ["performance", "esports"], removed: ["pricing"] });
  });

  it("whitespace around a definition is not a new definition", () => {
    const next = base.map((l) => (l.key === "bugs" ? { ...l, description: "  something behaves wrongly " } : l));
    expect(relabelPlan(base, next).run).toEqual([]);
  });
});

describe("the labelling request", () => {
  it("gives Jev the community, the mood target and the conversation, cut to the shared length (the state ingest sends)", () => {
    const s = labelState({ transcript: "a".repeat(20000) }, "Example: a game", "the game");
    expect(STATE_CHARS).toBe(TOPIC_QUESTION.state_chars);
    expect(s).toEqual({ community: "Example: a game", mood_target: "the game", conversation: "a".repeat(TOPIC_QUESTION.state_chars) });
  });

  // The relabel must ask what ingest asked: ingest/enrich.py holds its own copy of the question and the state length.
  it("asks the question ingest/enrich.py asks, over the same length of conversation", () => {
    const py = readFileSync(join(process.cwd(), "ingest/enrich.py"), "utf8");
    const block = /TOPIC_QUESTION = \(([\s\S]*?)\)\n/.exec(py)?.[1] ?? "";
    const pyQuestion = [...block.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]).join("");
    expect(pyQuestion).toBe(TOPIC_QUESTION.instructions);
    expect(Number(/^STATE_CHARS = (\d+)/m.exec(py)?.[1])).toBe(TOPIC_QUESTION.state_chars);
  });

  it("asks one yes/no per topic, worded from the shared file with the topic's name and definition", () => {
    const q = topicQuestion(base[1]);
    expect(q.type).toBe("noul");
    expect(q.instructions).toBe(
      TOPIC_QUESTION.instructions.replace("{name}", "Bugs").replace("{description}", "something behaves wrongly"),
    );
    expect(q.instructions).not.toMatch(/[{}]/);
  });

  it("puts every asked topic in one request, named by position, and maps the answers back to topic keys", () => {
    const asked = base.filter((l) => ["bugs", "pricing"].includes(l.key));
    const qs = topicQuestions(asked);
    expect(Object.keys(qs)).toEqual(["t0", "t1"]);
    expect(topicOf(asked, "t0")).toBe("bugs");
    expect(topicOf(asked, "t1")).toBe("pricing");
  });

  it("prices a backfill before it runs, at Jev's published rate", () => {
    const e = estimate(10_000, 4000, base, ["performance", "bugs", "pricing"]);
    expect(e.conversations).toBe(10_000);
    expect(e.tokens).toBeGreaterThan(10_000 * 1000);
    expect(e.usd).toBeCloseTo((e.tokens * 0.042) / 1e6, 4);
    expect(e.usd).toBeLessThan(1);
  });

  it("prices only the topics asked: the state once per conversation, plus each asked question", () => {
    const one = estimate(10_000, 4000, base, ["bugs"]);
    const three = estimate(10_000, 4000, base, ["performance", "bugs", "pricing"]);
    expect(one.usd).toBeGreaterThan(0);
    expect(three.tokens).toBeGreaterThan(one.tokens);
    // The state (1000 tokens here) is not paid three times over.
    expect(three.tokens).toBeLessThan(2 * one.tokens);
  });

  it("a draft with nothing to ask (removals only) costs nothing", () => {
    expect(estimate(10_000, 4000, base, [])).toEqual({ conversations: 0, tokens: 0, usd: 0 });
  });
});

describe("a relabel meeting failures", () => {
  it("stops only when a whole batch fails, never over one stubborn conversation", () => {
    expect(batchVerdict(300, 0)).toBe("outage");
    expect(batchVerdict(300, 299)).toBe("ok");
    expect(batchVerdict(1, 0)).toBe("ok"); // the last straggler: retried, then filed as other
  });
});
