import { beforeEach, describe, expect, it, vi } from "vitest";
import { MockLanguageModelV4 } from "ai/test";
import { MAX_CALLS, oneCallEach, retryEmpty } from "./agent";

// What the first step of a turn is made to do, over a mocked model and a stubbed data layer (as forced-read.test.ts).
// Production QA 2026-09-27: an empty first step ended the turn with no answer (P1); a follow-up asking which of the
// frustrations were bugs answered from the last answer's words with no tool call (P3); and what to post rested on an
// excitement read alone, with no engagement count (P4).

vi.mock("@/lib/data/profile", () => ({
  profile: async () => ({
    community: "the Veil of Ages Discord",
    platform: "discord",
    about: "",
    from: "2026-09-13",
    to: "2026-09-27",
    now: "2026-09-27T19:30:00.000Z",
  }),
}));
vi.mock("@/lib/data/db", () => ({ query: async () => [] }));
vi.mock("@/lib/data/scan", () => ({
  scan: vi.fn(async () => ({ status: "empty", question: "", filters: {} })),
  MAX_SCAN: 2500,
}));
vi.mock("@/lib/data/search", () => ({
  searchConversations: vi.fn(async () => ({ hits: [], candidates: 0 })),
}));
vi.mock("@/lib/data/voices", () => ({ topVoices: vi.fn() }));
vi.mock("@/lib/data/aggregate", () => ({
  aggregate: vi.fn(async () => ({ metric: "engagement", groupBy: "topic", filters: {}, rows: [] })),
  METRICS: { conversations: {}, engagement: {} },
  GROUPINGS: { none: {}, topic: {} },
}));
vi.mock("@/lib/data/read", () => ({
  conversationIdOf: vi.fn(async () => "c1"),
  getConversation: vi.fn(async () => ({ thread_title: "#remaster-discussion: hi", messages: [] })),
  getOverview: vi.fn(),
  topicLabels: async () => [{ key: "domains", name: "Domains", description: "" }],
}));

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 1, text: 1, reasoning: undefined },
};
const call = (id: string, toolName: string, input: object) => ({
  type: "tool-call" as const,
  toolCallId: id,
  toolName,
  input: JSON.stringify(input),
});

// Each step records what it was offered; `script` says what the model gives back at each call.
type Offer = { choice?: string; tools: string[] };
const offers: Offer[] = [];
let script: ((o: Offer) => unknown[])[] = [];
const model = new MockLanguageModelV4({
  doGenerate: async (options) => {
    const offer = { choice: options.toolChoice?.type, tools: (options.tools ?? []).map((t) => t.name) };
    offers.push(offer);
    const content = (script.shift() ?? (() => [{ type: "text" as const, text: "An answer." }]))(offer);
    const calls = (content as { type: string }[]).some((c) => c.type === "tool-call");
    return {
      content: content as never,
      finishReason: { unified: calls ? "tool-calls" : "stop", raw: undefined },
      usage,
      warnings: [],
    };
  },
});
vi.mock("./model", () => ({ chatModel: () => model, answerModel: () => model }));

const { makeAgent } = await import("./agent");

