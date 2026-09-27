import { describe, expect, it } from "vitest";
import { msgTag } from "@/lib/refs";
import { branchOf, focusView, layout, mapGeometry, nearest, replyCounts, sessionOf, shapeOf, spanWords, threadFacts } from "./thread-tree";

const n = (id: string, reply_to: string | null, min: number, kind = "comment", author = id, ref = 0) => ({
  id,
  reply_to,
  ts: `2026-09-01T10:${String(min).padStart(2, "0")}:00Z`,
  kind,
  author,
  ref,
});

const thread = [
  n("t3_p", null, 0, "post", "ana", 1),
  n("t1_a", "t3_p", 1, "comment", "ben", 2),
  n("t1_b", "t3_p", 2, "comment", "ana", 3),
  n("t1_a1", "t1_a", 3, "comment", "cai", 4),
  n("t1_a2", "t1_a", 4, "comment", "ben", 5),
  n("t1_a1x", "t1_a1", 5, "comment", "dee", 6),
  n("t1_orphan", "t1_missing", 6, "comment", "eve", 7),
];

describe("layout", () => {
  it("walks the reply tree depth-first in time order, post first, every node shown", () => {
    const laid = layout(thread);
    expect(laid.map((x) => `${x.id}:${x.depth}`)).toEqual(["t3_p:0", "t1_a:1", "t1_a1:2", "t1_a1x:3", "t1_a2:2", "t1_b:1", "t1_orphan:1"]);
  });
  it("hangs a reply whose parent is missing under the post", () => {
    expect(layout(thread).find((x) => x.id === "t1_orphan")!.parentId).toBe("t3_p");
  });
});

describe("threadFacts", () => {
  it("states who started the thread, its size, its span and how many messages the answer cites", () => {
    const f = threadFacts(thread, new Set(["msg4", "msg6", "msg999"]), msgTag);
    expect(f).toEqual({ starter: "ana", startedAt: thread[0].ts, endedAt: thread[6].ts, messages: 7, people: 5, cited: 2 });
  });
  it("falls back to the earliest message when the post is not in the data", () => {
    expect(threadFacts(thread.slice(1), new Set(), msgTag).starter).toBe("ben");
  });
});

describe("spanWords", () => {
  it("says how long a conversation ran, in words", () => {
    expect(spanWords("2026-09-01T10:00:00Z", "2026-09-01T10:20:00Z")).toBe("within an hour");
    expect(spanWords("2026-09-01T10:00:00Z", "2026-09-01T11:10:00Z")).toBe("over 1 hour");
    expect(spanWords("2026-09-01T10:00:00Z", "2026-09-01T15:00:00Z")).toBe("over 5 hours");
    expect(spanWords("2026-09-01T10:00:00Z", "2026-09-04T10:00:00Z")).toBe("over 3 days");
    expect(spanWords("2026-09-01T10:00:00Z", "2026-09-22T10:00:00Z")).toBe("over 3 weeks");
    expect(spanWords("2026-06-01T10:00:00Z", "2026-09-01T10:00:00Z")).toBe("over 3 months");
  });
});

// A Reddit-shaped thread with scores: the post, two top-level comments, a chain three deep under the first.
const scored = thread.map((x, i) => ({ ...x, score: [50, 3, 40, 12, 7, 1, 0][i], conversation_id: "c1" }));

// A Discord-shaped session: no post, most messages answer nobody, two reply to earlier ones.
const chat = (id: string, reply_to: string | null, min: number, conversation_id = "s1", score = 0) => ({
  id,
  reply_to,
  ts: `2026-09-01T11:${String(min).padStart(2, "0")}:00Z`,
  kind: "message",
  score,
  conversation_id,
});
const session = [
  chat("d_1", null, 0),
  chat("d_2", null, 1),
  chat("d_3", "d_1", 2, "s1", 4),
  chat("d_4", null, 3),
  chat("d_5", "d_3", 4, "s1", 1),
  chat("d_other", null, 5, "s2"),
];

describe("shapeOf", () => {
  it("draws a thread that opens with a post as a tree", () => {
    expect(shapeOf(thread)).toBe("tree");
  });
  it("draws a chat session with many unanswered messages as a timeline", () => {
    expect(shapeOf(session)).toBe("timeline");
  });
  it("draws a single reply chain with no post as a tree", () => {
    expect(shapeOf([chat("d_1", null, 0), chat("d_2", "d_1", 1)])).toBe("tree");
  });
});

describe("sessionOf", () => {
  it("keeps the open message's session and what it replies to, not the whole channel", () => {
    expect(sessionOf(session, "d_3").map((x) => x.id)).toEqual(["d_1", "d_2", "d_3", "d_4", "d_5"]);
  });
  it("keeps a reply target from an earlier session", () => {
    const withLate = [...session, chat("d_late", "d_other", 9, "s1")];
    expect(sessionOf(withLate, "d_1").map((x) => x.id)).toContain("d_other");
  });
});

