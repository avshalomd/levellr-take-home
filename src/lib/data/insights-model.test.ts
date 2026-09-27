import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  SQUARE_TOKENS,
  inkOn,
  inkPair,
  EMPTY_AGG,
  addAgg,
  axisLabels,
  MOOD_DEFINITION,
  activityIntensity,
  buildPeriods,
  dayRange,
  divergingColor,
  divergingSpread,
  divergingT,
  formatShort,
  formatValue,
  humanizeKey,
  isCatchAll,
  metricValue,
  moodBaseline,
  moodOf,
  monthSpans,
  moodVersus,
  periodLabel,
  periodStart,
  reliability,
  volumeColor,
  type Agg,
} from "./insights-model";

const W = { from: "2026-06-18", to: "2026-09-24" };
const agg = (x: Partial<Agg>): Agg => ({ ...EMPTY_AGG, ...x });

describe("periods", () => {
  it("weeks start on Monday and months on the 1st", () => {
    expect(periodStart("2026-09-24", "week")).toBe("2026-09-21"); // a Thursday
    expect(periodStart("2026-09-21", "week")).toBe("2026-09-21"); // a Monday stays
    expect(periodStart("2026-09-20", "week")).toBe("2026-09-14"); // a Sunday belongs to the week before
    expect(periodStart("2026-09-24", "month")).toBe("2026-09-01");
    expect(periodStart("2026-09-24", "day")).toBe("2026-09-24");
  });

  it("cover the data window, marking only the edges partial", () => {
    const weeks = buildPeriods("week", W.from, W.to);
    expect(weeks).toHaveLength(15);
    expect(weeks[0]).toEqual({ key: "2026-06-15", start: "2026-06-15", end: "2026-06-22", partial: true });
    expect(weeks.at(-1)).toMatchObject({ key: "2026-09-21", end: "2026-09-28", partial: true });
    expect(weeks.slice(1, -1).every((p) => !p.partial)).toBe(true);

    const days = buildPeriods("day", W.from, W.to);
    expect(days).toHaveLength(99);
    expect(days.some((p) => p.partial)).toBe(false);

    const months = buildPeriods("month", W.from, W.to);
    expect(months.map((m) => m.key)).toEqual(["2026-06-01", "2026-07-01", "2026-08-01", "2026-09-01"]);
    expect(months.map((m) => m.partial)).toEqual([true, false, false, true]);
    expect(months[1].end).toBe("2026-08-01");
  });

  it("a week that starts exactly on the first day and ends on the last is whole", () => {
    expect(buildPeriods("week", "2026-09-07", "2026-09-13")).toEqual([
      { key: "2026-09-07", start: "2026-09-07", end: "2026-09-14", partial: false },
    ]);
  });
});

describe("date labels", () => {
  it("write ranges the way people do", () => {
    expect(dayRange("2026-09-07", "2026-09-20")).toBe("7–20 Sep");
    expect(dayRange("2026-08-25", "2026-09-07")).toBe("25 Aug – 7 Sep");
    expect(dayRange("2026-09-07", "2026-09-07")).toBe("7 Sep");
    expect(dayRange("2026-07-01", "2026-07-02", false)).toBe("1–2 July");
  });

  it("clip a partial period to the days that hold data", () => {
    const [first] = buildPeriods("week", W.from, W.to);
    expect(periodLabel(first, "week", W)).toBe("18–21 Jun");
    const last = buildPeriods("week", W.from, W.to).at(-1)!;
    expect(periodLabel(last, "week", W)).toBe("21–24 Sep");
    expect(periodLabel(buildPeriods("month", W.from, W.to)[2], "month", W)).toBe("August");
    expect(periodLabel(buildPeriods("day", W.from, W.to)[0], "day", W)).toBe("18 Jun");
  });

  it("label the day axis sparsely: month names where a month begins, day numbers on Mondays only", () => {
    const days = buildPeriods("day", W.from, W.to);
    const labels = axisLabels(days, "day");
    expect(labels[0]).toEqual({ month: "June", day: null }); // 18 June is a Thursday
    expect(labels[4]).toEqual({ month: null, day: "22" }); // Monday 22 June
    expect(labels.filter((l) => l.day).length).toBe(14);
    expect(labels.filter((l) => l.month).map((l) => l.month)).toEqual(["June", "July", "August", "September"]);
  });

  it("label every week, and name the month once", () => {
    const labels = axisLabels(buildPeriods("week", W.from, W.to), "week");
    expect(labels.slice(0, 4)).toEqual([
      { month: "June", day: "15" },
      { month: null, day: "22" },
      { month: null, day: "29" },
      { month: "July", day: "6" },
    ]);
  });

  it("span each month over every column it holds, so its name can stay pinned while it is in view (QA 2026-09-26)", () => {
    const days = buildPeriods("day", W.from, W.to); // 18 Jun .. 24 Sep: 13 + 31 + 31 + 24 days
    expect(monthSpans(days, "day")).toEqual([
      { name: "June", from: 0, to: 12 },
      { name: "July", from: 13, to: 43 },
      { name: "August", from: 44, to: 74 },
      { name: "September", from: 75, to: 98 },
    ]);
    const weeks = monthSpans(buildPeriods("week", W.from, W.to), "week");
    expect(weeks[0]).toEqual({ name: "June", from: 0, to: 2 }); // the weeks of 15, 22 and 29 June
    expect(weeks.at(-1)!.to).toBe(buildPeriods("week", W.from, W.to).length - 1); // the last month runs to the edge
    expect(monthSpans(buildPeriods("month", W.from, W.to), "month").map((m) => m.from - m.to)).toEqual([0, 0, 0, 0]);
  });
});

