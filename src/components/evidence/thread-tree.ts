// Pure logic for the evidence panel, kept free of React so it is unit-tested (thread-tree.test.ts):
//  - layout: the reply tree in reading order, each node's depth;
//  - shapeOf / sessionOf: whether a conversation opens with one message the rest hang from (a thread) or is a chat
//    session with many top-level messages; mapGeometry / nearest: its picture, always a reply tree, a session's
//    top-level messages hanging from a node for the conversation itself;
//  - focusView: what is open when the panel opens on one message - the message, what it answers, what answers it;
//  - threadFacts / spanWords: the facts the panel header states.

export type TreeInput = { id: string; reply_to: string | null; ts: string; kind: string };
export type Laid<T extends TreeInput> = T & { depth: number; order: number; parentId: string | null };

export function layout<T extends TreeInput>(nodes: T[]): Laid<T>[] {
  const ids = new Set(nodes.map((n) => n.id));
  const children = new Map<string, T[]>();
  const roots: T[] = [];
  for (const n of nodes) {
    if (n.reply_to && ids.has(n.reply_to)) {
      const list = children.get(n.reply_to) ?? [];
      list.push(n);
      children.set(n.reply_to, list);
    } else roots.push(n);
  }
  const byTime = (a: T, b: T) => (a.kind === "post" ? -1 : b.kind === "post" ? 1 : a.ts.localeCompare(b.ts));
  const out: Laid<T>[] = [];
  const walk = (n: T, depth: number, parentId: string | null) => {
    out.push({ ...n, depth, order: out.length, parentId });
    for (const c of (children.get(n.id) ?? []).sort(byTime)) walk(c, depth + 1, n.id);
  };
  // Replies whose parent is outside the data hang at depth 1, under the post, so the map stays one tree.
  const post = roots.find((r) => r.kind === "post");
  for (const r of roots.sort(byTime)) walk(r, r === post || !post ? 0 : 1, r === post ? null : post?.id ?? null);
  return out;
}

export type FactsInput = { author: string; ts: string; kind: string; ref: number };
export type ThreadFacts = { starter: string | null; startedAt: string; endedAt: string; messages: number; people: number; cited: number };

/** What the panel header says about a thread: who started it and when, how big it is, and how much of it is cited. */
export function threadFacts(nodes: FactsInput[], citedTags: Set<string>, tagOf: (ref: number) => string): ThreadFacts {
  const byTime = [...nodes].sort((a, b) => a.ts.localeCompare(b.ts));
  const post = nodes.find((n) => n.kind === "post") ?? byTime[0];
  return {
    starter: post?.author ?? null,
    startedAt: post?.ts ?? byTime[0]?.ts ?? "",
    endedAt: byTime.at(-1)?.ts ?? "",
    messages: nodes.length,
    people: new Set(nodes.map((n) => n.author)).size,
    cited: nodes.filter((n) => citedTags.has(tagOf(n.ref))).length,
  };
}

/** How long a conversation ran, in words: "within an hour", "over 5 hours", "over 3 days", "over 2 months". */
export function spanWords(fromIso: string, toIso: string): string {
  const hours = (Date.parse(toIso) - Date.parse(fromIso)) / 3_600_000;
  const n = (x: number, unit: string) => `over ${x} ${unit}${x === 1 ? "" : "s"}`;
  if (!(hours >= 1)) return "within an hour";
  if (hours < 48) return n(Math.round(hours), "hour");
  const days = Math.round(hours / 24);
  if (days < 14) return n(days, "day");
  if (days < 60) return n(Math.round(days / 7), "week");
  return n(Math.round(days / 30), "month");
}

// ---- The picture -------------------------------------------------------------------------------------------------

export type Shape = "tree" | "timeline";

/**
 * How to draw a conversation. One that opens with a post (or has a single first message everything hangs from) is a
 * reply tree. A chat session, where most messages answer nobody in particular and a few reply to one, is a timeline:
 * drawing it as a tree would stack dozens of unrelated roots on one level and hide the order people spoke in.
 */
export function shapeOf(nodes: TreeInput[]): Shape {
  if (nodes.some((n) => n.kind === "post")) return "tree";
  const ids = new Set(nodes.map((n) => n.id));
  const roots = nodes.filter((n) => !n.reply_to || !ids.has(n.reply_to)).length;
  return roots <= 1 ? "tree" : "timeline";
}

/**
 * The part of a timeline worth drawing around one message: its conversation (the session it was grouped into at
 * ingest) and whatever those messages reply to. A Discord "thread" is a whole channel; the panel shows the session.
 */
export function sessionOf<T extends TreeInput & { conversation_id: string | null }>(nodes: T[], focusId: string): T[] {
  const conv = nodes.find((n) => n.id === focusId)?.conversation_id;
  if (!conv) return nodes;
  const inConv = nodes.filter((n) => n.conversation_id === conv);
  const need = new Set(inConv.map((n) => n.reply_to).filter(Boolean));
  return nodes.filter((n) => n.conversation_id === conv || need.has(n.id));
}

export type MapGeometry = {
  width: number;
  height: number;
  points: Map<string, { x: number; y: number }>;
  edges: { from: string; to: string; d: string }[];
  /** Where the conversation itself sits when it has several top-level messages: not a message, never selectable. */
  root: { x: number; y: number } | null;
};

/** The id edges use for the conversation's own node (never a message id). */
export const ROOT = "__conversation__";

const PAD = 9;

/**
 * Where each message sits in the picture, in a `width`-wide coordinate space: a reply tree, reading order across and
 * reply depth down, each reply hanging from its parent by an elbow. A chat session has many top-level messages; they
 * hang from one node for the conversation itself (`root`), so the picture stays one tree, in the order people spoke.
 */
