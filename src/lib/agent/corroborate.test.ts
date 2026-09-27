import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MessageRef } from "@/lib/data/types";
import { pruneWeak } from "@/lib/claims";
import { citedTags } from "@/lib/refs";
import type { Verification } from "./verify";

// Which conversations back a claim. The database and Jev are stubbed; what matters is the pool, the per-conversation
// questions, and the tally that turns Jev's answers into "+N more say this".

const decideMock = vi.fn();
const msgs: MessageRef[] = [];
vi.mock("@/lib/llm/decide", async (orig) => ({
  ...(await orig<typeof import("@/lib/llm/decide")>()),
  decide: (a: unknown) => decideMock(a),
}));
vi.mock("@/lib/data/search", () => ({
  messagesFor: async (ids: string[]) => msgs.filter((m) => ids.includes(m.conversation_id!)),
}));
vi.mock("@/lib/data/read", () => ({
  getMessagesByRef: async (refs: number[]) => msgs.filter((m) => refs.includes(m.ref)),
}));
vi.mock("@/lib/data/db", () => ({
  query: async (_: string, [ids]: [string[]]) => ids.map((id) => ({ id, thread_title: `Thread ${id}` })),
}));

const { corroborate, messagesToAsk, poolOf, tally, questionKey } = await import("./corroborate");

const m = (ref: number, conv: string, over: Partial<MessageRef> = {}): MessageRef => ({
  id: `msg_${ref}`,
  ref,
  kind: "message",
  channel: "game-chat",
  thread_id: conv,
  reply_to: null,
  conversation_id: conv,
  in_window: true,
  author: `u${ref}`,
  ts: `2026-09-0${(ref % 9) + 1}T10:00:00Z`,
  text: `message ${ref}`,
  n_reactions: ref,
  score: ref,
  removed: false,
  is_bot: false,
  ...over,
});
const result = (toolName: string, output: unknown) => ({
  content: [{ type: "tool-result", toolName, output }],
});

describe("poolOf", () => {
  it("takes every scan's relevant set first, then search hits and full reads, once each", () => {
    const steps = [
      result("scan", { status: "ok", relevant: 3, relevantIds: ["a", "b", "c"], hits: [] }),
      result("find", { hits: [{ id: "c" }, { id: "d" }] }),
      result("read_conversation", { id: "e" }),
      result("scan", { status: "too-broad", total: 9000 }),
    ];
    // a search and a thread opened in full feed the pool but are not reads (review 2026-09-26)
    expect(poolOf(steps)).toEqual({ ids: ["a", "b", "c", "d", "e"], found: 5, reads: 1 });
  });
  // Review 2026-09-26: "the three reads" stood under one Read line and a search.
  it("counts the different slices the scans read, as the steps do", () => {
    const scan = (filters: object, ids: string[]) =>
      result("scan", { status: "ok", relevant: ids.length, relevantIds: ids, filters });
    const complaints = { flag: "complaint", since: "2026-09-09" };
    // one slice read twice, for two questions, is one read; its dates written another way are the same slice
    expect(
      poolOf([scan(complaints, ["a"]), scan({ ...complaints, since: "2026-09-09T00:00:00Z" }, ["b"])]).reads,
    ).toBe(1);
    expect(
      poolOf([
        scan(complaints, ["a"]),
        scan({ topic: "maps-modes" }, ["b"]),
        result("find", { hits: [{ id: "c" }] }),
      ]).reads,
    ).toBe(2);
    // a slice named only by the call (an older result without its filters) still counts once
    const byInput = {
      content: [
        {
          type: "tool-result",
          toolName: "scan",
          input: { filters: complaints },
          output: { status: "ok", relevant: 1, relevantIds: ["a"] },
        },
      ],
    };
    expect(poolOf([byInput, scan(complaints, ["b"])]).reads).toBe(1);
    // a refused call found nothing and is no read
    expect(
      poolOf([result("scan", { status: "refused", flag: "complaint", words: "Not run: …" })]).reads,
    ).toBe(0);
  });
  it("counts one scan's set as exactly the scan's own relevant count, and two reads of one slice as the conversations either found", () => {
    // the footer's number is the answer's scan number when one scan produced the set
    expect(poolOf([result("scan", { status: "ok", relevant: 3, relevantIds: ["a", "b", "c"] })]).found).toBe(
      3,
    );
    // QA: 118 complaints read twice, 114 and 109 relevant: the pool is every conversation either read found, 114
    const first = Array.from({ length: 114 }, (_, i) => `c${i}`);
    const steps = [
      result("scan", { status: "ok", relevant: 114, relevantIds: first }),
      result("scan", { status: "ok", relevant: 109, relevantIds: first.slice(5) }),
    ];
    expect(poolOf(steps).found).toBe(114);
  });
  it("cuts to size and still counts what a scan found beyond its list", () => {
    const steps = [result("scan", { status: "ok", relevant: 500, relevantIds: ["a", "b", "c"] })];
    expect(poolOf(steps, 2)).toEqual({ ids: ["a", "b"], found: 500, reads: 1 });
  });
});

