// The label set ("taxonomy") as data: discovered from the community at ingest, then reshaped by the customer.
// Pure logic only - no database, no model - so every rule here is unit-tested (taxonomy.test.ts).
//
// The design rule (docs/DECISIONS.md D17, D46): an edit that only changes names or folds existing labels together is
// answered from the labels already in the database - instant and free. An edit that changes what a label MEANS
// (a new label, a rewritten definition) needs that one topic asked again of every conversation, so it becomes a draft
// with a cost estimate, and only a confirmed draft runs as a backfill. Removing a topic asks nothing and is free.
//
// Topics are multi-label (D46): one Jev yes/no per topic, not one choice among them. A conversation that blurs two
// subjects keeps both instead of losing the runner-up; a team writes the topics it wants to track, not a mutually
// exclusive taxonomy; and each topic is asked on its own, so adding, removing or redefining one never moves another's
// counts. The membership rule (p >= 0.5, "other" when none clears it) lives in SQL, pulse_topics() in db/schema.sql.

import TOPIC_QUESTION from "./topic-question.json";

export type Label = { key: string; name: string; description: string };
export const OTHER: Label = { key: "other", name: "Other", description: "None of the other labels fits." };

export const slug = (name: string) =>
  name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "label";

/** Keys unique and stable, and "other" always present, last: a conversation no topic clears 0.5 on is filed there.
 *  "Other" is never asked about; it is what is left when every topic's answer is no (pulse_topics, db/schema.sql). */
export function normalizeLabels(labels: { key?: string; name: string; description: string }[]): Label[] {
  const out: Label[] = [];
  const used = new Set<string>();
  for (const l of labels) {
    const name = l.name.trim();
    if (!name) continue;
    let key = l.key?.trim() || slug(name);
    if (key === OTHER.key) continue;
    for (let i = 2; used.has(key); i++) key = `${slug(name)}-${i}`;
    used.add(key);
    out.push({ key, name, description: l.description.trim() });
  }
  return [...out, OTHER];
}

export type InstantEdit =
  | { op: "rename"; key: string; name: string }
  | { op: "describe"; key: string; description: string }
  | { op: "merge"; keys: string[]; name: string; description?: string };

/** An instant edit applied to a label set: the new set, and which old keys now read as which new key. */
export function applyInstant(labels: Label[], edit: InstantEdit): { labels: Label[]; remap: Record<string, string> } {
  const has = (k: string) => labels.some((l) => l.key === k);
  switch (edit.op) {
    case "rename": {
      if (!has(edit.key) || edit.key === OTHER.key) throw new Error(`No topic "${edit.key}" to rename.`);
      const name = edit.name.trim();
      if (!name) throw new Error("A topic needs a name.");
      return { labels: labels.map((l) => (l.key === edit.key ? { ...l, name } : l)), remap: {} };
    }
    case "describe": {
      // Wording only, shown to people. A definition change that should move conversations goes through a draft.
      if (!has(edit.key)) throw new Error(`No topic "${edit.key}".`);
      return { labels: labels.map((l) => (l.key === edit.key ? { ...l, description: edit.description.trim() } : l)), remap: {} };
    }
    case "merge": {
      const keys = [...new Set(edit.keys)];
      if (keys.length < 2) throw new Error("Pick at least two topics to combine.");
      if (keys.includes(OTHER.key)) throw new Error('"Other" cannot be combined.');
      const missing = keys.filter((k) => !has(k));
      if (missing.length) throw new Error(`No topic ${missing.map((k) => `"${k}"`).join(", ")}.`);
      const merged = labels.filter((l) => keys.includes(l.key));
      const rest = labels.filter((l) => !keys.includes(l.key));
      const name = edit.name.trim() || merged.map((l) => l.name).join(" & ");
      const taken = new Set(rest.map((l) => l.key));
      let key = slug(name);
      for (let i = 2; taken.has(key); i++) key = `${slug(name)}-${i}`;
      const description = edit.description?.trim() || merged.map((l) => l.description).join(" Or: ");
      // The combined label takes the place of the first of its parts, so the list keeps its order.
      const at = labels.findIndex((l) => keys.includes(l.key));
      const next = [...rest];
      next.splice(Math.min(at, next.length), 0, { key, name, description });
      return { labels: normalizeLabels(next), remap: Object.fromEntries(keys.map((k) => [k, key])) };
    }
  }
}

