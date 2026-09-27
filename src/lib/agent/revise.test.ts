import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelMessage } from "ai";
import type { Verification } from "./verify";

// The check-and-correct pass, with the verifier and the rewriting model stubbed: what matters here is the decision
// logic - when a rewrite is asked for, what it is told, and when its result is kept.

const verifyMock =
  vi.fn<(answer: string, retrieved: Set<string>, known?: unknown) => Promise<Verification>>();
const generateTextMock = vi.fn();

vi.mock("./verify", async (orig) => ({
  ...(await orig<typeof import("./verify")>()),
  verify: (a: string, r: Set<string>, k?: unknown) => verifyMock(a, r, k),
}));
vi.mock("ai", async (orig) => ({
  ...(await orig<typeof import("ai")>()),
  generateText: (o: unknown) => generateTextMock(o),
}));
vi.mock("./model", () => ({ textModel: () => "stub-model" }));
vi.mock("./agent", () => ({
  flattenForAnswer: () => [{ role: "user", content: "QUESTION: q\n\nRESULT (find):\nstuff" }],
}));
vi.mock("@/lib/data/read", () => ({
  getMessagesByRef: async (refs: number[]) => refs.map((ref) => ({ ref, text: `text of message ${ref}` })),
}));

const {
  checkAndRevise,
  citableRefs,
  citeAnswer,
  correctCounts,
  keepCountsRewrite,
  placeHandles,
  weakClaims,
} = await import("./revise");

const v = (
  claims: {
    claim: string;
    ids: string[];
    support: number | null;
    status?: "ok" | "unknown-id" | "not-retrieved";
  }[],
): Verification => ({
  claims: claims.map((c) => ({
    claim: c.claim,
    support: c.support,
    citations: c.ids.map((id) => ({ id, status: c.status ?? "ok", support: c.support })),
  })),
  cited: claims.filter((c) => c.ids.length).length,
  supported: claims.filter((c) => c.ids.length && (c.support ?? 0) >= 0.5).length,
  invalidIds: [],
  uncitedSentences: 0,
});

beforeEach(() => {
  verifyMock.mockReset();
  generateTextMock.mockReset();
});

describe("weakClaims", () => {
  it("flags unsupported, made-up and unseen citations, and ignores uncited sentences", () => {
    const w = weakClaims(
      v([
        { claim: "good", ids: ["msg1"], support: 0.9 },
        { claim: "weak", ids: ["msg2"], support: 0.2 },
        { claim: "made up", ids: ["msg3"], support: null, status: "unknown-id" },
        { claim: "unseen", ids: ["msg4"], support: 0.9, status: "not-retrieved" },
        { claim: "headline", ids: [], support: null },
      ]),
    );
    expect(w.map((c) => c.claim)).toEqual(["weak", "made up", "unseen"]);
  });
  it("never sends a claim the check did not reach for a rewrite, unless a citation of it is made up or unseen", () => {
    const x = v([
      { claim: "unchecked", ids: ["msg1"], support: null },
      { claim: "unchecked, made up", ids: ["msg2"], support: null, status: "unknown-id" },
    ]);
    x.claims.forEach((c) => (c.unchecked = true));
    expect(weakClaims(x).map((c) => c.claim)).toEqual(["unchecked, made up"]);
  });
});