describe("messagesToAsk", () => {
  it("asks about the best-scored readable messages, never a bot, a removed one or context from before the window", () => {
    const got = messagesToAsk(
      [
        m(1, "a"),
        m(9, "a"),
        m(5, "a", { removed: true }),
        m(7, "a", { is_bot: true }),
        m(8, "a", { in_window: false }),
        m(3, "a"),
      ],
      2,
    );
    expect(got.map((x) => x.ref)).toEqual([9, 3]);
  });
});

describe("tally", () => {
  const claims = [
    { claim: "Stutter after the patch.", tags: ["msg1"] },
    { claim: "Servers lag.", tags: ["msg20"] },
  ];
  const read = (conv: string, refs: number[], answers: Record<string, number> | null) => ({
    conversationId: conv,
    title: `T ${conv}`,
    messages: refs.map((r) => m(r, conv)),
    answers,
  });

  it("counts a conversation once, through its best message, and lists only the ones the answer does not cite", () => {
    const reads = [
      read("a", [1, 2], { [questionKey(0, 1)]: 0.9, [questionKey(0, 2)]: 0.6 }), // the cited conversation
      read("b", [3, 4], { [questionKey(0, 3)]: 0.55, [questionKey(0, 4)]: 0.8 }),
      read("c", [5], { [questionKey(0, 5)]: 0.3, [questionKey(1, 5)]: 0.7 }),
      read("d", [6], null), // Jev failed on it: counted nowhere
    ];
    const [stutter, lag] = tally(
      claims,
      reads,
      new Map([
        ["msg1", "a"],
        ["msg20", "z"],
      ]),
    );
    expect(stutter.conversations).toBe(2);
    expect(stutter.more.map((x) => [x.conversation_id, x.ref, x.support])).toEqual([["b", 4, 0.8]]);
    expect(stutter.more[0].threadTitle).toBe("T b");
    expect(lag.conversations).toBe(2); // conversation c, and z where its cited message sits
    expect(lag.moreTotal).toBe(1);
  });
});

