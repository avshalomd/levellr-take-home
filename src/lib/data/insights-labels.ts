// Editing the topic labels, as pure logic: which edits are instant (a rename, combining labels, rewording a description
// - SQL or text only, no model) and which change what a conversation would be labelled, so they collect into one
// pending draft that is relabelled in a single paid run. The draft is what POST /api/taxonomy/propose takes. Pinned by
// insights-labels.test.ts. Nothing here knows which community or which labels it is looking at.

import { OTHER } from "@/lib/labels/taxonomy";
import type { MoodTarget } from "./mood-target";
import { dayMonth, fmtInt } from "./insights-model";

/** `n`: the conversations touching the topic. Topics are multi-label (D46), so the n's add up to more than `total`. */
export type Label = { key: string; name: string; description: string; n: number };

// The shape of GET /api/taxonomy (src/lib/labels/store.ts panel()). `source` says where the active set came from;
// `total` is the number of conversations; `moodTarget` what the mood is measured towards (null on older data).
export type Taxonomy = {
  active: { version: number; source: string; note?: string; createdAt: string; total?: number; labels: Label[] };
  job: null | {
    id: string;
    status: "draft" | "running" | "done" | "failed" | "cancelled";
    done: number;
    total: number;
    costUsd: number;
    estimateUsd?: number;
    error?: string | null;
    draft: { labels: { key?: string; name: string; description: string }[] };
    runKeys?: string[]; // the topics this sort asks again (new or redefined)
  };
  budget: { spentUsd: number; capUsd: number };
  moodTarget?: MoodTarget | null;
};

/** The catch-all label: always present, never renamed, combined or removed - the labeller must be allowed to say
 * nothing fits. */
export const OTHER_KEY = "other";
export const isOther = (key: string) => key === OTHER_KEY;

/**
 * A topic's description as the editor shows it. The catch-all's built-in wording (labels/taxonomy.ts) is written for
 * the labeller, "None of the other labels fits.", and on this page they are topics (QA 2026-09-26); the stored text is
 * what the labeller reads, so only the page's words change. A description someone wrote is shown as written.
 */
export function shownDescription(l: { key: string; description: string }): string {
  return isOther(l.key) && l.description === OTHER.description ? "Conversations that fit none of the other topics." : l.description;
}

/**
 * Where the active topics came from and when, as one sentence under the editor's title. "carried" is a data reload
 * that kept the topics as they were; it read "Kept from the previous version of the data" (what version?), then "Kept
 * as they were when the conversations were refreshed on …", still more than a reader needs (QA 2026-09-26). It says
 * only when, now. The words say "topics", as the rest of the page does, never "labels".
 */
export function sourceLine(source: string, createdAt: string): string {
  const when = dayMonth(createdAt.slice(0, 10));
  if (source === "edited") return `Last edited by you on ${when}.`;
  if (source === "relabelled") return `Every conversation checked against these topics on ${when}.`;
  if (source === "carried") return `Last updated ${when}.`;
  return `Found in the conversations on ${when}.`;
}

/** Applied at once through POST /api/taxonomy/edit. */
export type InstantEdit =
  | { op: "rename"; key: string; name: string }
  | { op: "merge"; keys: string[]; name: string; description?: string }
  | { op: "describe"; key: string; description: string };

/** Collected into the draft; applied only by a relabel. New labels carry a temporary key, `new:<n>`. */
export type DraftEdit =
  | { op: "add"; key: string; name: string; description: string }
  | { op: "remove"; key: string }
  | { op: "redefine"; key: string; description: string };

export type Edit = InstantEdit | DraftEdit;

export const isNewKey = (key: string) => key.startsWith("new:");

/** Whether an edit can be applied now, without relabelling a single conversation. */
export function isInstant(e: Edit): e is InstantEdit {
  if (e.op === "rename" || e.op === "describe") return !isNewKey(e.key);
  if (e.op === "merge") return e.keys.length >= 2 && !e.keys.some(isNewKey);
  return false;
}