describe("what the grid shows", () => {
  const a = agg({ n: 200, engagement: 5010, messages: 200, moodSum: 76, moodN: 200, people: 380 });
  const population = agg({ n: 10628, moodSum: 4820, moodN: 10628 });

  it("activity is the conversation count, mood a 0-100 average", () => {
    expect(metricValue("activity", a)).toBe(200);
    expect(metricValue("mood", a)).toBeCloseTo(38);
    expect(moodOf(EMPTY_AGG)).toBeNaN();
  });

  it("combines cells exactly by adding their sums", () => {
    const both = addAgg(a, agg({ n: 100, engagement: 10, messages: 300, moodSum: 60, moodN: 100 }));
    expect(both.n).toBe(300);
    expect(both.engagement).toBe(5020);
    expect(both.messages).toBe(500);
    expect(moodOf(both)).toBeCloseTo((136 / 300) * 100);
  });

  it("formats in plain words", () => {
    expect(formatValue("activity", a)).toBe("200 conversations");
    expect(formatValue("activity", agg({ n: 1 }))).toBe("1 conversation");
    expect(formatValue("activity", EMPTY_AGG)).toBe("No conversations");
    expect(formatValue("mood", a)).toBe("Mood 38 out of 100");
    expect(formatValue("mood", EMPTY_AGG)).toBe("No mood reading");
    expect(formatShort("activity", agg({ n: 43320 }))).toBe("43k");
    expect(formatShort("mood", a)).toBe("38");
  });

  it("compares a mood with the whole population, naming its average", () => {
    // The population averages 45 (4820 / 10628).
    expect(moodVersus(a, population)).toBe("7 below the average of 45");
    expect(moodVersus(agg({ moodSum: 60, moodN: 100 }), population)).toBe("15 above the average of 45");
    expect(moodVersus(agg({ moodSum: 45.2, moodN: 100 }), population)).toBe("about the average of 45");
    expect(moodVersus(EMPTY_AGG, population)).toBe("");
  });

  it("the legend says what mood is measured against, as a population", () => {
    expect(moodBaseline(population)).toBe("Compared with the average mood of all 10,628 conversations, which is 45.");
    expect(moodBaseline(EMPTY_AGG)).toBe("");
  });

  it("the mood definition says what it measures and claims no domain", () => {
    expect(MOOD_DEFINITION).toMatch(/how positive people sound/);
    expect(MOOD_DEFINITION).toMatch(/from 0 \(very negative\) to 100 \(very positive\)/);
    expect(MOOD_DEFINITION).not.toMatch(/language model/); // QA 2026-09-26: plain words for a non-technical reader
    expect(MOOD_DEFINITION).not.toMatch(/product|game|player|bug|complain/i);
  });
});

describe("colour scales", () => {
  it("activity: one scale for the whole grid, square-rooted so small topics still show", () => {
    expect(activityIntensity(164, 164)).toBe(1);
    expect(activityIntensity(41, 164)).toBe(0.5);
    expect(activityIntensity(0, 164)).toBe(0);
    expect(activityIntensity(10, 0)).toBe(0);
  });

  it("mood diverges around the population's average: gloomier is negative, happier positive", () => {
    expect(divergingT(35, 45, 5)).toBe(-1);
    expect(divergingT(50, 45, 10)).toBeCloseTo(0.5);
    expect(divergingT(NaN, 45, 10)).toBe(0);
  });

  it("the spread ignores the freak square and is never zero", () => {
    const values = [40, 42, 44, 46, 48, 50, 45, 43, 47, 90];
    expect(divergingSpread(values, 45)).toBeCloseTo(45); // p90 of 10 values is the 10th: the outlier itself
    expect(divergingSpread([40, 42, 44, 46, 48, 50, 45, 43, 47, 41, 49, 90], 45)).toBeCloseTo(5);
    expect(divergingSpread([45, 45], 45)).toBe(1);
    expect(divergingSpread([], 45)).toBe(1);
  });

  it("fades squares that rest on few conversations", () => {
    expect(reliability(10)).toBe(1);
    expect(reliability(7)).toBe(0.55);
    expect(reliability(2)).toBe(0.3);
  });

  it("maps intensities to token colours", () => {
    expect(volumeColor(0)).toBe("var(--cell)");
    expect(volumeColor(1)).toBe("color-mix(in oklch, var(--pulse) 95%, var(--cell))");
    expect(divergingColor(0)).toBe("var(--cell-mid)");
    expect(divergingColor(-1)).toContain("var(--neg) 92%");
    expect(divergingColor(0.5)).toContain("var(--pos) 52%");
  });
});

