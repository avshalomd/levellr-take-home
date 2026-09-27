import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Cited, Checked } from "./revise";

// The post-steps the chat route and the eval share (review 2026-09-26). The cite and check passes are stubbed: what
// matters here is which runs when, what text comes out, and that no part is ever left running.

const citeAnswer = vi.fn<(...a: unknown[]) => Promise<Cited>>();
const checkAndRevise =
  vi.fn<
    (
      answer: string,
      retrieved: Set<string>,
      history: unknown,
      on?: { revision?: (r: unknown) => void },
      known?: unknown,
    ) => Promise<Checked>
  >();
vi.mock("./revise", () => ({
  citeAnswer: (...a: unknown[]) => citeAnswer(...a),
  checkAndRevise: (...a: Parameters<typeof checkAndRevise>) => checkAndRevise(...a),
}));
const answerFromTools = vi.fn<(history: unknown) => Promise<string>>();
vi.mock("./agent", () => ({
  retrievedRefs: () => new Set(["msg11", "msg12"]),
  answerFromTools: (h: unknown) => answerFromTools(h),
}));

const { afterAgent, afterCite, stepsText } = await import("./finish");

const result = (toolName: string, output: unknown) => ({ type: "tool-result", toolName, output });
const read = { content: [result("scan", { status: "ok", scanned: 40, relevant: 12, hits: [] })] };
const offTopic = {
  content: [
    result("out_of_scope", {
      status: "off-topic",
      text: "I can't answer that. You could ask:\n\n- What broke?",
    }),
  ],
};
const verification = { claims: [], supported: 1, cited: 1, invalidIds: [], uncitedSentences: 0 };
const cited = (text: string, over: Partial<Cited> = {}): Cited => ({
  text,
  raw: text,
  finishReason: "stop",
  offered: 2,
  placed: 0,
  rejected: [],
  ...over,
});

/** Runs the post-steps and collects every part they write. */
async function run(text: string, steps: unknown[]) {
  const chunks: {
    type: string;
    id?: string;
    data?: { status?: string } & Record<string, unknown>;
    delta?: string;
  }[] = [];
  // The answer's words are the last step's text, as a model that reads and then answers writes them.
  const all = [...steps, { content: [{ type: "text", text }] }];
  const out = await afterAgent({ steps: all as never, history: [] }, (c) => void chunks.push(c as never));
  const last = (type: string) => chunks.filter((c) => c.type === type).at(-1)?.data;
  return { out, chunks, revision: last("data-revision"), verification: last("data-verification") };
}

