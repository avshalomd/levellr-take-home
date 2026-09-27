import { describe, expect, it } from "vitest";
import type { ModelMessage } from "ai";
import { figuresIn, knownRates, rateMismatches, toolFigures } from "./rates";

// QA 2026-09-26: "And in July?" said "9 per day in September" when the data's September is 1-24 September, 271
// relevant, 11.3 per day over 24 days: the model had divided by 30 itself. The rates the tools gave are read back from
// what they returned, and a stated rate that matches none of them is flagged.

const result = (text: string): ModelMessage => ({
  role: "tool",
  content: [
    { type: "tool-result", toolCallId: "c", toolName: "scan", output: { type: "text", value: text } },
  ],
});

describe("knownRates", () => {
  it("reads every rate the tools gave, in their one form, from this turn and the turns before", () => {
    const history: ModelMessage[] = [
      { role: "user", content: "Did people complain more in July or in September?" },
      result(
        "Period: 2026-07-01 to 2026-07-31, 31 days: 220 relevant, 7.1 per day over 31 days; 800 read, 25.8 per day over 31 days.",
      ),
      { role: "assistant", content: "July had 7.1 per day." },
      result("Period: 2026-09-01 to 2026-09-24, 24 days: 271 relevant, 11.3 per day over 24 days."),
    ];
    expect(knownRates(history).map((r) => r.value)).toEqual([7.1, 25.8, 11.3]);
    expect(knownRates(history)[2].words).toBe("11.3 per day over 24 days");
  });

  it("never takes a rate the model wrote for one a tool gave", () => {
    expect(knownRates([{ role: "assistant", content: "9 per day over 30 days" }])).toEqual([]);
  });
});

describe("rateMismatches", () => {
  const known = [
    { value: 7.1, words: "7.1 per day over 31 days" },
    { value: 11.3, words: "11.3 per day over 24 days" },
  ];

  it("flags a rate no tool gave, and names the ones they did", () => {
    const m = rateMismatches(
      "July ran about 7 conversations per day, against 9 per day in September.",
      known,
    );
    expect(m).toHaveLength(1);
    expect(m[0].stated).toBe("9");
    expect(m[0].known).toEqual(["7.1 per day over 31 days", "11.3 per day over 24 days"]);
  });

  it("matches a rate to its own precision: 'about 7' for 7.1, 11.3 for 11.3, but not 11.2", () => {
    expect(rateMismatches("About 7 complaint threads per day in July.", known)).toEqual([]);
    expect(rateMismatches("September ran 11.3 per day.", known)).toEqual([]);
    expect(rateMismatches("September ran 11.2 per day.", known).map((m) => m.stated)).toEqual(["11.2"]);
  });

  // Review 2026-09-26: any noun before "per day" was taken for a rate of ours, and the tolerance used only the stated
  // figure's precision. Each false flag cost a rewrite told to remove a correct sentence.
  it("never flags what people said, only a count of the data's own nouns", () => {
    expect(rateMismatches("One player hit 3 crashes per day [msg1].", known)).toEqual([]);
    expect(rateMismatches("The event paid 100 gems per day [msg2].", known)).toEqual([]);
    expect(rateMismatches("That was 9 complaint threads per day.", known).map((m) => m.stated)).toEqual([
      "9 complaint threads",
    ]);
    expect(rateMismatches("That was 9 conversations per day.", known).map((m) => m.stated)).toEqual([
      "9 conversations",
    ]);
  });

  it("matches within the rounding of whichever figure is written less precisely", () => {
    expect(rateMismatches("September ran 11.29 per day.", known)).toEqual([]);
    expect(
      rateMismatches("Bug reports ran 0.04 per day.", [{ value: 0, words: "0.0 per day over 24 days" }]),
    ).toEqual([]);
    expect(rateMismatches("September ran 11.8 per day.", known).map((m) => m.stated)).toEqual(["11.8"]);
  });

  it("reads every way of writing a day: a day, per-day, /day, daily", () => {
    const stated = (s: string) => rateMismatches(s, known).map((m) => m.stated);
    expect(stated("9 a day in September.")).toEqual(["9"]);
    expect(stated("11.3 conversations per-day and 9 a day.")).toEqual(["9"]);
    expect(stated("9/day in September.")).toEqual(["9"]);
    expect(stated("9 posts daily in September.")).toEqual(["9 posts"]);
    expect(stated("11.3 conversations per-day in September.")).toEqual([]);
  });

  // Out of scope on purpose (rates.ts PER_DAY): the by-week counts give each week's own count, not a rate, so a week's
  // figure is not checked against a daily rate times seven.
  it("leaves a week's figure alone", () => {
    expect(rateMismatches("The worst week had 63 complaints per week.", known)).toEqual([]);
  });

  it("says nothing about an answer that states no rate", () => {
    expect(rateMismatches("People complained about lag in September [msg11].", known)).toEqual([]);
  });

  it("flags every rate when the tools gave none", () => {
    expect(rateMismatches("About 9 per day.", []).map((m) => m.stated)).toEqual(["9"]);
  });
});

// Production QA 2026-09-26: "at 25% each" was in no cited message and no count. What the tools worked out is read back
// from their own lines; the conversations they printed are not, since a message's figure is checked against it alone.
describe("toolFigures", () => {
  it("reads the numbers of the tools' own lines, not of the conversations they printed", () => {
    const figures = toolFigures([
      result(
        "Scanned 840 conversations; 212 relevant.\nAverage mood: 46/100.\nPeriod: 2026-09-01 to 2026-09-24, 24 days.\nThe 1 most relevant:\n\n## conversation conv7 · Discussion · relevance 83%\n[msg11] alice: 25% of my games lag",
      ),
    ]);
    expect(figures.sort((a, b) => a - b)).toEqual([1, 24, 46, 100, 212, 840]);
  });
  // Production QA 2026-09-26: the change between two periods is worked out in code (trends.ts) and read back like any
  // other tool figure, so an answer that states it passes the figure check.
  it("reads the change between two periods, minus sign included, as a figure the tools gave", () => {
    const figures = toolFigures([
      result(
        "Change in conversations per day, 2026-08-01 to 2026-08-31 against 2026-09-01 to 2026-09-24: Performance & Access +121%; Updates & Feedback −6%.",
      ),
    ]);
    expect(figures.sort((a, b) => a - b)).toEqual([6, 121]);
  });
  it("figuresIn reads percent forms alike and skips dates and releases", () => {
    expect(
      figuresIn("25% then 25 percent, after 43.1 on 9 September, 1,234 in all").map((f) => f.value),
    ).toEqual([25, 25, 1234]);
  });
});
