import { beforeEach, describe, expect, it, vi } from "vitest";

// Topics are multi-label (D46): a conversation touching two topics sits in both rows of the grid. What must hold is
// that the cells and each topic's total count by membership, while a period's total, the grand total and a selection
// count DISTINCT conversations, so nothing in the grid or a selection is the sum of rows that share conversations.
// No database in unit tests: the SQL is pinned as text, and the fake below answers the grid with rows as Postgres
// would return them, to check which total the page is handed.
const db = vi.hoisted(() => ({ gridRows: [] as object[] }));
vi.mock("./db", () => ({
  query: async (sql: string) => {
    if (/concat_ws/.test(sql)) return [{ v: "1/1/3" }];
    if (/min\(started_at\)/.test(sql)) return [{ lo: "2026-09-07", hi: "2026-09-13" }];
    if (/GROUPING SETS/.test(sql)) return db.gridRows;
    return [];
  },
}));
vi.mock("next/cache", () => import("@/test/next-cache-fake"));

import { resetNextCache } from "@/test/next-cache-fake";
import { getGrid, GRID_SQL, SELECTION_SQL } from "./insights";

beforeEach(() => resetNextCache());

describe("the grid query", () => {
  it("counts cells and topic totals by membership: one row per topic a conversation touches", () => {
    expect(GRID_SQL).toMatch(/mem AS \(SELECT cv\.\*, t\.topic FROM conv cv CROSS JOIN LATERAL unnest\(cv\.topics\) AS t\(topic\)\)/);
    expect(GRID_SQL).toMatch(/FROM mem GROUP BY GROUPING SETS \(\(topic, p\), \(topic\)\)/);
  });

  it("counts period totals and the grand total over distinct conversations, never over the topic rows", () => {
    expect(GRID_SQL).toMatch(/FROM conv GROUP BY GROUPING SETS \(\(p\), \(\)\)/);
    expect(GRID_SQL).toMatch(/FROM conv cv JOIN messages m ON m\.conversation_id = cv\.id\s+GROUP BY GROUPING SETS \(\(cv\.p\), \(\)\)/);
    expect(GRID_SQL).not.toMatch(/FROM mem[^)]*GROUPING SETS \([^)]*\(p\)/); // no period total from the membership rows
  });

  it("hands the page the distinct totals, which are smaller than the sum of cells when conversations overlap", async () => {
    // Three conversations in one week: c1 touches bugs and maps, c2 bugs, c3 maps.
    const agg = (n: number) => ({ n, engagement: 0, messages: n, mood_sum: 0, mood_n: 0, people: n });
    db.gridRows = [
      { topic: "bugs", p: "2026-09-07", g: 0, ...agg(2) },
      { topic: "maps", p: "2026-09-07", g: 0, ...agg(2) },
      { topic: "bugs", p: null, g: 1, ...agg(2) },
      { topic: "maps", p: null, g: 1, ...agg(2) },
      { topic: null, p: "2026-09-07", g: 2, ...agg(3) },
      { topic: null, p: null, g: 3, ...agg(3) },
    ];
    const grid = await getGrid("week");
    const cellSum = grid.cells.reduce((t, c) => t + c.n, 0);
    expect(cellSum).toBe(4); // c1 is in two cells
    expect(grid.periodTotals["2026-09-07"].n).toBe(3); // but the week holds three conversations
    expect(grid.norm.n).toBe(3);
    expect(grid.topics.map((t) => [t.key, t.total.n])).toEqual([["bugs", 2], ["maps", 2]]);
  });
});

describe("a selection", () => {
  it("takes every conversation touching a selected topic in that topic's dates, and each conversation once", () => {
    expect(SELECTION_SQL).toMatch(/JOIN sel ON sel\.topic = ANY\(c\.topics\)/);
    expect(SELECTION_SQL).toMatch(/SELECT DISTINCT c\.id,/); // two selected topics sharing a conversation count it once
    expect(SELECTION_SQL).toMatch(/'n', count\(\*\)[\s\S]*FROM conv\) AS totals/);
  });
});