beforeEach(() => {
  answerFromTools.mockReset().mockResolvedValue("");
  citeAnswer.mockReset();
  checkAndRevise.mockReset().mockImplementation(async (answer) => ({ text: answer, verification }));
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("afterAgent, an off-topic question", () => {
  it("answers with the reply written in code, as text when the model wrote nothing, and checks nothing", async () => {
    const { out, chunks } = await run("", [offTopic]);
    expect(out.text).toMatch(/^I can't answer that\./);
    expect(chunks.map((c) => c.type)).toEqual(["text-start", "text-delta", "text-end"]);
    expect(checkAndRevise).not.toHaveBeenCalled();
    expect(citeAnswer).not.toHaveBeenCalled();
  });
  it("replaces a line the model wrote first with a kept revision", async () => {
    const { out, revision } = await run("Sorry, I can't help with pizza.", [offTopic]);
    expect(out.text).toMatch(/^I can't answer that\./);
    expect(revision).toMatchObject({ status: "done", kept: true, text: out.text });
  });
});

describe("afterAgent, an answer that read and cites nothing", () => {
  // Review 2026-09-26: the cited text was written only after the check, so a check that threw lost it and left the
  // part "running, cite" in the saved chat.
  it("keeps the cited text as soon as the cite pass succeeds, even when the check then throws", async () => {
    citeAnswer.mockResolvedValue(cited("People complain about lag [msg11]."));
    checkAndRevise.mockRejectedValue(new Error("verify timed out"));
    const { out, chunks, revision, verification } = await run("People complain about lag.", [read]);
    const revisions = chunks.filter((c) => c.type === "data-revision").map((c) => c.data);
    expect(revisions).toEqual([
      { status: "running", weak: 1, cite: true },
      {
        status: "done",
        kept: true,
        cite: true,
        text: "People complain about lag [msg11].",
        before: { supported: 0, cited: 0 },
      },
    ]);
    expect(revision).toMatchObject({ status: "done", cite: true });
    expect(verification).toMatchObject({ status: "failed" });
    expect(out.text).toBe("People complain about lag [msg11].");
    expect(out.checked).toBeUndefined();
  });

  it("puts the cited text back when the check's correction is not kept or fails", async () => {
    citeAnswer.mockResolvedValue(cited("Lag [msg11]."));
    checkAndRevise.mockImplementation(async (answer, _r, _h, on) => {
      on?.revision?.({ status: "running", weak: 1 });
      on?.revision?.({ status: "done", kept: false, text: "Worse.", before: { supported: 0, cited: 1 } });
      return { text: answer, verification };
    });
    const { out, revision, verification: v } = await run("Lag.", [read]);
    expect(revision).toMatchObject({ status: "done", kept: true, cite: true, text: "Lag [msg11]." });
    expect(v).toMatchObject({ status: "done", cited: 1 });
    expect(out.text).toBe("Lag [msg11].");
    expect(out.checked).toEqual(verification);
  });

  it("shows a correction the check kept, which is no longer the cite pass's own text", async () => {
    citeAnswer.mockResolvedValue(cited("Lag [msg11]."));
    checkAndRevise.mockImplementation(async (_a, _r, _h, on) => {
      const done = {
        status: "done",
        kept: true,
        text: "Lag after 43.1 [msg12].",
        before: { supported: 0, cited: 1 },
      } as const;
      on?.revision?.(done);
      return { text: done.text, verification, revision: done };
    });
    const { out, revision } = await run("Lag.", [read]);
    expect(revision).toMatchObject({ status: "done", kept: true, text: "Lag after 43.1 [msg12]." });
    expect(revision?.cite).toBeUndefined();
    expect(out.text).toBe("Lag after 43.1 [msg12].");
  });

  it("logs the model's own words and why it stopped when the pass cites nothing, and says the answer is uncited", async () => {
    citeAnswer.mockResolvedValue(
      cited("Lag is bad.", { raw: "Lag is bad [conv9].", finishReason: "length", rejected: ["conv9"] }),
    );
    const { revision, verification: v, chunks } = await run("Lag is bad.", [read]);
    expect(console.warn).toHaveBeenCalledWith(
      "cite pass added no citations",
      expect.objectContaining({ finishReason: "length", raw: "Lag is bad [conv9].", rejected: ["conv9"] }),
    );
    expect(revision).toMatchObject({ status: "failed" });
    expect(v).toEqual({ status: "uncited", read: true });
    expect(checkAndRevise).not.toHaveBeenCalled();
    expect(chunks.filter((c) => c.data?.status === "running").length).toBe(2); // opened, and closed after
  });

  it("closes every part when the cite pass itself throws", async () => {
    citeAnswer.mockRejectedValue(new Error("429 busy"));
    const { revision, verification: v } = await run("Lag is bad.", [read]);
    expect(revision).toMatchObject({ status: "failed" });
    expect(v).toEqual({ status: "uncited", read: true });
  });

  // Review 2026-09-26: the pass ran on an empty answer, and left "Finding the messages…" beside "unfinished".
  it("never sends an empty answer to be cited, and writes nothing under it", async () => {
    // the answer from the tools failed too (answerFromTools gives "")
    const { chunks, out } = await run("  ", [read]);
    expect(citeAnswer).not.toHaveBeenCalled();
    expect(chunks).toEqual([]);
    expect(out.text.trim()).toBe("");
  });
});

describe("afterAgent, a turn that used the tools and left no words", () => {
  // Eval run 7, T04: the model wrote its next tool call as text, which is stripped, and the reader got nothing.
  it("answers once from what the tools returned, streams it as the answer, then cites it", async () => {
    answerFromTools.mockResolvedValue("People complain about lag.");
    citeAnswer.mockResolvedValue(cited("People complain about lag [msg11]."));
    const history = [{ role: "user", content: "What do people complain about?" }];
    const chunks: { type: string; id?: string; delta?: string }[] = [];
    const out = await afterAgent(
      {
        steps: [
          read,
          { content: [{ type: "text", text: '<dots_function_call><invoke name="aggregate">' }] },
        ] as never,
        history: history as never,
      },
      (c) => void chunks.push(c as never),
    );
    expect(answerFromTools).toHaveBeenCalledWith(history);
    expect(chunks.slice(0, 3)).toEqual([
      { type: "text-start", id: "from-tools" },
      { type: "text-delta", id: "from-tools", delta: "People complain about lag." },
      { type: "text-end", id: "from-tools" },
    ]);
    expect(citeAnswer).toHaveBeenCalledWith("People complain about lag.", history, expect.any(Set));
    expect(out.text).toBe("People complain about lag [msg11].");
    expect(out.grounding).toEqual({ kind: "uncited", read: true }); // as the agent left it, before the cite pass
  });
  it("is not asked for a turn that used no tool, or an off-topic one", async () => {
    await run("", []);
    await run("", [offTopic]);
    expect(answerFromTools).not.toHaveBeenCalled();
  });
  it("is not asked when the agent wrote an answer", async () => {
    citeAnswer.mockResolvedValue(cited("Lag [msg11]."));
    await run("Lag.", [read]);
    expect(answerFromTools).not.toHaveBeenCalled();
  });
});

describe("afterAgent, a rewrite that runs after a kept cite pass", () => {
  // Review 2026-09-26: the check's "running" revision replaced the kept cite revision under the same id, and the page
  // shows only a kept text, so for the 10-60 s of the rewrite the uncited stream came back and the chips went.
  it("carries the cited text on the running part, so it stays on screen", async () => {
    citeAnswer.mockResolvedValue(cited("Lag [msg11]."));
    checkAndRevise.mockImplementation(async (answer, _r, _h, on) => {
      on?.revision?.({ status: "running", weak: 1 });
      on?.revision?.({ status: "done", kept: false, text: "Worse.", before: { supported: 0, cited: 1 } });
      return { text: answer, verification };
    });
    const { chunks } = await run("Lag.", [read]);
    const revisions = chunks.filter((c) => c.type === "data-revision").map((c) => c.data);
    expect(revisions[2]).toEqual({ status: "running", weak: 1, text: "Lag [msg11]." });
  });

  it("afterCite leaves every revision alone when there was no kept cite pass", () => {
    const running = { status: "running", weak: 2 } as const;
    expect(afterCite(running, undefined)).toBe(running);
    const kept = {
      status: "done",
      kept: true,
      cite: true,
      text: "Lag [msg11].",
      before: { supported: 0, cited: 0 },
    } as const;
    expect(afterCite({ status: "failed", error: "x" }, kept)).toBe(kept);
    const better = {
      status: "done",
      kept: true,
      text: "Lag after 43.1 [msg12].",
      before: { supported: 0, cited: 1 },
    } as const;
    expect(afterCite(better, kept)).toBe(better);
  });
});

// Review 2026-09-26: the route and the eval passed result.text, the last step's text only in AI SDK 7, while the reader
// is shown every step's (components/chat/evidence.ts). A claim written before a tool call was never checked, and a
// short last line made the grounding "uncited" and a cite pass replace the whole answer with a rewrite of that line.
describe("afterAgent, an answer written across steps", () => {
  it("checks every step's text, joined as the reader's page joins it", async () => {
    const first = { content: [{ type: "text", text: "Lag is back since 43.1 [msg11]." }, ...read.content] };
    const last = { content: [{ type: "text", text: "That is the picture." }] };
    const out = await afterAgent({ steps: [first, last] as never, history: [] });
    expect(citeAnswer).not.toHaveBeenCalled();
    expect(checkAndRevise.mock.calls[0][0]).toBe("Lag is back since 43.1 [msg11].\n\nThat is the picture.");
    expect(out.text).toBe("Lag is back since 43.1 [msg11].\n\nThat is the picture.");
  });

  it("stepsText joins steps on a blank line and skips steps with no words", () => {
    const t = (text: string) => ({ type: "text", text });
    expect(
      stepsText([
        { content: [t("A."), t(" B.")] },
        { content: [{ type: "tool-call" }] },
        { content: [t("C.")] },
      ]),
    ).toBe("A. B.\n\nC.");
  });
});

describe("afterAgent, an answer that cites", () => {
  it("checks it, and returns the check for the route's corroboration", async () => {
    const { out, verification: v } = await run("Lag [msg11].", [read]);
    expect(citeAnswer).not.toHaveBeenCalled();
    expect(checkAndRevise).toHaveBeenCalledOnce();
    expect(v).toMatchObject({ status: "done", supported: 1 });
    expect(out.checked).toEqual(verification);
  });

  // QA 2026-09-26: the check is given the per-day rates the tools gave, this turn and before (rates.ts).
  it("gives the check the per-day rates the tools gave", async () => {
    const history = [
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "c",
            toolName: "scan",
            output: { type: "text", value: "271 relevant, 11.3 per day over 24 days" },
          },
        ],
      },
    ];
    await afterAgent({
      steps: [read, { content: [{ type: "text", text: "Lag [msg11]." }] }] as never,
      history: history as never,
    });
    expect(checkAndRevise.mock.calls[0][4]).toEqual([{ value: 11.3, words: "11.3 per day over 24 days" }]);
  });

  // QA 2026-09-26: "[msg4471 — Sept]" and "[msg12, Sept]" reached the reader as text. No "[msg" survives in the text
  // the reader is shown unless it is a plain citation group a chip is made from.
  it("leaves no decorated or cross-turn citation as loose text", async () => {
    const { out } = await run(
      "Lag is back [msg11 — Sept]. Queues are long (msg12, Sept). Crashes too [msg4471, msg12 – from last turn].",
      [read],
    );
    expect(out.text.replace(/\[msg\d+(?:, msg\d+)*\]/g, "")).not.toMatch(/msg/);
    expect(checkAndRevise.mock.calls[0][0]).toBe(out.text);
  });
});