describe("corroborate", () => {
  beforeEach(() => {
    decideMock.mockReset();
    msgs.length = 0;
    msgs.push(m(1, "a"), m(2, "b"), m(3, "b"), m(4, "c"));
  });
  const v = (claims: Verification["claims"]): Verification => ({
    claims,
    cited: claims.length,
    supported: 0,
    invalidIds: [],
    uncitedSentences: 0,
  });

  it("asks every claim about every message of each conversation in ONE request per conversation", async () => {
    decideMock.mockImplementation(async ({ questions }: { questions: Record<string, unknown> }) => ({
      answers: Object.fromEntries(
        Object.keys(questions).map((k) => [k, { type: "noul", noul: k === questionKey(0, 3) ? 0.9 : 0.1 }]),
      ),
    }));
    const out = await corroborate(
      v([
        { claim: "Stutter.", support: 0.9, citations: [{ id: "msg1", status: "ok", support: 0.9 }] },
        {
          claim: "Made up.",
          support: null,
          citations: [{ id: "msg99", status: "unknown-id", support: null }],
        },
      ]),
      [result("scan", { status: "ok", relevant: 3, relevantIds: ["a", "b", "c"] })],
    );
    expect(decideMock).toHaveBeenCalledTimes(3);
    const bCall = decideMock.mock.calls.find(([a]) => Object.keys(a.state.messages).includes("msg3"))![0];
    expect(Object.keys(bCall.questions).sort()).toEqual([questionKey(0, 2), questionKey(0, 3)].sort());
    expect(bCall.state.claims).toEqual({ c0: "Stutter." }); // a claim with no real citation is not asked about
    // each message carries its author, so a claim about one person is judged on that person's own messages
    expect(bCall.state.messages.msg3).toEqual({ author: "u3", text: "message 3" });
    expect(out).toMatchObject({ status: "done", pool: 3, found: 3, reads: 1, failed: 0 });
    if (out.status !== "done") throw new Error();
    expect(out.claims[0]).toMatchObject({ conversations: 2, moreTotal: 1 });
    expect(out.claims[0].more[0]).toMatchObject({ ref: 3, threadTitle: "Thread b" });
  });

  // QA 2026-09-26: a claim showing 3 chips said "14 conversations say this: 10 more than the ones cited", and the panel
  // "4 are cited in the answer". The fourth was a weak citation, pruned from the text but still counted as cited.
  it("counts as cited exactly the chips the reader sees, so the ones cited plus the more are all that say it", async () => {
    decideMock.mockImplementation(async ({ questions }: { questions: Record<string, unknown> }) => ({
      answers: Object.fromEntries(
        Object.keys(questions).map((k) => [
          k,
          { type: "noul", noul: [questionKey(0, 3), questionKey(0, 4)].includes(k) ? 0.9 : 0.1 },
        ]),
      ),
    }));
    const claim = {
      claim: "Stutter after the patch.",
      support: 0.9,
      citations: [
        { id: "msg1", status: "ok" as const, support: 0.9 }, // conversation a: backs it, shown
        { id: "msg2", status: "ok" as const, support: 0.2 }, // conversation b: weak, pruned from the text
      ],
    };
    const out = await corroborate(v([claim]), [
      result("scan", { status: "ok", relevant: 3, relevantIds: ["a", "b", "c"] }),
    ]);
    if (out.status !== "done") throw new Error();
    const chips = citedTags(pruneWeak("Stutter after the patch [msg1, msg2].", [claim]));
    expect(chips).toEqual(["msg1"]);
    expect(out.claims[0].tags).toEqual(chips);
    // a (cited), b and c (more): 3 say it, 2 more than the one chip
    expect(out.claims[0]).toMatchObject({ conversations: 3, moreTotal: 2 });
    expect(out.claims[0].conversations - out.claims[0].moreTotal).toBe(chips.length);
    expect(out.claims[0].more.map((x) => x.conversation_id).sort()).toEqual(["b", "c"]);
  });

  it("counts a failed read instead of failing the whole check", async () => {
    decideMock.mockRejectedValue(new Error("timeout"));
    const out = await corroborate(
      v([{ claim: "Stutter.", support: 0.9, citations: [{ id: "msg1", status: "ok", support: 0.9 }] }]),
      [result("scan", { status: "ok", relevant: 2, relevantIds: ["a", "b"] })],
    );
    expect(out).toMatchObject({ status: "done", failed: 2 });
  });

  it("does nothing without a cited claim or a pool", async () => {
    const out = await corroborate(v([]), [result("scan", { status: "ok", relevant: 1, relevantIds: ["a"] })]);
    expect(out).toMatchObject({ status: "done", claims: [] });
    expect(decideMock).not.toHaveBeenCalled();
  });
});