describe("checkAndRevise", () => {
  it("does not call a model when every claim holds", async () => {
    verifyMock.mockResolvedValueOnce(v([{ claim: "good", ids: ["msg1"], support: 0.9 }]));
    const r = await checkAndRevise("Good [msg1].", new Set(["msg1"]), []);
    expect(r.text).toBe("Good [msg1].");
    expect(r.revision).toBeUndefined();
    expect(generateTextMock).not.toHaveBeenCalled();
  });

  it("sends the weak claims with the text of what they cite, and keeps a better-supported rewrite", async () => {
    verifyMock
      .mockResolvedValueOnce(
        v([
          { claim: "good", ids: ["msg1"], support: 0.9 },
          { claim: "weak", ids: ["msg2"], support: 0.1 },
        ]),
      )
      .mockResolvedValueOnce(
        v([
          { claim: "good", ids: ["msg1"], support: 0.9 },
          { claim: "fixed", ids: ["msg5"], support: 0.8 },
        ]),
      );
    generateTextMock.mockResolvedValueOnce({ text: "Good [msg1]. Fixed (msg5)." });
    const events: string[] = [];
    const r = await checkAndRevise("Good [msg1]. Weak [msg2].", new Set(["msg1", "msg2", "msg5"]), [], {
      revision: (x) => events.push(x.status),
    });

    const prompt = (generateTextMock.mock.calls[0][0] as { prompt: string }).prompt;
    expect(prompt).toContain("- CLAIM: weak");
    expect(prompt).toContain('[msg2] says: "text of message 2"');
    expect(prompt).not.toContain("- CLAIM: good");
    expect(r.text).toBe("Good [msg1]. Fixed [msg5]."); // normalised
    expect(r.verification.supported).toBe(2);
    expect(r.revision).toMatchObject({ status: "done", kept: true, before: { supported: 1, cited: 2 } });
    expect(events).toEqual(["running", "done"]);
  });

  it("keeps the original when the rewrite is worse supported", async () => {
    verifyMock
      .mockResolvedValueOnce(
        v([
          { claim: "a", ids: ["msg1"], support: 0.9 },
          { claim: "b", ids: ["msg2"], support: 0.1 },
        ]),
      )
      .mockResolvedValueOnce(
        v([
          { claim: "a", ids: ["msg1"], support: 0.2 },
          { claim: "b", ids: ["msg2"], support: 0.1 },
        ]),
      );
    generateTextMock.mockResolvedValueOnce({ text: "Worse [msg1]. Still [msg2]." });
    const r = await checkAndRevise("A [msg1]. B [msg2].", new Set(["msg1", "msg2"]), []);
    expect(r.text).toBe("A [msg1]. B [msg2].");
    expect(r.revision).toMatchObject({ status: "done", kept: false });
  });

  it("falls back to the original answer when the rewrite fails", async () => {
    verifyMock.mockResolvedValueOnce(v([{ claim: "b", ids: ["msg2"], support: 0.1 }]));
    generateTextMock.mockRejectedValueOnce(new Error("429 busy"));
    const r = await checkAndRevise("B [msg2].", new Set(["msg2"]), []);
    expect(r.text).toBe("B [msg2].");
    expect(r.revision).toMatchObject({ status: "failed" });
    expect(r.verification.supported).toBe(0);
  });
});