/**
 * What going from `prev` to `next` asks of Jev. Topics are one yes/no question each (docs/DECISIONS.md D46), so only
 * what changed is asked again: `run` are the topics that are new or whose definition changed, `removed` the ones that
 * are gone. A removal needs no question at all - the topic's probability is simply dropped - so a draft that only
 * removes topics is applied at once and costs nothing, and no edit can move another topic's counts.
 */
// Combining labels changes keys too, but it is answered by applyInstant's merge and never reaches this question. A
// rename is not a new question either: it is instant (the name is how people read the topic, the definition is what
// Jev is asked about).
export function relabelPlan(prev: Label[], next: Label[]): { run: string[]; removed: string[] } {
  const before = new Map(prev.map((l) => [l.key, l]));
  const after = new Set(next.map((l) => l.key));
  const run = next
    .filter((l) => l.key !== OTHER.key)
    .filter((l) => !before.has(l.key) || before.get(l.key)!.description.trim() !== l.description.trim())
    .map((l) => l.key);
  const removed = prev.filter((l) => l.key !== OTHER.key && !after.has(l.key)).map((l) => l.key);
  return { run, removed };
}

// The per-topic question and how much of a conversation it reads live in ONE file that ingest/enrich.py reads too, so a
// topic means the same thing at onboarding and in a relabel (topic-question.json).
export const STATE_CHARS = TOPIC_QUESTION.state_chars;

/** What Jev reads for one conversation when asked about its topics: the same three fields ingest/enrich.py sends (the
 *  community, what its mood is measured towards, the conversation), so a relabelled topic is judged on the same input
 *  as at ingest. Paid once per conversation however many topics are asked about it. */
export function labelState(c: { transcript: string }, community: string, moodTarget: string) {
  return { community, mood_target: moodTarget, conversation: c.transcript.slice(0, STATE_CHARS) };
}

/** One topic's question: a yes/no (Noul) whose probability is how sure Jev is that the conversation discusses it. */
export function topicQuestion(l: Pick<Label, "name" | "description">) {
  return {
    type: "noul" as const,
    instructions: TOPIC_QUESTION.instructions.replaceAll("{name}", l.name).replaceAll("{description}", l.description),
  };
}

/** Every question of one request, one per topic asked, named by position (t0, t1, ...): a topic key is the customer's
 *  own text (accents, hyphens), and a question name is safest as a plain identifier. topicOf maps a name back. */
export function topicQuestions(asked: Label[]) {
  return Object.fromEntries(asked.map((l, i) => [`t${i}`, topicQuestion(l)]));
}
export const topicOf = (asked: Label[], name: string) => asked[Number(name.slice(1))]?.key;

// Jev's published price, USD per million input tokens (output is free). ~4 characters per token for English.
export const JEV_USD_PER_MTOK = 0.042;
export const estimateTokens = (text: string) => Math.ceil(text.length / 4);

// What Jev bills per call beyond the characters/4 estimate of the state and the questions. Measured on this dataset
// from ingest's own records (data/work/labels.jsonl, 7,086 calls, billed input tokens against the same estimate): mean
// 125 tokens, median 4. Rounded up to 150 so a price errs high: the budget check reads it.
export const CALL_OVERHEAD_TOKENS = 150;

/** The cost of asking the `runKeys` topics of `n` conversations whose states average `avgChars` characters, before a
 *  single call is made. The state is paid once per conversation; each topic asked adds only its question. A draft
 *  with nothing to ask (removals only) costs nothing. */
export function estimate(n: number, avgChars: number, labels: Label[], runKeys: string[]) {
  const asked = labels.filter((l) => runKeys.includes(l.key));
  if (!asked.length || n === 0) return { conversations: 0, tokens: 0, usd: 0 };
  const questions = JSON.stringify(topicQuestions(asked)).length;
  const tokens = Math.ceil(n * (Math.ceil(avgChars / 4) + Math.ceil(questions / 4) + CALL_OVERHEAD_TOKENS));
  return { conversations: n, tokens, usd: +(tokens * JEV_USD_PER_MTOK / 1e6).toFixed(4) };
}

// A relabel over thousands of conversations meets the odd one Jev will not answer (malformed text, a transient
// error). One refusal must not sink the job: a conversation that fails MAX_TRIES times gets probability 0 for the
// topics the job asks (it is counted in the job's `skipped`, so the reader is told). Only a whole batch failing at once
// means Jev itself is down, and that stops the job (resumable) instead of filing thousands of conversations that way.
export const MAX_TRIES = 3;
export const OUTAGE_MIN_BATCH = 20;
export function batchVerdict(attempted: number, answered: number): "ok" | "outage" {
  return answered === 0 && attempted >= OUTAGE_MIN_BATCH ? "outage" : "ok";
}
