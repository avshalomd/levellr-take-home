import { describe, expect, it, vi } from "vitest";

// A bad resolution is a 400 before any query; a database failure is a plain 500 that names nothing inside.
const grid = vi.hoisted(() => ({ impl: async (res: string) => ({ resolution: res }) as unknown }));
vi.mock("@/lib/data/insights", () => ({ getGrid: (res: string) => grid.impl(res) }));

import { GET } from "./route";

const get = (q = "") => GET(new Request(`http://x/api/insights${q}`));

describe("GET /api/insights", () => {
  it("defaults to weeks", async () => {
    expect(await (await get()).json()).toEqual({ resolution: "week" });
  });

  it("refuses an unknown resolution", async () => {
    expect((await get("?res=year")).status).toBe(400);
  });

  it("turns a database failure into a plain 500", async () => {
    grid.impl = async () => {
      throw new Error("connection terminated at neon pool");
    };
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await get("?res=day");
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toMatch(/neon|connection/);
  });
});