// QA 2026-09-26: "9 per day in September" when the counts gave 11.3 per day over 24 days. A stated rate no count gave is
// corrected like a weak claim, and the correction is told the rates the counts did give.
describe("checkAndRevise, a per-day rate no count gave", () => {
  const known = [{ value: 11.3, words: "11.3 per day over 24 days" }];
  const rateCheck = {
    claim: "September ran about 9 per day [msg1].",
    stated: "9",
    known: ["11.3 per day over 24 days"],
  };

  it("sends it back with the real rates, and keeps a rewrite that fixes it", async () => {
    verifyMock
      .mockResolvedValueOnce({
        ...v([{ claim: rateCheck.claim, ids: ["msg1"], support: 0.9 }]),
        rates: [rateCheck],
      })
      .mockResolvedValueOnce({
        ...v([{ claim: "September ran 11.3 per day [msg1].", ids: ["msg1"], support: 0.9 }]),
        rates: [],
      });
    generateTextMock.mockResolvedValueOnce({ text: "September ran 11.3 per day over its 24 days [msg1]." });
    const events: unknown[] = [];
    const r = await checkAndRevise(
      rateCheck.claim,
      new Set(["msg1"]),
      [],
      { revision: (x) => events.push(x) },
      known,
    );

    expect(verifyMock.mock.calls[0][2]).toBe(known);
    const prompt = (generateTextMock.mock.calls[0][0] as { prompt: string }).prompt;
    expect(prompt).toContain(
      "A CHECK FOUND THESE PER-DAY RATES THAT NO COUNT GAVE:\n- CLAIM: September ran about 9 per day [msg1].\n  It gives 9 per day, which no count gave.",
    );
    expect(prompt).toContain("The per-day rates the counts gave: 11.3 per day over 24 days.");
    expect(prompt).not.toContain("NOT SUPPORTED BY WHAT THEY CITE");
    expect(events[0]).toEqual({ status: "running", weak: 1 });
    expect(r.text).toBe("September ran 11.3 per day over its 24 days [msg1].");
    expect(r.revision).toMatchObject({ status: "done", kept: true });
  });

  it("keeps the original when the rewrite states more unmatched rates", async () => {
    verifyMock
      .mockResolvedValueOnce({ ...v([{ claim: "a", ids: ["msg1"], support: 0.9 }]), rates: [rateCheck] })
      .mockResolvedValueOnce({
        ...v([{ claim: "a", ids: ["msg1"], support: 0.9 }]),
        rates: [rateCheck, { ...rateCheck, stated: "5" }],
      });
    generateTextMock.mockResolvedValueOnce({ text: "Worse [msg1]." });
    const r = await checkAndRevise("A [msg1].", new Set(["msg1"]), [], {}, known);
    expect(r.text).toBe("A [msg1].");
    expect(r.revision).toMatchObject({ status: "done", kept: false });
  });

  // Review 2026-09-26 (D43 says fewer): with no weak claim, the rewrite was asked for only because of the rate, and one
  // that still states it was kept on "<=", a reworded answer that fixed nothing.
  it("keeps a rates-only rewrite only if it states fewer unmatched rates", async () => {
    verifyMock
      .mockResolvedValueOnce({ ...v([{ claim: "a", ids: ["msg1"], support: 0.9 }]), rates: [rateCheck] })
      .mockResolvedValueOnce({ ...v([{ claim: "a", ids: ["msg1"], support: 0.9 }]), rates: [rateCheck] });
    generateTextMock.mockResolvedValueOnce({ text: "September still ran about 9 per day [msg1]." });
    const r = await checkAndRevise(rateCheck.claim, new Set(["msg1"]), [], {}, known);
    expect(r.text).toBe(rateCheck.claim);
    expect(r.revision).toMatchObject({ status: "done", kept: false });
  });

  it("still keeps a rewrite that fixes weak claims and leaves the rate count as it was", async () => {
    verifyMock
      .mockResolvedValueOnce({ ...v([{ claim: "a", ids: ["msg1"], support: 0.2 }]), rates: [rateCheck] })
      .mockResolvedValueOnce({ ...v([{ claim: "a", ids: ["msg1"], support: 0.9 }]), rates: [rateCheck] });
    generateTextMock.mockResolvedValueOnce({ text: "Better [msg1]." });
    const r = await checkAndRevise("A [msg1].", new Set(["msg1"]), [], {}, known);
    expect(r.text).toBe("Better [msg1].");
    expect(r.revision).toMatchObject({ status: "done", kept: true });
  });
});

