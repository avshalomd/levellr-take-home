import { describe, expect, it } from "vitest";
import { sameSlice, within } from "./slices";

// Review 2026-09-26: moved out of the chat's UI module so the claim check (corroborate.ts) no longer imports one.
describe("within and sameSlice", () => {
  it("holds a narrower slice inside a wider one, never the other way", () => {
    expect(within({ topic: "maps", since: "2026-07-01", until: "2026-08-01" }, { topic: "maps" })).toBe(true);
    expect(within({ topic: "maps" }, { topic: "maps", since: "2026-07-01" })).toBe(false);
    expect(within({ flag: "bug" }, { flag: "complaint" })).toBe(false);
  });
  it("reads a date and the same instant written in full as one slice", () => {
    expect(sameSlice({ since: "2026-07-01" }, { since: "2026-07-01T00:00:00Z" })).toBe(true);
    expect(sameSlice({ since: "2026-07-01" }, { since: "2026-07-02" })).toBe(false);
  });
});