/** The optimistic result of an instant edit, shown before the server answers (the server's answer then replaces it). */
export function applyInstant(labels: Label[], e: InstantEdit): Label[] {
  switch (e.op) {
    case "rename":
      return labels.map((l) => (l.key === e.key ? { ...l, name: e.name.trim() } : l));
    case "describe":
      return labels.map((l) => (l.key === e.key ? { ...l, description: e.description.trim() } : l));
    case "merge": {
      const parts = labels.filter((l) => e.keys.includes(l.key));
      if (parts.length < 2) return labels;
      const merged: Label = {
        key: parts[0].key,
        name: e.name.trim(),
        description: e.description?.trim() || parts.map((p) => p.description).filter(Boolean).join(" "),
        // Shown until the server's count arrives: an upper bound, since a conversation touching two of the parts is
        // one conversation of the combined topic (the server's merge takes the higher probability: store.ts).
        n: parts.reduce((s, p) => s + p.n, 0),
      };
      const at = labels.findIndex((l) => l.key === parts[0].key);
      const rest = labels.filter((l) => !e.keys.includes(l.key));
      rest.splice(Math.min(at, rest.length), 0, merged);
      return rest;
    }
  }
}

/** The next temporary key for a label that does not exist yet. */
export function nextNewKey(pending: DraftEdit[]): string {
  const used = pending.flatMap((e) => (e.op === "add" ? [Number(e.key.slice(4))] : []));
  return `new:${used.length ? Math.max(...used) + 1 : 1}`;
}

/**
 * Add one edit to the pending draft, folding it into what is already there so the draft stays the smallest list that
 * says the same thing: removing a label you just added forgets both; renaming or redescribing a new label edits it;
 * redefining twice keeps the last.
 */
export function addToDraft(pending: DraftEdit[], e: Edit): DraftEdit[] {
  if (e.op === "merge") return pending; // instant only; never part of a draft
  if ((e.op === "rename" || e.op === "describe" || e.op === "redefine") && isNewKey(e.key)) {
    return pending.map((p) =>
      p.op === "add" && p.key === e.key
        ? { ...p, ...(e.op === "rename" ? { name: e.name } : { description: e.description }) }
        : p,
    );
  }
  if (e.op === "rename" || e.op === "describe") return pending; // instant on an existing label
  if (e.op === "remove" && isNewKey(e.key)) return pending.filter((p) => !(p.op === "add" && p.key === e.key));
  if (e.op === "remove") return [...pending.filter((p) => !("key" in p && p.key === e.key)), e];
  if (e.op === "redefine") return [...pending.filter((p) => !(p.op === "redefine" && p.key === e.key)), e];
  return [...pending, e];
}

/** Undo one pending change (the panel's per-row "Undo"). */
export function dropFromDraft(pending: DraftEdit[], key: string): DraftEdit[] {
  return pending.filter((p) => !("key" in p && p.key === key));
}

/** After the active set changed underneath (a combine, a finished relabel), forget pending edits to labels that are gone. */
export function reconcile(pending: DraftEdit[], active: Label[]): DraftEdit[] {
  const keys = new Set(active.map((l) => l.key));
  return pending.filter((p) => p.op === "add" || keys.has(p.key));
}

export type ViewLabel = Label & { status: "kept" | "removed" | "redefined" | "new"; before?: string };

/** The labels as the panel lists them: the active set with the pending draft laid over it. */
export function viewLabels(active: Label[], pending: DraftEdit[]): ViewLabel[] {
  const base: ViewLabel[] = active.map((l) => ({ ...l, status: "kept" as const }));
  const out = base.map((l) => {
    if (pending.some((p) => p.op === "remove" && p.key === l.key)) return { ...l, status: "removed" as const };
    const redef = pending.find((p): p is Extract<DraftEdit, { op: "redefine" }> => p.op === "redefine" && p.key === l.key);
    return redef ? { ...l, description: redef.description, status: "redefined" as const, before: l.description } : l;
  });
  for (const p of pending) if (p.op === "add") out.push({ key: p.key, name: p.name, description: p.description, n: 0, status: "new" });
  return out;
}

export type Draft = {
  labels: { key?: string; name: string; description: string }[]; // the body of POST /api/taxonomy/propose
  changes: string[]; // one plain sentence per change, for the confirmation
  problems: string[]; // anything that blocks sending it
};