// Production QA 2026-09-26: "The September lift in Performance & Access and Updates & Feedback" when Updates &
// Feedback fell 6%. A direction the tools' changes contradict goes to the rewrite like a wrong rate (trends.ts).
describe("checkAndRevise, a change stated the wrong way round", () => {
  const change =
    "Change in conversations per day, 2026-08-01 to 2026-08-31 against 2026-09-01 to 2026-09-24: Performance & Access +121%; Updates & Feedback −6%.";
  const history: ModelMessage[] = [
    {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: "t1",
          toolName: "aggregate",
          output: { type: "text", value: change },
        },
      ],
    },
  ];
  const qa =
    "The September lift in Performance & Access and Updates & Feedback coincides with the 43.1 release [aggregate].";
  const good = v([{ claim: "x", ids: ["msg1"], support: 0.9 }]);

  it("sends it back with the change the counts give, and keeps a rewrite that states it right", async () => {
    verifyMock.mockResolvedValue(good);
    generateTextMock.mockResolvedValueOnce({
      text: "Performance & Access rose 121% while Updates & Feedback fell 6% [aggregate] [msg1].",
    });
    const events: unknown[] = [];
    const r = await checkAndRevise(qa, new Set(["msg1"]), history, { revision: (x) => events.push(x) });
    const prompt = (generateTextMock.mock.calls[0][0] as { prompt: string }).prompt;
    expect(prompt).toContain(
      `A CHECK FOUND THESE CHANGES STATED THE WRONG WAY ROUND:\n- CLAIM: ${qa}\n  It says Updates & Feedback rose; the counts give Updates & Feedback −6% per day.`,
    );
    expect(events[0]).toEqual({ status: "running", weak: 1 });
    expect(r.revision).toMatchObject({ status: "done", kept: true });
    expect(r.text).toMatch(/Updates & Feedback fell 6%/);
  });

  it("keeps the original when the rewrite still says it rose", async () => {
    verifyMock.mockResolvedValue(good);
    generateTextMock.mockResolvedValueOnce({ text: "Updates & Feedback grew in September [msg1]." });
    const r = await checkAndRevise(qa, new Set(["msg1"]), history);
    expect(r.text).toBe(qa);
    expect(r.revision).toMatchObject({ status: "done", kept: false });
  });

  it("asks for nothing when the directions agree with the counts", async () => {
    verifyMock.mockResolvedValue(good);
    const r = await checkAndRevise("Performance & Access rose [msg1].", new Set(["msg1"]), history);
    expect(r.revision).toBeUndefined();
    expect(generateTextMock).not.toHaveBeenCalled();
  });
});

// Open item 2026-09-26 (D45): an answer that cites nothing had its rates and directions unchecked. Its one rewrite is
// kept by its own rule, since no Jev pass runs on it.
describe("keepCountsRewrite and correctCounts, an answer that cites nothing", () => {
  const change =
    "Change in conversations per day, 2026-08-01 to 2026-08-31 against 2026-09-01 to 2026-09-24: Updates & Feedback +121%; Performance & Access −5%.";
  const counts =
    "updates: 113, 4.7 per day over 24 days (n=113)\nperf: 227, 9.5 per day over 24 days (n=227)";
  const history: ModelMessage[] = [
    {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: "t1",
          toolName: "aggregate",
          output: { type: "text", value: `${counts}\n${change}` },
        },
      ],
    },
  ];
  const known = [
    { value: 4.7, words: "4.7 per day over 24 days" },
    { value: 9.5, words: "9.5 per day over 24 days" },
  ];
  const trends = [
    { name: "Updates & Feedback", pct: 121 },
    { name: "Performance & Access", pct: -5 },
  ];
  const figures = [113, 4.7, 24, 227, 9.5, 121, 5];
  const wrong =
    "Updates & Feedback grew the most, to 3.8 per day. Performance & Access held at 9.5 per day. It is the biggest shift this summer.";
  const fixed =
    "Updates & Feedback grew the most, to 4.7 per day over 24 days. Performance & Access held at 9.5 per day. It is the biggest shift this summer.";

  it("keeps a rewrite with fewer mismatches, no citations, no new figure and its substance", () => {
    expect(keepCountsRewrite(wrong, fixed, known, trends, figures)).toBe(true);
  });
  it("does not keep one that adds a citation, which nothing would check", () => {
    expect(
      keepCountsRewrite(wrong, fixed.replace("24 days.", "24 days [msg1]."), known, trends, figures),
    ).toBe(false);
  });
  it("does not keep one that states a figure neither the answer nor a tool gave", () => {
    expect(
      keepCountsRewrite(wrong, fixed.replace("this summer", "in 14 months"), known, trends, figures),
    ).toBe(false);
  });
  it("does not keep one that drops a sentence it was not asked to fix", () => {
    expect(
      keepCountsRewrite(
        wrong,
        "Updates & Feedback grew the most, to 4.7 per day over 24 days.",
        known,
        trends,
        figures,
      ),
    ).toBe(false);
  });
  it("keeps one that drops only the flagged sentence", () => {
    expect(
      keepCountsRewrite(
        wrong,
        "Performance & Access held at 9.5 per day. It is the biggest shift this summer.",
        known,
        trends,
        figures,
      ),
    ).toBe(true);
  });
  it("does not keep one that fixes nothing, or comes back empty", () => {
    expect(
      keepCountsRewrite(wrong, wrong.replace("grew the most", "grew fastest"), known, trends, figures),
    ).toBe(false);
    expect(keepCountsRewrite(wrong, "  ", known, trends, figures)).toBe(false);
  });

  it("rewrites once, told to add no citations, and returns the rates still wrong in what it keeps", async () => {
    generateTextMock.mockResolvedValueOnce({ text: fixed });
    const events: unknown[] = [];
    const r = await correctCounts(wrong, history, known, { revision: (x) => events.push(x) });
    expect(generateTextMock).toHaveBeenCalledTimes(1);
    expect((generateTextMock.mock.calls[0][0] as { prompt: string }).prompt).toContain("add no citations");
    expect(events[0]).toEqual({ status: "running", weak: 1, counts: true });
    expect(r).toMatchObject({ text: fixed, rates: [], revision: { status: "done", kept: true } });
  });

  it("keeps the answer, and its wrong rate, when the rewrite fails", async () => {
    generateTextMock.mockRejectedValueOnce(new Error("timeout"));
    const r = await correctCounts(wrong, history, known);
    expect(r.text).toBe(wrong);
    expect(r.rates.map((x) => x.stated)).toEqual(["3.8"]);
    expect(r.revision).toMatchObject({ status: "failed" });
  });
});

