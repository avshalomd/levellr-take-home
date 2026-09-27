import { describe, expect, it } from "vitest";
import { buildPeriods, dayRange } from "@/lib/data/insights-model";
import { columnTitle, edgeNote, legendEnds, modifierKey, moodGap, periodWords, rowTitle, unbrokenDates } from "./explore-words";

const W = { from: "2026-06-18", to: "2026-09-24" }; // a Thursday to a Thursday

describe("periodWords", () => {
  const weeks = buildPeriods("week", W.from, W.to);
  const months = buildPeriods("month", W.from, W.to);

  it("a whole week reads as its days, with nothing added", () => {
    expect(periodWords(weeks[1], "week", W)).toBe(dayRange("2026-06-22", "2026-06-28"));
  });
  it("the first week names the days held and says the data begins there", () => {
    expect(periodWords(weeks[0], "week", W)).toBe(`${dayRange("2026-06-18", "2026-06-21")}, where the data begins`);
  });
  it("the last month names the days held and says the data ends there, not 'partly covered'", () => {
    const words = periodWords(months[months.length - 1], "month", W);
    expect(words).toBe(`${dayRange("2026-09-01", "2026-09-24")}, where the data ends`);
    expect(words).not.toMatch(/partly|covered/);
  });
  it("a whole month is just its name", () => {
    expect(periodWords(months[1], "month", W)).toBe("July");
  });
  it("one period holding all the data says so", () => {
    const w = { from: "2026-09-02", to: "2026-09-20" };
    expect(periodWords(buildPeriods("month", w.from, w.to)[0], "month", w)).toBe(`${dayRange(w.from, w.to)}, all the data there is`);
  });
  it("a period that ends exactly on the last day is not called an end", () => {
    const w = { from: "2026-06-18", to: "2026-06-30" };
    expect(periodWords(buildPeriods("month", w.from, w.to)[0], "month", w)).toBe(`${dayRange(w.from, w.to)}, where the data begins`);
  });
});

describe("edgeNote", () => {
  it("says what a dashed date means in the unit on screen", () => {
    expect(edgeNote("week")).toBe("A dashed date is a week at the start or end of the data, so it holds only some of its days.");
    expect(edgeNote("month")).toContain("a month at the start or end");
  });
});

describe("modifierKey", () => {
  const WIN_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";
  const MAC_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";

  it("says ⌘ on Apple platforms", () => {
    expect(modifierKey({ platform: "MacIntel" })).toBe("⌘");
    expect(modifierKey({ platform: "iPad" })).toBe("⌘");
    expect(modifierKey({ userAgentData: { platform: "macOS" }, platform: "" })).toBe("⌘");
    expect(modifierKey({ platform: "", userAgent: MAC_UA })).toBe("⌘");
  });
  it("says Ctrl off Apple platforms, not ⌘ everywhere (QA 2026-09-26)", () => {
    expect(modifierKey({ platform: "Win32", userAgent: WIN_UA })).toBe("Ctrl");
    expect(modifierKey({ platform: "Linux x86_64" })).toBe("Ctrl");
    expect(modifierKey({ userAgentData: { platform: "Windows" }, platform: "MacIntel" })).toBe("Ctrl");
    expect(modifierKey({ userAgentData: { platform: "Chrome OS" } })).toBe("Ctrl");
  });
  it("says Ctrl with nothing to go on, as the server does", () => {
    expect(modifierKey(undefined)).toBe("Ctrl");
    expect(modifierKey({})).toBe("Ctrl");
  });
});

describe("legendEnds", () => {
  it("activity reads from 0 to the largest count, both ends numbers (QA 2026-09-26: the low end said 'None')", () => {
    expect(legendEnds("activity", 1640, "week")).toEqual(["0", "1,640 in a week"]);
  });
  it("mood reads from gloomier to happier", () => {
    expect(legendEnds("mood", 1640, "week")).toEqual(["Gloomier", "Happier"]);
  });
});

describe("moodGap", () => {
  it("names the unit of the gap (QA 2026-09-26: '25 above average')", () => {
    expect(moodGap(25)).toBe("25 points above average");
    expect(moodGap(-7)).toBe("7 points below average");
    expect(moodGap(1)).toBe("1 point above average");
    expect(moodGap(0)).toBe("about average");
  });
});

describe("rowTitle and columnTitle", () => {
  it("say what happens, not 'Click to', since a phone taps them (QA 2026-09-26)", () => {
    expect(rowTitle("Performance & Access", 1234)).toBe("Performance & Access: 1,234 conversations touch it. Select the whole row.");
    expect(rowTitle("Maps", 1)).toBe("Maps: 1 conversation touches it. Select the whole row.");
    // D46: the share is of conversations touching the topic, out of all of them.
    expect(rowTitle("Maps", 250, 1000)).toBe("Maps: 250 conversations touch it, 25% of all 1,000. Select the whole row.");
    expect(columnTitle("7–13 Sept")).toBe("7–13 Sept. Select the whole column.");
  });
});

// QA 2026-09-26: at 768px the header's "18 Jun – 24 Sep" broke between "24" and "Sep".
describe("unbrokenDates", () => {
  it("keeps each date's day with its month, and lets the line break only at the dash", () => {
    expect(unbrokenDates(dayRange("2026-06-18", "2026-09-24"))).toBe("18 Jun – 24 Sep");
    expect(unbrokenDates(dayRange("2026-09-07", "2026-09-20"))).toBe("7–20 Sep");
    expect(unbrokenDates(dayRange("2026-07-01", "2026-07-02", false))).toBe("1–2 July");
  });
});
