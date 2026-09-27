import { beforeEach, describe, expect, it, vi } from "vitest";

// The read with Jev and the database stubbed: which conversations count, and in what order they come back.
// Production QA 2026-09-27: a frustrations read counted GTA 6's price talk (P2, P6), and post ideas rested on the most
// relevant conversations, not the ones that drew people in (P4).

const row = (id: string, engagement: number, transcript: string) => ({
  id,
  ref: Number(id.slice(1)),
  channel: "game-chat",
  started_at: "2026-09-25T10:00:00.000Z",
  engagement,
  transcript,
  context_ids: [],
  topics: ["other-games-off-topic"],
});
const ROWS = [
  row("c1", 5, "the Domains bosses are bullet sponges"),
  row("c2", 40, "GTA 6 costs 80 dollars, games are too expensive"),
  row("c3", 30, "Ebontide was amazing"),
  row("c4", 2, "nothing to see"),
];
vi.mock("./db", () => ({
  query: async (sql: string) => (sql.includes("count(*)") ? [{ n: ROWS.length }] : ROWS),
}));
vi.mock("./search", () => ({ messagesFor: async () => [] }));
// Relevance by conversation, and whether it is about the community's own games.
const RELEVANCE: Record<string, number> = { c1: 0.9, c2: 0.95, c3: 0.7, c4: 0.1 };
const OURS: Record<string, number> = { c1: 0.9, c2: 0.05, c3: 0.9, c4: 0.9 };
const decideMock = vi.fn();
vi.mock("@/lib/llm/decide", async (orig) => ({
  ...(await orig<typeof import("@/lib/llm/decide")>()),
  decide: (a: unknown) => decideMock(a),
}));

const { scan } = await import("./scan");

beforeEach(() => {
  decideMock.mockReset().mockImplementation(async ({ state, questions }) => {
    const id = ROWS.find((r) => r.transcript === state.conversation)!.id;
    return {
      answers: {
        q: { noul: RELEVANCE[id] },
        ...("own" in questions ? { own: { noul: OURS[id] } } : {}),
      },
    };
  });
});

describe("scan", () => {
  it("keeps a read about the community's own games to them, and counts what it left out", async () => {
    const r = await scan("What frustrates players?", {}, { own: "the Veil of Ages games" });
    if (r.status !== "ok") throw new Error(r.status);
    expect(decideMock.mock.calls[0][0].state.games).toBe("the Veil of Ages games");
    expect(r.relevant).toBe(2);
    expect(r.hits.map((h) => h.id)).toEqual(["c1", "c3"]);
    expect(r.relevantIds).not.toContain("c2");
    expect(r.own).toEqual({ games: "the Veil of Ages games", elsewhere: 1 });
  });

  it("asks nothing more on any other read, and keeps every conversation that bears on it", async () => {
    const r = await scan("What do people say about prices?", {});
    if (r.status !== "ok") throw new Error(r.status);
    expect(Object.keys(decideMock.mock.calls[0][0].questions)).toEqual(["q"]);
    expect(r.relevant).toBe(3);
    expect(r.own).toBeUndefined();
    expect(r.hits.map((h) => h.id)).toEqual(["c2", "c1", "c3"]); // most relevant first
  });

  it("puts the most engaged of the relevant conversations first when ranked by engagement", async () => {
    const r = await scan("What are people excited about?", {}, { rank: "engagement" });
    if (r.status !== "ok") throw new Error(r.status);
    expect(r.hits.map((h) => h.id)).toEqual(["c2", "c3", "c1"]);
  });
});