describe("mapGeometry", () => {
  it("places a tree by reading order across and reply depth down, one elbow per reply", () => {
    const laid = layout(thread);
    const g = mapGeometry(laid, "tree", 400);
    const xs = laid.map((l) => g.points.get(l.id)!.x);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
    expect(g.points.get("t1_a1x")!.y).toBeGreaterThan(g.points.get("t1_a1")!.y);
    expect(g.points.get("t1_a")!.y).toBe(g.points.get("t1_b")!.y);
    expect(g.edges).toHaveLength(laid.length - 1);
    expect(g.edges.every((e) => e.d.startsWith("M") && e.d.includes("V") && e.d.includes("H"))).toBe(true);
    for (const p of g.points.values()) expect(p.x >= 0 && p.x <= 400 && p.y >= 0 && p.y <= g.height).toBe(true);
  });
  it("lays a chat session on one baseline in time order, with an arc only for each reply", () => {
    const laid = layout(sessionOf(session, "d_3"));
    const g = mapGeometry(laid, "timeline", 400);
    const ys = new Set([...g.points.values()].map((p) => p.y));
    expect(ys.size).toBe(1);
    const order = [...g.points.entries()].sort((a, b) => a[1].x - b[1].x).map(([id]) => id);
    expect(order).toEqual(["d_1", "d_2", "d_3", "d_4", "d_5"]);
    expect(g.edges.map((e) => `${e.to}->${e.from}`)).toEqual(["d_3->d_1", "d_5->d_3"]);
    expect(g.edges.every((e) => e.d.includes("Q"))).toBe(true);
  });
  it("centres a single message", () => {
    const g = mapGeometry(layout([thread[0]]), "tree", 400);
    expect(g.points.get("t3_p")!.x).toBe(200);
  });
});

describe("nearest", () => {
  const pts = new Map([
    ["a", { x: 10, y: 10 }],
    ["b", { x: 30, y: 10 }],
  ]);
  it("picks the closest message within reach", () => {
    expect(nearest(pts, 26, 12)).toBe("b");
    expect(nearest(pts, 12, 14)).toBe("a");
  });
  it("picks nothing out of reach", () => {
    expect(nearest(pts, 200, 200)).toBeNull();
  });
});

describe("branchOf", () => {
  it("lights the path from the post down to a message", () => {
    expect([...branchOf(layout(thread), ["t1_a1x"], "tree")].sort()).toEqual(["t1_a", "t1_a1", "t1_a1x", "t3_p"]);
  });
  it("follows reply links on a timeline", () => {
    expect([...branchOf(layout(session), ["d_5"], "timeline")].sort()).toEqual(["d_1", "d_3", "d_5"]);
  });
});

describe("focusView: what is open by default", () => {
  const laid = layout(scored);
  it("opens the message and its parent, previews what is above, and lists direct replies", () => {
    const v = focusView(laid, "t1_a1", "tree")!;
    expect(v.focus.id).toBe("t1_a1");
    expect(v.parent?.id).toBe("t1_a");
    expect(v.parentIs).toBe("reply-to");
    expect(v.chain.map((x) => x.id)).toEqual(["t3_p"]);
    expect(v.replies.map((x) => x.id)).toEqual(["t1_a1x"]);
  });
  it("puts the most engaged replies first", () => {
    const v = focusView(laid, "t3_p", "tree")!;
    expect(v.parent).toBeNull();
    expect(v.chain).toEqual([]);
    expect(v.replies.map((x) => x.id)).toEqual(["t1_b", "t1_a"]);
  });
  it("never shows the post as what an orphan answers: its real parent is missing from the data", () => {
    const v = focusView(laid, "t1_orphan", "tree")!;
    expect([v.parent, v.parentIs, v.parentMissing, v.chain]).toEqual([null, null, true, []]);
    expect(focusView(laid, "t1_a1", "tree")!.parentMissing).toBe(false);
    expect(focusView(laid, "t3_p", "tree")!.parentMissing).toBe(false);
  });
  it("keeps a deep chain in top-first order", () => {
    const v = focusView(laid, "t1_a1x", "tree")!;
    expect(v.parent?.id).toBe("t1_a1");
    expect(v.chain.map((x) => x.id)).toEqual(["t3_p", "t1_a"]);
  });
  it("on a timeline opens what a reply answers, or else the message just before", () => {
    const t = layout(sessionOf(session, "d_1"));
    const reply = focusView(t, "d_5", "timeline")!;
    expect([reply.parent?.id, reply.parentIs, reply.chain.map((x) => x.id)]).toEqual(["d_3", "reply-to", ["d_1"]]);
    const plain = focusView(t, "d_4", "timeline")!;
    expect([plain.parent?.id, plain.parentIs, plain.chain]).toEqual(["d_3", "just-before", []]);
    expect(focusView(t, "d_1", "timeline")!.replies.map((x) => x.id)).toEqual(["d_3"]);
    expect(focusView(t, "d_1", "timeline")!.parent).toBeNull();
  });
  it("returns nothing for a message not in the thread", () => {
    expect(focusView(laid, "nope", "tree")).toBeNull();
  });
});

describe("replyCounts", () => {
  it("counts direct replies in a tree by the real reply link: the orphan is nobody's reply", () => {
    const c = replyCounts(layout(thread));
    expect([c.get("t3_p"), c.get("t1_a"), c.get("t1_a1"), c.get("t1_b")]).toEqual([2, 2, 1, undefined]);
  });
  it("counts reply links on a timeline", () => {
    const c = replyCounts(layout(session));
    expect([c.get("d_1"), c.get("d_3"), c.get("d_2")]).toEqual([1, 1, undefined]);
  });
});
