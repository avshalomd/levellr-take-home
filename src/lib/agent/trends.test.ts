import { describe, expect, it } from "vitest";
import type { ModelMessage } from "ai";
import {
  changeAgainst,
  changeWords,
  directionMismatches,
  pctWords,
  toolTrends,
  type CountLike,
} from "./trends";

// Production QA 2026-09-26: "Which topics grew the most from August to September?" gave +124% from rates rounded to one
// decimal (the unrounded rates give +121%), and "The September lift in Performance & Access and Updates & Feedback"
// named a topic that fell 6%.

const AUG = { since: "2026-08-01", until: "2026-09-01", days: 31 };
const SEP = { since: "2026-09-01", until: "2026-09-25", days: 24 };
const count = (
  period: typeof AUG,
  rows: [string, number][],
  filters: CountLike["filters"] = {},
): CountLike => ({
  metric: "conversations",
  groupBy: "topic",
  filters: { ...filters, since: period.since, until: period.until },
  rows: rows.map(([key, value]) => ({ key, value })),
  period,
});
const NAMES: Record<string, string> = {
  perf: "Performance & Access",
  updates: "Updates & Feedback",
  weapons: "Weapons & Combat",
};
const nameOf = (k: string) => NAMES[k] ?? k;

describe("changeAgainst", () => {
  it("works the change out from the unrounded per-day rates: 66 over 31 days to 113 over 24 is +121%, not +124%", () => {
    const c = changeAgainst(
      [
        count(AUG, [
          ["perf", 66],
          ["updates", 310],
        ]),
      ],
      count(SEP, [
        ["perf", 113],
        ["updates", 225],
      ]),
      nameOf,
    );
    expect(c?.from).toEqual(AUG);
    expect(c?.to).toEqual(SEP);
    expect(c?.rows.map((r) => [r.name, pctWords(r.pct)])).toEqual([
      ["Performance & Access", "up 121%"],
      ["Updates & Feedback", "down 6%"],
    ]);
  });

  it("orders the periods by time, whichever was counted first", () => {
    const c = changeAgainst([count(SEP, [["perf", 113]])], count(AUG, [["perf", 66]]), nameOf);
    expect(c?.from).toEqual(AUG);
    expect(pctWords(c!.rows[0].pct)).toBe("up 121%");
  });

  it("compares only the same slice, grouped the same way, over separate periods", () => {
    const sep = count(SEP, [["perf", 113]]);
    expect(changeAgainst([count(AUG, [["perf", 66]], { flag: "complaint" })], sep, nameOf)).toBeUndefined();
    expect(
      changeAgainst([{ ...count(AUG, [["perf", 66]]), groupBy: "channel" }], sep, nameOf),
    ).toBeUndefined();
    expect(
      changeAgainst(
        [count({ since: "2026-08-15", until: "2026-09-10", days: 26 }, [["perf", 66]])],
        sep,
        nameOf,
      ),
    ).toBeUndefined();
    expect(
      changeAgainst(
        [{ ...count(AUG, [["perf", 66]]), metric: "avg_sentiment" }],
        { ...sep, metric: "avg_sentiment" },
        nameOf,
      ),
    ).toBeUndefined();
  });

  it("leaves out a row with nothing in the earlier period, which has no change to give", () => {
    const c = changeAgainst(
      [count(AUG, [["perf", 66]])],
      count(SEP, [
        ["perf", 113],
        ["weapons", 40],
      ]),
      nameOf,
    );
    expect(c?.rows.map((r) => r.name)).toEqual(["Performance & Access"]);
  });
});