/** The label set a relabel would produce, with what changed and anything that must be fixed first. */
export function buildDraft(active: Label[], pending: DraftEdit[]): Draft {
  const view = viewLabels(active, pending);
  const kept = view.filter((l) => l.status !== "removed" && !isOther(l.key));
  const labels = kept.map((l) => (isNewKey(l.key) ? { name: l.name.trim(), description: l.description.trim() } : { key: l.key, name: l.name.trim(), description: l.description.trim() }));

  // The words the reader sees say "topics", as the rest of Explore does (D32), and "new wording", as the row's badge does.
  const changes: string[] = [];
  for (const l of view) {
    if (l.status === "new") changes.push(`Add “${l.name.trim()}”`);
    if (l.status === "removed") changes.push(`Remove “${l.name}”`);
    if (l.status === "redefined") changes.push(`New wording for “${l.name}”`);
  }

  const problems: string[] = [];
  if (kept.length < 2) problems.push("Keep at least two topics besides Other.");
  if (kept.some((l) => !l.name.trim())) problems.push("Every topic needs a name.");
  const undescribed = kept.filter((l) => !l.description.trim());
  if (undescribed.length)
    problems.push(
      undescribed.length === 1
        ? `Describe “${undescribed[0].name.trim() || "the new topic"}” first: descriptions are what conversations are sorted by.`
        : `Describe ${undescribed.length} topics first: descriptions are what conversations are sorted by.`,
    );
  const names = kept.map((l) => l.name.trim().toLowerCase()).filter(Boolean);
  const dup = names.find((n, i) => names.indexOf(n) !== i);
  if (dup) problems.push(`Two topics are called “${kept.find((l) => l.name.trim().toLowerCase() === dup)!.name.trim()}”.`);
  return { labels, changes, problems };
}

/** Whether a new name clashes with another label (case-insensitive). */
export function nameTaken(labels: { key: string; name: string }[], name: string, exceptKey?: string): boolean {
  const n = name.trim().toLowerCase();
  return labels.some((l) => l.key !== exceptKey && l.name.trim().toLowerCase() === n);
}

/** "about $0.18" - small sums to the cent, never "$0.00" for a real cost. */
export function formatUsd(usd: number): string {
  if (usd > 0 && usd < 0.01) return "under $0.01";
  return `$${usd.toFixed(2)}`;
}

/** A relabel runs in steps of about 300 conversations, ~15 s each (src/lib/labels/store.ts). Only for the estimate
 * shown before it starts; once it runs, the estimate comes from its own pace. */
const STEP_SIZE = 300;
const STEP_SECONDS = 15;
export function durationEstimate(conversations: number): string {
  const s = Math.ceil(conversations / STEP_SIZE) * STEP_SECONDS;
  return s < 60 ? "under a minute" : `about ${Math.round(s / 60)} min`;
}

/** Topic names in a sentence: “Bugs”, “Bugs” and “Maps”, “Bugs”, “Maps” and “Lag”. */
export function namesInWords(names: string[]): string {
  const q = names.map((n) => `“${n}”`);
  return q.length < 2 ? (q[0] ?? "") : `${q.slice(0, -1).join(", ")} and ${q.at(-1)}`;
}

/**
 * What confirming a priced draft will do, one sentence per kind of change (D46). Each topic is its own yes or no, so
 * only the new and redefined topics are asked again, and only they are priced; removing a topic asks nothing and is
 * free. `asks` and `removes` are topic names (POST /api/taxonomy/propose).
 */
export function proposalWords(p: { estimate: { conversations: number; usd: number }; asks?: string[]; removes?: string[] }): string[] {
  const asks = p.asks ?? [];
  const removes = p.removes ?? [];
  const lines: string[] = [];
  if (asks.length)
    lines.push(
      `Ask about ${namesInWords(asks)} in each of the ${fmtInt(p.estimate.conversations)} conversations: about ` +
        `${formatUsd(p.estimate.usd)}, ${durationEstimate(p.estimate.conversations)}. The other topics keep their counts.`,
    );
  if (removes.length)
    lines.push(`${namesInWords(removes)} ${removes.length === 1 ? "is" : "are"} taken off every conversation. Removing a topic is free.`);
  return lines;
}

/** How a topic's count reads in the editor: the conversations that touch it, and their share of all conversations.
 *  A conversation can touch several topics (D46), so the shares add up to more than 100%. */
export function topicCountWords(name: string, n: number, total: number): { text: string; title: string | undefined } {
  const text = `${fmtInt(n)} ${n === 1 ? "conversation touches" : "conversations touch"} it`;
  if (!(total > 0) || n / total < 0.001) return { text, title: undefined };
  const pct = Math.round((n / total) * 100) || "<1";
  return { text: `${text}, ${pct}%`, title: `${pct}% of all ${fmtInt(total)} conversations touch ${name}` };
}

/** A time estimate from the progress so far: "about 3 min left". Null until there is a rate to go on. */
export function eta(done: number, total: number, elapsedMs: number): string | null {
  if (done <= 0 || elapsedMs <= 0 || done >= total) return null;
  const left = ((total - done) * elapsedMs) / done / 1000;
  if (left < 60) return "under a minute left";
  return `about ${Math.round(left / 60)} min left`;
}