beforeEach(() => {
  offers.length = 0;
  script = [];
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

const earlier = [
  { role: "user" as const, content: "What are the top frustrations players have right now?" },
  { role: "assistant" as const, content: "People are frustrated about the Domains difficulty [msg1]." },
];

describe("an empty step (P1)", () => {
  it("is asked again once, made to call a tool, and the turn goes on to answer", async () => {
    script = [
      () => [], // no words, no tool call
      (o) => (o.choice === "required" ? [call("r1", "read_conversation", { id: "conv1268" })] : []),
      () => [{ type: "text", text: "People in that conversation talked about the lore." }],
    ];
    const { agent } = await makeAgent();
    const r = await agent.generate({ prompt: "What did people say in conv1268 in #remaster-discussion?" });
    expect(offers.map((o) => o.choice)).toEqual(["auto", "required", "auto"]);
    expect(r.steps[0].toolCalls.map((c) => c.toolName)).toEqual(["read_conversation"]);
    expect(r.text).toBe("People in that conversation talked about the lore.");
  });

  it("is asked again at most once: a second empty step is left for the forced answer (finish.ts)", async () => {
    script = [() => [], () => []];
    const { agent } = await makeAgent();
    const r = await agent.generate({ prompt: "What did people say in conv1268?" });
    expect(offers).toHaveLength(2);
    expect(r.text).toBe("");
  });

  it("passes a streamed step with content through unchanged, and asks an empty one again", async () => {
    const parts = (ps: unknown[]) =>
      new ReadableStream({
        start: (c) => {
          ps.forEach((p) => c.enqueue(p));
          c.close();
        },
      });
    const finish = { type: "finish", usage, finishReason: { unified: "stop", raw: undefined } };
    const words = [
      { type: "stream-start", warnings: [] },
      { type: "text-start", id: "t" },
      { type: "text-delta", id: "t", delta: "Hi" },
      { type: "text-end", id: "t" },
      finish,
    ];
    const again = vi.fn(async () => ({ stream: parts(words) }));
    const read = async (s: ReadableStream) => {
      const out: unknown[] = [];
      for (const r = s.getReader(); ;) {
        const n = await r.read();
        if (n.done) return out;
        out.push(n.value);
      }
    };
    const params = { tools: [{ type: "function", name: "scan" }], toolChoice: { type: "auto" } };
    const wrap = retryEmpty.wrapStream!;
    const full = await wrap({
      doStream: async () => ({ stream: parts(words) }),
      params,
      model: { doStream: again, modelId: "m" },
    } as never);
    expect(await read(full.stream)).toEqual(words);
    expect(again).not.toHaveBeenCalled();

    const empty = await wrap({
      doStream: async () => ({ stream: parts([{ type: "stream-start", warnings: [] }, finish]) }),
      params,
      model: { doStream: again, modelId: "m" },
    } as never);
    expect(again).toHaveBeenCalledWith({ ...params, toolChoice: { type: "required" } });
    expect(await read(empty.stream)).toEqual(words);
  });
});

// Eval 2026-09-28 (P02): made to call a tool, the model wrote 1,085 aggregate calls in one turn, 540 of each of two.
describe("a step's tool calls", () => {
  it("are kept once each, only for tools offered, and at most MAX_CALLS", async () => {
    const agg = (metric: string) =>
      call(`a-${metric}-${Math.random()}`, "aggregate", { metric, group_by: "topic" });
    script = [
      () => [
        ...Array.from({ length: 5 }, () => agg("engagement")),
        ...Array.from({ length: 5 }, () => agg("conversations")),
        call("x1", "not_a_tool", {}),
      ],
      () => [call("s1", "scan", { question: "What excites people?", filters: { flag: "excited" } })],
    ];
    const { agent } = await makeAgent();
    const r = await agent.generate({ prompt: "What should we post about this week?" });
    expect(r.steps[0].toolCalls.map((c) => (c.input as { metric: string }).metric)).toEqual([
      "engagement",
      "conversations",
    ]);

    const many = Array.from({ length: 9 }, (_, i) =>
      call(`c${i}`, "aggregate", { metric: "conversations", n: i }),
    );
    const kept = await oneCallEach.wrapGenerate!({
      doGenerate: async () => ({ content: many }),
      params: { tools: [{ type: "function", name: "aggregate" }] },
    } as never);
    expect(kept.content).toHaveLength(MAX_CALLS);
  });

  it("streamed, drop a repeated call with its input parts, and pass the rest through", async () => {
    const parts = [
      { type: "tool-input-start", id: "t1", toolName: "scan" },
      { type: "tool-input-delta", id: "t1", delta: "{}" },
      { type: "tool-input-end", id: "t1" },
      { type: "tool-call", toolCallId: "t1", toolName: "scan", input: "{}" },
      { type: "tool-input-start", id: "t2", toolName: "scan" },
      { type: "tool-input-end", id: "t2" },
      { type: "tool-call", toolCallId: "t2", toolName: "scan", input: "{}" },
      { type: "finish", usage, finishReason: { unified: "tool-calls", raw: undefined } },
    ];
    const r = await oneCallEach.wrapStream!({
      doStream: async () => ({
        stream: new ReadableStream({
          start: (c) => {
            parts.forEach((p) => c.enqueue(p));
            c.close();
          },
        }),
      }),
      params: { tools: [{ type: "function", name: "scan" }] },
    } as never);
    const out: { type: string; id?: string; toolCallId?: string }[] = [];
    for (const reader = r.stream.getReader(); ;) {
      const n = await reader.read();
      if (n.done) break;
      out.push(n.value as never);
    }
    expect(out.map((p) => `${p.type}:${p.id ?? p.toolCallId ?? ""}`)).toEqual([
      "tool-input-start:t1",
      "tool-input-delta:t1",
      "tool-input-end:t1",
      "tool-call:t1",
      "finish:",
    ]);
  });
});

describe("a follow-up that asks for a slice (P3)", () => {
  it("must call a tool first, never answer from the last answer's words", async () => {
    script = [
      (o) =>
        o.choice === "required"
          ? [call("s1", "scan", { question: "Which are bugs?", filters: { flag: "bug" } })]
          : [{ type: "text", text: "None are bugs." }],
    ];
    const { agent } = await makeAgent();
    await agent.generate({ messages: [...earlier, { role: "user", content: "Which of those are bugs?" }] });
    expect(offers[0].choice).toBe("required");
    expect(offers[0].tools).not.toContain("out_of_scope");
    expect(offers[0].tools).toEqual(expect.arrayContaining(["scan", "find", "aggregate"]));
  });

  it("names a topic or a period as well as a kind", async () => {
    for (const q of ["What about the Domains?", "And last week?"]) {
      offers.length = 0;
      script = [() => [call("f1", "find", { query: q })]];
      const { agent } = await makeAgent();
      await agent.generate({ messages: [...earlier, { role: "user", content: q }] });
      expect(offers[0].choice).toBe("required");
    }
  });

  it("is free on a follow-up that asks for no slice, and on a first question", async () => {
    const { agent } = await makeAgent();
    await agent.generate({
      messages: [...earlier, { role: "user", content: "Thanks, can you say that more briefly?" }],
    });
    expect(offers[0].choice).toBe("auto");
    offers.length = 0;
    await (await makeAgent()).agent.generate({ prompt: "Which bugs did people report this week?" });
    expect(offers[0].choice).toBe("auto");
  });
});

// v1.1 QA (B1): "tell me more about the second one" after the Domains answer made no tool call, and restated an earlier
// turn's count and mood for a slice they did not describe.
describe("a follow-up that asks for more (B1)", () => {
  it("must read first, with a reading tool, on the first step only", async () => {
    script = [
      () => [call("r1", "read_conversation", { id: "conv1" })],
      () => [{ type: "text", text: "In that conversation, players said the boss takes no damage [msg1]." }],
    ];
    const { agent } = await makeAgent();
    await agent.generate({
      messages: [...earlier, { role: "user", content: "tell me more about the second one" }],
    });
    expect(offers[0].choice).toBe("required");
    expect([...offers[0].tools].sort()).toEqual(["find", "read_conversation", "scan"]);
    expect(offers[1].choice).toBe("auto");
  });

  it("is not forced on a first question, even one that asks why", async () => {
    await (await makeAgent()).agent.generate({ prompt: "Why?" });
    expect(offers[0].choice).toBe("auto");
  });
});

// Eval 2026-09-28 (A06): "How many conversations were about pricing last month?" was answered with no tool call and a
// count tagged [aggregate] that nothing had counted.
describe("a question for a number", () => {
  it("must call a tool first, and may still turn it away as out of scope", async () => {
    script = [() => [call("a1", "aggregate", { metric: "conversations", group_by: "none" })]];
    const { agent } = await makeAgent();
    await agent.generate({ prompt: "How many conversations were about pricing last month?" });
    expect(offers[0].choice).toBe("required");
    expect(offers[0].tools).toContain("out_of_scope");
    expect(offers[1].choice).toBe("auto");
  });
});

// The instructions ask for an engagement count first. It is not forced: made to call aggregate alone on the first step,
// Gemini 2.5 Flash wrote 1,232 calls in four minutes (eval 2026-09-28, P03). Once it has counted, the read is forced.
describe("what to post (P4)", () => {
  it("is free on the first step, and must read after it has only counted", async () => {
    script = [
      () => [
        call("a1", "aggregate", {
          metric: "engagement",
          group_by: "topic",
          filters: { since: "2026-09-20T19:30Z" },
        }),
      ],
      () => [
        call("s1", "scan", { question: "What are people excited about?", filters: { flag: "excited" } }),
      ],
    ];
    const { agent } = await makeAgent();
    await agent.generate({ prompt: "What should we post about this week?" });
    expect(offers[0].choice).toBe("auto");
    // Only counted so far, and the question asks what people care about: the next step reads (grounding.ts needsRead).
    expect(offers[1].choice).toBe("required");
    expect(offers[1].tools).toEqual(["scan", "find"]);
  });
});