export function mapGeometry<T extends TreeInput>(laid: Laid<T>[], width = 400): MapGeometry {
  const points = new Map<string, { x: number; y: number }>();
  const edges: MapGeometry["edges"] = [];
  const tops = laid.filter((l) => l.depth === 0);
  const hasRoot = tops.length > 1;
  const shift = hasRoot ? 1 : 0;
  const n = laid.length + shift;
  const xAt = (i: number) => (n <= 1 ? width / 2 : PAD + (i / (n - 1)) * (width - 2 * PAD));
  const maxDepth = Math.max(1, ...laid.map((l) => l.depth + shift));
  const dy = Math.min(14, Math.max(5, 72 / maxDepth));
  const root = hasRoot ? { x: xAt(0), y: PAD } : null;
  for (const l of laid) points.set(l.id, { x: xAt(l.order + shift), y: PAD + (l.depth + shift) * dy });
  const elbow = (p: { x: number; y: number }, c: { x: number; y: number }) => `M${r1(p.x)},${r1(p.y)} V${r1(c.y)} H${r1(c.x)}`;
  for (const l of laid) {
    const c = points.get(l.id)!;
    const p = l.parentId ? points.get(l.parentId) : undefined;
    if (p) edges.push({ from: l.parentId!, to: l.id, d: elbow(p, c) });
    else if (root) edges.push({ from: ROOT, to: l.id, d: elbow(root, c) });
  }
  return { width, height: PAD * 2 + maxDepth * dy, points, edges, root };
}

const r1 = (v: number) => Math.round(v * 10) / 10;

/** The message nearest a point in the picture, within `reach` - dots in a 400-message thread are too small to hit. */
export function nearest(points: Map<string, { x: number; y: number }>, x: number, y: number, reach = 14): string | null {
  let best: string | null = null;
  let bestD = reach * reach;
  for (const [id, p] of points) {
    const d = (p.x - x) ** 2 + (p.y - y) ** 2;
    if (d <= bestD) [best, bestD] = [id, d];
  }
  return best;
}

/** Every message on the reply path from the top of the conversation down to each of `ids`: the branch to light. */
export function branchOf<T extends TreeInput>(laid: Laid<T>[], ids: Iterable<string>, shape: Shape): Set<string> {
  const byId = new Map(laid.map((l) => [l.id, l]));
  const up = (l: Laid<T>) => (shape === "tree" ? l.parentId : l.reply_to && byId.has(l.reply_to) ? l.reply_to : null);
  const out = new Set<string>();
  for (const id of ids) {
    for (let cur = byId.get(id); cur && !out.has(cur.id); cur = up(cur) ? byId.get(up(cur)!) : undefined) out.add(cur.id);
  }
  return out;
}

// ---- What is open ------------------------------------------------------------------------------------------------

export type FocusView<T extends TreeInput> = {
  /** Messages above the parent, top of the conversation first: one-line previews the reader can expand. */
  chain: Laid<T>[];
  /** What the open message answers, shown in full. On a timeline with no reply link, the message just before it. */
  parent: Laid<T> | null;
  parentIs: "reply-to" | "just-before" | null;
  /** The open message answers a message that is not in the data (deleted, or never collected). */
  parentMissing: boolean;
  focus: Laid<T>;
  /** Direct replies, most engaged first then oldest: collapsed one-liners. */
  replies: Laid<T>[];
};

/** Replies listed before the rest fold behind "Show N more". */
export const REPLY_PREVIEW = 5;

/**
 * What the panel shows when it opens on a message: that message in full, the message it answers in full, anything
 * further up as one-liners, and its direct replies as one-liners. Everything else is reached through the picture or
 * "Show whole thread" - opening one comment in a 400-message thread should not pour 400 messages on the reader.
 */
export function focusView<T extends TreeInput & { score: number }>(laid: Laid<T>[], focusId: string, shape: Shape): FocusView<T> | null {
  const byId = new Map(laid.map((l) => [l.id, l]));
  const focus = byId.get(focusId);
  if (!focus) return null;
  // The real reply link, in both shapes. The tree's parentId is a drawing choice: a reply whose parent is missing
  // from the data hangs under the post there, but it does not answer the post and is never shown as if it did.
  const up = (l: Laid<T>) => (l.reply_to ? (byId.get(l.reply_to) ?? null) : null);
  const parentMissing = !!focus.reply_to && !byId.has(focus.reply_to);
  let parent = up(focus);
  let parentIs: FocusView<T>["parentIs"] = parent ? "reply-to" : null;
  const chain: Laid<T>[] = [];
  for (let cur = parent ? up(parent) : null; cur && cur !== focus && !chain.includes(cur); cur = up(cur)) chain.unshift(cur);
  if (!parent && shape === "timeline") {
    const byTime = [...laid].sort((a, b) => a.ts.localeCompare(b.ts));
    parent = byTime[byTime.indexOf(focus) - 1] ?? null;
    parentIs = parent ? "just-before" : null;
  }
  const replies = laid
    .filter((l) => l !== focus && l.reply_to === focus.id)
    .sort((a, b) => b.score - a.score || a.ts.localeCompare(b.ts));
  return { chain, parent, parentIs, parentMissing, focus, replies };
}

/** How many direct replies each message has, by the real reply link (an orphan is nobody's reply), in both shapes. */
export function replyCounts<T extends TreeInput>(laid: Laid<T>[]): Map<string, number> {
  const out = new Map<string, number>();
  const ids = new Set(laid.map((l) => l.id));
  for (const l of laid) {
    const p = l.reply_to && ids.has(l.reply_to) ? l.reply_to : null;
    if (p) out.set(p, (out.get(p) ?? 0) + 1);
  }
  return out;
}
