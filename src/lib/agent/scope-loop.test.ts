import { beforeEach, describe, expect, it, vi } from "vitest";
import { MockLanguageModelV4 } from "ai/test";

// Eval run 7, L09: "How do you aim the mortar?" was declined outright. The out_of_scope call is now checked (scope.ts),
// and a call turned down must not end the turn: the loop goes on without out_of_scope, and the model answers. Through
// the real agent (agent.ts makeAgent) over a mocked model and a stubbed data layer.

const decideMock = vi.fn();
vi.mock("@/lib/llm/decide", () => ({
  decide: (a: unknown) => decideMock(a),
  noul: (instructions: string) => ({ type: "noul", instructions }),
}));
vi.mock("@/lib/data/profile", () => ({
  profile: async () => ({
    community: "r/PUBATTLEGROUNDS",
    platform: "Reddit",
    about: "PUBG",
    from: "2026-06-18",
    to: "2026-09-24",
    events: null,
  }),
}));
vi.mock("@/lib/data/scan", () => ({ MAX_SCAN: 2500, scan: vi.fn() }));
vi.mock("@/lib/data/search", () => ({
  searchConversations: vi.fn(async () => ({ hits: [], candidates: 0 })),
}));
vi.mock("@/lib/data/voices", () => ({ topVoices: vi.fn() }));
vi.mock("@/lib/data/aggregate", () => ({
  aggregate: vi.fn(),
  METRICS: { conversations: {} },
  GROUPINGS: { none: {} },
}));
vi.mock("@/lib/data/read", () => ({
  conversationIdOf: vi.fn(),
  getConversation: vi.fn(),
  getOverview: vi.fn(async () => ({ topics: [] })),
  topicLabels: async () => [],
}));

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 1, text: 1, reasoning: undefined },
};
const seen: string[][] = []; // the tools offered to the model at each step
let script: Array<"out_of_scope" | "find" | "text"> = [];
const model = new MockLanguageModelV4({
  doGenerate: async (opts: { tools?: Array<{ name: string }> }) => {
    seen.push((opts.tools ?? []).map((t) => t.name));
    const next = script.shift() ?? "text";
    return next === "text"
      ? {
          content: [{ type: "text", text: "Count the grid squares to the target." }],
          finishReason: { unified: "stop", raw: undefined },
          usage,
          warnings: [],
        }
      : {
          content: [
            {
              type: "tool-call",
              toolCallId: `c${seen.length}`,
              toolName: next,
              input: next === "find" ? '{"query":"mortar"}' : "{}",
            },
          ],
          finishReason: { unified: "tool-calls", raw: undefined },
          usage,
          warnings: [],
        };
  },
});
vi.mock("./model", () => ({ chatModel: () => model, answerModel: () => model }));

const { makeAgent } = await import("./agent");

beforeEach(() => {
  seen.length = 0;
  decideMock.mockReset();
});

describe("an out_of_scope call in the agent loop", () => {
  it("turned down by the scope check, does not end the turn, is not offered again, and the model answers", async () => {
    decideMock.mockResolvedValue({ answers: { bears: { type: "noul", noul: 0.94 } } });
    script = ["out_of_scope", "find", "text"];
    const { agent } = await makeAgent();
    const r = await agent.generate({ prompt: "How do you aim the mortar?" });
    expect(r.steps).toHaveLength(3);
    expect(r.steps[0].toolResults[0].output).toEqual({ status: "in-scope", bears: 0.94 });
    expect(seen[0]).toContain("out_of_scope");
    expect(seen[1]).not.toContain("out_of_scope");
    expect(seen[1]).toContain("find");
    expect(r.text).toBe("Count the grid squares to the target.");
  });

  it("accepted, ends the turn at the call, as before", async () => {
    decideMock.mockResolvedValue({ answers: { bears: { type: "noul", noul: 0.04 } } });
    script = ["out_of_scope", "text"];
    const { agent } = await makeAgent();
    const r = await agent.generate({ prompt: "What's the weather in Seoul?" });
    expect(r.steps).toHaveLength(1);
    expect(r.steps[0].toolResults[0].output).toMatchObject({ status: "off-topic" });
  });
});
