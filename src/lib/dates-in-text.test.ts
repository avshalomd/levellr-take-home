import { describe, expect, it } from "vitest";
import { withoutDates, withoutTimeWords } from "./dates-in-text";

// Review 2026-09-26: a date's or a release's digits were taken for a count. What these take out, and what they leave.
const digits = (s: string) => withoutDates(s).match(/\d+/g) ?? [];

describe("withoutDates", () => {
  it("takes out dates and release numbers", () => {
    for (const s of ["after the 9 September patch", "on Sept 9th, 2026", "on 2026-09-09", "in September 2026", "after patch 42.3", "the 42.3 update", "after 42.3", "v1.2.3"])
      expect(digits(s), s).toEqual([]);
  });
  it("leaves counts and rates", () => {
    expect(digits("11.3 per day over 24 days")).toEqual(["11", "3", "24"]);
    expect(digits("212 of 840 conversations")).toEqual(["212", "840"]);
    expect(digits("9 players may be right")).toEqual(["9"]);
  });
});

describe("withoutTimeWords", () => {
  it("also takes out month and weekday names and words that place a message in time", () => {
    expect(withoutTimeWords("Sept — earlier, on Monday").replace(/[\s,—]+/g, "")).toBe("on");
    expect(withoutTimeWords("love the map").trim()).toBe("love the map");
  });
});
