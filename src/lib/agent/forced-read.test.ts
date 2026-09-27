import { beforeEach, describe, expect, it, vi } from "vitest";
import { MockLanguageModelV4 } from "ai/test";

// Review 2026-09-26: the forced read (a turn that only counted must read before it answers what people say, agent.ts
// prepareStep) was re-applied after every read that failed twice, found nothing, was too broad or was refused, and the
// model looped on reads to the step budget. The real agent runs here over a mocked model and a stubbed data layer; the
// model's calls record whether each step was made to call a reading tool.

const scanMock = vi.fn();
vi.mock("@/lib/data/profile", () => ({
  profile: async () => ({
    community: "r/PUBATTLEGROUNDS",
    platform: "Reddit",
    about: "",
    from: "2026-06-18",
    to: "2026-09-24",
    events: null,
  }),
}));
vi.mock("@/lib/data/db", () => ({ query: async () => [] }));
vi.mock("@/lib/data/scan", () => ({ scan: (...a: unknown[]) => scanMock(...a), MAX_SCAN: 2500 }));
vi.mock("@/lib/data/search", () => ({ searchConversations: vi.fn() }));
vi.mock("@/lib/data/voices", () => ({ topVoices: vi.fn() }));
vi.mock("@/lib/data/aggregate", () => ({
  aggregate: vi.fn(async () => ({
    metric: "conversations",
    groupBy: "none",
    filters: {},
    rows: [{ key: "all", value: 202, n: 202 }],
  })),
  METRICS: { conversations: {} },
  GROUPINGS: { none: {} },
}));
vi.mock("@/lib/data/read", () => ({
  conversationIdOf: vi.fn(),
  getConversation: vi.fn(),
  getOverview: vi.fn(),
  topicLabels: async () => [],
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
// The model counts, then reads whenever it is made to, then answers when it is not.
const choices: unknown[] = [];
let n = 0;
const model = new MockLanguageModelV4({
  doGenerate: async (options) => {
    choices.push(options.toolChoice?.type);
    const i = n++;
    const content =
      i === 0
        ? [call("a1", "aggregate", { metric: "conversations", group_by: "none" })]
        : options.toolChoice?.type === "required"
          ? [call(`s${i}`, "scan", { question: "What do people complain about?" })]
          : [{ type: "text" as const, text: "One read didn't finish, so this covers only the counts." }];
    const calls = content.some((c) => c.type === "tool-call");
    return {
      content,
      finishReason: { unified: calls ? "tool-calls" : "stop", raw: undefined },
      usage,
      warnings: [],
    };
  },
});
vi.mock("./model", () => ({ chatModel: () => model, answerModel: () => model }));

const { makeAgent } = await import("./agent");

beforeEach(() => {
  choices.length = 0;
  n = 0;
  scanMock.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("the forced read", () => {
  it("is forced once a turn: after a read that failed twice the next step answers", async () => {
    scanMock.mockRejectedValue(new Error("socket hang up"));
    const { agent } = await makeAgent();
    const r = await agent.generate({ prompt: "What are people complaining about most in September?" });
    expect(choices).toEqual(["auto", "required", "auto"]);
    expect(scanMock).toHaveBeenCalledTimes(2); // the forced read, and its one retry
    expect(r.text).toMatch(/^One read didn't finish/);
  });

  it("is forced once a turn: after a read that found a slice too broad the next step answers", async () => {
    scanMock.mockResolvedValue({ status: "too-broad", total: 9000, byTopic: [], byWeek: [] });
    const { agent } = await makeAgent();
    await agent.generate({ prompt: "What are people complaining about most in September?" });
    expect(choices).toEqual(["auto", "required", "auto"]);
  });
});