describe("changeWords and toolTrends", () => {
  const c = changeAgainst(
    [
      count(AUG, [
        ["perf", 66],
        ["updates", 310],
      ]),
    ],
    count(SEP, [
      ["perf", 113],
      ["updates", 225],
    ]),
    nameOf,
  )!;
  const history = (text: string): ModelMessage[] => [
    {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: "t1",
          toolName: "aggregate",
          output: { type: "text", value: text },
        },
      ],
    },
  ];

  it("writes the change in one fixed form, with a direction word and the periods' last days", () => {
    expect(changeWords(c).split("\n")[0]).toBe(
      "Change in conversations per day, 2026-08-01 to 2026-08-31 against 2026-09-01 to 2026-09-24: Performance & Access up 121%; Updates & Feedback down 6%.",
    );
    expect(changeWords(c)).toMatch(/never work one out yourself/);
    expect(changeWords(c)).toMatch(/no sign on the figure \("rose 51%", "fell 12%"\)/);
  });

  it("reads the changes back from the tool results, in this form and the signed one saved before it", () => {
    expect(toolTrends(history(`Conversations by topic.\n${changeWords(c)}`))).toEqual([
      { name: "Performance & Access", pct: 121 },
      { name: "Updates & Feedback", pct: -6 },
    ]);
    expect(
      toolTrends(
        history(
          "Change in conversations per day, 2026-08-01 to 2026-08-31 against 2026-09-01 to 2026-09-24: Performance & Access +121%; Updates & Feedback −6%; Domains 0%; Hollow no change.",
        ),
      ),
    ).toEqual([
      { name: "Performance & Access", pct: 121 },
      { name: "Updates & Feedback", pct: -6 },
      { name: "Domains", pct: 0 },
      { name: "Hollow", pct: 0 },
    ]);
    expect(toolTrends(history("Performance & Access up 121%"))).toEqual([]);
  });

  // Production QA 2026-09-27 (P17): given "+51%", the answer wrote "rose by +51%".
  it("gives an unsigned figure with a direction word, never a sign the answer would repeat", () => {
    expect(pctWords(-48.2)).toBe("down 48%");
    expect(pctWords(0.3)).toBe("no change");
    expect(pctWords(12.6)).toBe("up 13%");
  });
});

describe("directionMismatches", () => {
  const trends = [
    { name: "Performance & Access", pct: 121 },
    { name: "Updates & Feedback", pct: -6 },
    { name: "complaints", pct: -30 },
  ];

  it("flags the QA sentence: a lift in a topic that fell", () => {
    const qa =
      "The September lift in Performance & Access and Updates & Feedback coincides with the 43.1 release.";
    expect(directionMismatches(qa, trends)).toEqual([
      { claim: qa, name: "Updates & Feedback", said: "rose", pct: -6 },
    ]);
  });

  it("reads 'and' for '&', and each side of a contrast on its own", () => {
    expect(directionMismatches("Updates and Feedback grew in September.", trends).map((d) => d.name)).toEqual(
      ["Updates & Feedback"],
    );
    expect(directionMismatches("Performance & Access rose, while complaints fell.", trends)).toEqual([]);
    // Live 2026-09-26: the topic "Other" rose 4%; "most other topics fell" is not about it.
    expect(
      directionMismatches("Most other topics fell over the period.", [{ name: "Other", pct: 4 }]),
    ).toEqual([]);
    expect(
      directionMismatches("Other fell over the period.", [{ name: "Other", pct: 4 }]).map((d) => d.name),
    ).toEqual(["Other"]);
    expect(
      directionMismatches("Performance & Access fell, while complaints rose.", trends).map((d) => [
        d.name,
        d.said,
      ]),
    ).toEqual([
      ["Performance & Access", "fell"],
      ["complaints", "rose"],
    ]);
  });

  it("leaves words that compare topics or do not state a change", () => {
    for (const s of [
      "Updates & Feedback ran higher than Weapons & Combat.",
      "Players set up Updates & Feedback threads for each patch.",
      "Updates & Feedback threads were up to date with each patch.",
      "Updates & Feedback is the largest topic.",
    ])
      expect(directionMismatches(s, trends), s).toEqual([]);
  });

  it("flags a stated change about a topic whose rate did not move", () => {
    expect(directionMismatches("Updates grew.", [{ name: "Updates", pct: 0.2 }]).map((d) => d.name)).toEqual([
      "Updates",
    ]);
  });

  it("reads nothing when the tools gave no change", () => {
    expect(directionMismatches("Updates & Feedback fell.", [])).toEqual([]);
  });
});