// QA 2026-09-26, round 5: an answer quoting thread titles and a cause with no citation. One that read messages is sent
// back once to cite them from what the tools returned, or to drop what nothing returned says.
describe("citeAnswer", () => {
  it("asks for citations from the results and the removal of anything they do not show", async () => {
    generateTextMock.mockResolvedValue({ text: "Cheating leads [msg12,msg40].", finishReason: "stop" });
    const out = await citeAnswer("Cheating leads, traced to AWS server congestion.", [], new Set());
    expect(out.text).toBe("Cheating leads [msg12, msg40].");
    const call = generateTextMock.mock.calls[0][0] as { system: string; prompt: string };
    expect(call.system).toMatch(
      /^You add citations to an analyst's answer so every claim about what people said points to the messages it rests on/,
    );
    expect(call.prompt).toContain("QUESTION: q\n\nRESULT (find):\nstuff");
    expect(call.prompt).toContain(
      "THE ANSWER THAT WAS WRITTEN (it cites no messages):\nCheating leads, traced to AWS server congestion.",
    );
    expect(call.prompt).toContain(
      "Remove any claim no result supports: a thread named, a cause, an example or a quote that is not in the RESULTS goes.",
    );
    expect(call.prompt).toContain("Never cite a message you did not see in the RESULTS.");
  });

  it("lists the refs it may cite at the end of the prompt, where a long brief cannot bury them", async () => {
    generateTextMock.mockResolvedValue({ text: "Cheating leads [msg12].", finishReason: "stop" });
    await citeAnswer("Cheating leads.", [scanResult("c1", conv(12, [12, 40]))], new Set(["msg12", "msg40"]));
    const call = generateTextMock.mock.calls.at(-1)![0] as { prompt: string };
    expect(
      call.prompt.endsWith(
        "\n\nThe message refs in the RESULTS, the only ones you may cite: [msg12], [msg40].",
      ),
    ).toBe(true);
  });

  // Review 2026-09-26: normalizeCitations deleted [convN] and raw ids silently, so a pass that cited conversations
  // looked like one that cited nothing, and the log showed the tidied text without why the model stopped.
  it("places a citation written as a conversation handle on a message of that conversation, and reports what it cannot place", async () => {
    generateTextMock.mockResolvedValue({
      text: "Lag is back [conv2]. Queues are long (conv1, msg3). Servers died [conv9] [t3_abc123].",
      finishReason: "length",
    });
    const history = [scanResult("c1", conv(1, [1, 3]) + "\n\n" + conv(2, [10, 11]))];
    const out = await citeAnswer("Lag is back.", history, new Set(["msg1", "msg3", "msg10", "msg11"]));
    expect(out.text).toBe("Lag is back [msg10]. Queues are long [msg1, msg3]. Servers died.");
    expect(out).toMatchObject({
      finishReason: "length",
      placed: 2,
      rejected: ["conv9", "t3_abc123"],
      offered: 4,
    });
    expect(out.raw).toBe(
      "Lag is back [conv2]. Queues are long (conv1, msg3). Servers died [conv9] [t3_abc123].",
    );
  });
});