describe("topic keys", () => {
  it("humanises a key and sorts catch-alls last", () => {
    expect(humanizeKey("servers-matchmaking")).toBe("Servers matchmaking");
    expect(isCatchAll("other")).toBe(true);
    expect(isCatchAll("Unlabelled")).toBe(true);
    expect(isCatchAll("otherworldly")).toBe(false);
  });
});

// QA 2026-09-26: the numbers in Months squares read 2.5-4.5:1 in the light theme and 3.0-4.7:1 in the dark.
describe("the number on a square", () => {
  const ramp = Array.from({ length: 101 }, (_, i) => i / 100);

  it("reads at 4.5:1 or better on every activity shade, in both themes", () => {
    for (const theme of ["light", "dark"] as const)
      for (const value of ramp) expect(inkOn(theme, { metric: "activity", value, alpha: 1 }).ratio, `${theme} ${value}`).toBeGreaterThanOrEqual(4.5);
  });

  it("reads at 4.5:1 or better on every mood shade, faded or not, in both themes", () => {
    for (const theme of ["light", "dark"] as const)
      for (const alpha of [1, reliability(5), reliability(1)])
        for (const v of ramp)
          for (const value of [v, -v]) expect(inkOn(theme, { metric: "mood", value, alpha }).ratio, `${theme} ${value} ${alpha}`).toBeGreaterThanOrEqual(4.5);
  });

  // QA 2026-09-26: while a selection is active the other squares fade to 42%; their numbers read 2.0-3.3:1 when the
  // whole square faded. The fill alone fades now (Grid.tsx DIM) and the ink is picked for the faded colour.
  it("reads at 4.5:1 or better on a square faded for a selection, in both themes and both metrics", () => {
    for (const theme of ["light", "dark"] as const)
      for (const v of ramp) {
        expect(inkOn(theme, { metric: "activity", value: v, alpha: 0.42 }).ratio, `${theme} activity ${v}`).toBeGreaterThanOrEqual(4.5);
        for (const alpha of [1, reliability(5), reliability(1)])
          for (const value of [v, -v]) expect(inkOn(theme, { metric: "mood", value, alpha: alpha * 0.42 }).ratio, `${theme} mood ${value} ${alpha}`).toBeGreaterThanOrEqual(4.5);
      }
  });

  it("uses the page's own inks where they read, and black only where neither does", () => {
    expect(inkPair({ metric: "activity", value: 0.1, alpha: 1 })).toEqual({ light: "oklch(0.2 0.012 260)", dark: "white" });
    expect(inkPair({ metric: "activity", value: 1, alpha: 1 }).dark).toBe("oklch(0.2 0.012 260)");
  });

  it("models the colours the page actually uses", () => {
    const css = readFileSync(join(__dirname, "..", "..", "app", "globals.css"), "utf8");
    const explore = readFileSync(join(__dirname, "..", "..", "components", "insights", "Explore.tsx"), "utf8");
    // every top-level block for a selector, joined (globals.css has more than one :root block)
    const block = (sel: string) => [...css.matchAll(/^(\S[^{\n]*?) \{([^}]*)\}/gm)].filter((m) => m[1] === sel).map((m) => m[2]).join("\n");
    const ok = (t: readonly number[]) => `oklch(${t.join(" ")})`;
    for (const [theme, sel] of [["light", ":root"], ["dark", ".dark"]] as const) {
      const t = SQUARE_TOKENS[theme];
      for (const [name, v] of [["pulse", t.pulse], ["neg", t.neg], ["pos", t.pos], ["background", t.page]] as const)
        expect(block(sel), `${theme} --${name}`).toMatch(new RegExp(`--${name}: ${ok(v).replace(/[()]/g, "\\$&")};`));
      const prefix = theme === "dark" ? "dark:" : "";
      expect(explore).toContain(`${prefix}[--cell:${ok(t.cell).replace(/ /g, "_")}]`);
      expect(explore).toContain(`${prefix}[--cell-mid:${ok(t.cellMid).replace(/ /g, "_")}]`);
    }
  });
});
