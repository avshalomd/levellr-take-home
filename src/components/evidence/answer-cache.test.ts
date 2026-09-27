import { describe, expect, it, vi } from "vitest";
import { answerCache } from "./answer-cache";

describe("answerCache", () => {
  it("asks once per id while the answer stands", async () => {
    const load = vi.fn(async (id: string) => `t:${id}`);
    const get = answerCache(load);
    expect(await get("a")).toBe("t:a");
    expect(await get("a")).toBe("t:a");
    expect(await get("b")).toBe("t:b");
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("remembers a 'not found' answer", async () => {
    const load = vi.fn(async () => null);
    const get = answerCache(load);
    expect(await get("gone")).toBeNull();
    expect(await get("gone")).toBeNull();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("forgets a failure, so the next ask tries again", async () => {
    let fail = true;
    const load = vi.fn(async (id: string) => {
      if (fail) throw new Error("503");
      return `t:${id}`;
    });
    const get = answerCache(load);
    await expect(get("a")).rejects.toThrow("503");
    await Promise.resolve(); // let the cache's own catch run
    fail = false;
    expect(await get("a")).toBe("t:a");
    expect(load).toHaveBeenCalledTimes(2);
  });
});
