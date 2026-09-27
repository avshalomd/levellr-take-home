import { beforeEach, describe, expect, it, vi } from "vitest";

// The route's own contract: impossible dates are a 400 before any query runs, and a database failure is a plain 500
// that says nothing about the database. No database here: the data module is replaced.
const selection = vi.hoisted(() => ({ impl: async () => ({ totals: {}, threads: [] }) as unknown }));
vi.mock("@/lib/data/insights", () => ({ getSelection: vi.fn((...a: unknown[]) => (selection.impl as (...x: unknown[]) => unknown)(...a)) }));

import { getSelection } from "@/lib/data/insights";
import { POST } from "./route";

const post = (body: unknown) =>
  POST(new Request("http://x/api/insights/selection", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }));
const range = (from: string, to: string) => ({ ranges: [{ topic: "maps", from, to }] });

describe("POST /api/insights/selection", () => {
  beforeEach(() => {
    vi.mocked(getSelection).mockClear();
    selection.impl = async () => ({ totals: { n: 1 }, threads: [] });
  });

  it("answers a valid range", async () => {
    const res = await post(range("2026-09-07", "2026-09-14"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ totals: { n: 1 }, threads: [] });
  });

  it.each([
    ["a day that does not exist", range("2026-02-30", "2026-03-05")],
    ["a month that does not exist", range("2026-13-01", "2026-13-05")],
    ["a reversed range", range("2026-09-14", "2026-09-07")],
    ["no ranges", { ranges: [] }],
    ["malformed JSON", "{nope"],
  ])("refuses %s with a 400 and never queries", async (_, body) => {
    const res = await post(body);
    expect(res.status).toBe(400);
    expect(getSelection).not.toHaveBeenCalled();
  });

  it("turns a database failure into a plain 500 with no detail", async () => {
    selection.impl = async () => {
      throw new Error('invalid input syntax for type date: "x" at pg/lib/client.js');
    };
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await post(range("2026-09-07", "2026-09-14"));
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toMatch(/pg|syntax/);
  });
});