const conv = (handle: number, refs: number[]) =>
  `## conversation conv${handle} · Discussion · topic patch · relevance 90% · 2026-07-01\n` +
  refs.map((r) => `[msg${r}] someone · 2026-07-01 · 3: words`).join("\n");
const scanResult = (toolCallId: string, value: string): ModelMessage => ({
  role: "tool",
  content: [
    {
      type: "tool-result",
      toolCallId,
      toolName: "scan",
      output: { type: "text", value: `Scanned 40 conversations.\n\n${value}` },
    },
  ],
});

// Review 2026-09-26: listed in the order the tools returned them, one long thread (patch notes) filled all 80 places,
// most of them past the 2,500-character cut the model read.
describe("citableRefs", () => {
  it("takes the refs round-robin across conversations: the first of each, then the second of each", () => {
    const history = [scanResult("c1", [conv(1, [1, 2, 3]), conv(2, [10, 11]), conv(3, [20])].join("\n\n"))];
    const { refs } = citableRefs(history, new Set(["msg1", "msg2", "msg3", "msg10", "msg11", "msg20"]));
    expect(refs).toEqual(["msg1", "msg10", "msg20", "msg2", "msg11", "msg3"]);
  });

  it("offers only refs in the text the model read that this turn retrieved", () => {
    // msg99 was retrieved (past the cut, so never in the text the model read); msg50 is an earlier turn's.
    const history = [scanResult("old", conv(5, [50])), scanResult("c1", conv(1, [1, 2]))];
    expect(citableRefs(history, new Set(["msg1", "msg2", "msg99"])).refs).toEqual(["msg1", "msg2"]);
  });

  it("keeps every conversation in the list when one long thread would fill it", () => {
    const long = Array.from({ length: 100 }, (_, i) => i + 1);
    const history = [scanResult("c1", conv(1, long) + "\n\n" + conv(2, [500, 501]))];
    const { refs } = citableRefs(history, new Set([...long, 500, 501].map((r) => `msg${r}`)));
    expect(refs).toHaveLength(80);
    expect(refs.slice(0, 4)).toEqual(["msg1", "msg500", "msg2", "msg501"]);
  });

  it("files a thread opened in full under its own handle", () => {
    const history: ModelMessage[] = [
      {
        role: "assistant",
        content: [
          { type: "tool-call", toolCallId: "r1", toolName: "read_conversation", input: { id: "conv7" } },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "r1",
            toolName: "read_conversation",
            output: {
              type: "text",
              value: "Title [Discussion]\n[msg70] a 2026-07-01: x\n[msg71] b 2026-07-01: y",
            },
          },
        ],
      },
    ];
    const { refs, byConv } = citableRefs(history, new Set(["msg70", "msg71"]));
    expect(refs).toEqual(["msg70", "msg71"]);
    expect(byConv.get("conv7")).toEqual(["msg70", "msg71"]);
  });
});

describe("placeHandles", () => {
  it("leaves prose and message citations alone", () => {
    expect(placeHandles("Lag [msg1] in the conversation.", new Map())).toEqual({
      text: "Lag [msg1] in the conversation.",
      placed: 0,
      rejected: [],
    });
  });
});
