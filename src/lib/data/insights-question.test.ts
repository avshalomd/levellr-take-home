import { describe, expect, it } from "vitest";
import { EMPTY_AGG, buildPeriods, type Agg } from "./insights-model";
import {
  askHref,
  comparison,
  describe as describeSel,
  inSentence,
  listJoin,
  periodsBefore,
  suggestions,
  whenNoun,
  whenPhrase,
  whenShort,
} from "./insights-question";

const W = { from: "2026-06-18", to: "2026-09-24" };
const weeks = buildPeriods("week", W.from, W.to);
const days = buildPeriods("day", W.from, W.to);
const months = buildPeriods("month", W.from, W.to);
const wk = (iso: string) => weeks.find((p) => p.key === iso)!;
const dy = (iso: string) => days.find((p) => p.key === iso)!;
const TOPICS = [
  { key: "performance", name: "Performance" },
  { key: "bugs", name: "Bugs" },
  { key: "maps", name: "Maps" },
  { key: "pvp", name: "PvP balance" },
  { key: "other", name: "Other" },
];

describe("words", () => {
  it("joins lists the way people write them", () => {
    expect(listJoin(["a"])).toBe("a");
    expect(listJoin(["a", "b"])).toBe("a and b");
    expect(listJoin(["a", "b", "c"])).toBe("a, b and c");
  });

  it("lower-cases a topic mid-sentence unless it is an acronym or a proper noun", () => {
    expect(inSentence("Performance")).toBe("performance");
    expect(inSentence("PvP balance")).toBe("PvP balance");
    expect(inSentence("AI features")).toBe("AI features");
    expect(inSentence("Performance & Access")).toBe("performance & access");
    expect(inSentence("Esports & Competitive")).toBe("esports & competitive");
    expect(inSentence("New AI Tools")).toBe("new AI tools");
    expect(inSentence("Servers in Europe")).toBe("servers in Europe");
  });

  // QA P7: Explore asked about "domains" and "tides remastered"; it now follows the chat page's rule (starters.ts).
  it("keeps a proper noun's capitals, as the chat page's topic chips do", () => {
    const names = [
      { key: "domains", name: "Domains" },
      { key: "tides-remastered", name: "Tides Remastered" },
      { key: "pricing", name: "Pricing, editions and monetisation" },
    ];
    const q = (key: string) => describeSel([{ topic: key, period: wk("2026-09-14") }], names, weeks, "week", W).question;
    expect(q("domains")).toBe("What were people saying about Domains in the week of 14 September 2026?");
    expect(q("tides-remastered")).toBe("What were people saying about Tides Remastered in the week of 14 September 2026?");
    expect(q("pricing")).toBe("What were people saying about pricing, editions and monetisation in the week of 14 September 2026?");
  });
});

describe("when", () => {
  it("one or more weeks become a span of days, clipped to the data", () => {
    expect(whenPhrase([wk("2026-09-07"), wk("2026-09-14")], weeks, "week", W)).toBe("between 7 and 20 September 2026");
    expect(whenShort([wk("2026-09-07"), wk("2026-09-14")], weeks, "week", W)).toBe("7–20 Sep");
    expect(whenPhrase([wk("2026-09-07")], weeks, "week", W)).toBe("in the week of 7 September 2026");
    expect(whenPhrase([wk("2026-09-21")], weeks, "week", W)).toBe("between 21 and 24 September 2026"); // partial
    expect(whenPhrase([wk("2026-08-24"), wk("2026-08-31")], weeks, "week", W)).toBe("between 24 August and 6 September 2026");
    expect(whenShort([wk("2026-08-24"), wk("2026-08-31")], weeks, "week", W)).toBe("24 Aug – 6 Sep");
  });

  it("days and months read naturally", () => {
    expect(whenPhrase([dy("2026-09-09")], days, "day", W)).toBe("on 9 September 2026");
    expect(whenShort([dy("2026-09-09")], days, "day", W)).toBe("9 Sep");
    expect(whenPhrase([months[1]], months, "month", W)).toBe("in July 2026");
    expect(whenPhrase([months[1], months[2]], months, "month", W)).toBe("between July and August 2026");
    expect(whenShort([months[1], months[2]], months, "month", W)).toBe("July – August");
  });

  it("separate periods are named one by one, or counted when there are many", () => {
    expect(whenPhrase([dy("2026-09-03"), dy("2026-09-09")], days, "day", W)).toBe("on 3 September and 9 September 2026");
    expect(whenPhrase([wk("2026-09-07"), wk("2026-08-24")], weeks, "week", W)).toBe("in the weeks of 24 August and 7 September 2026");
    expect(whenPhrase([months[0], months[2]], months, "month", W)).toBe("in June and August 2026");
    const scattered = ["2026-07-01", "2026-07-05", "2026-08-01", "2026-09-01"].map(dy);
    expect(whenPhrase(scattered, days, "day", W)).toBe("on 4 separate days between 1 July and 1 September 2026");
    expect(whenShort(scattered, days, "day", W)).toBe("4 days, 1 Jul – 1 Sep");
  });

  it("a few stretches of different lengths are each named, not counted", () => {
    const four = ["2026-07-06", "2026-07-13", "2026-07-20", "2026-07-27", "2026-08-24"].map(wk);
    expect(whenPhrase(four, weeks, "week", W)).toBe("in the weeks of 6–27 July and 24 August 2026");
    const dd = ["2026-07-03", "2026-07-04", "2026-07-05", "2026-07-12"].map(dy);
    expect(whenPhrase(dd, days, "day", W)).toBe("on 3–5 July and 12 July 2026");
    expect(whenPhrase([months[0], months[1], months[3]], months, "month", W)).toBe("in June to July and September 2026");
  });
});

describe("describe a selection", () => {
  it("a rectangle: title, dates and one clean question", () => {
    const cells = ["performance", "bugs"].flatMap((topic) => [wk("2026-09-07"), wk("2026-09-14")].map((period) => ({ topic, period })));
    const d = describeSel(cells, TOPICS, weeks, "week", W);
    expect(d.title).toBe("Performance and Bugs");
    expect(d.when).toBe("7–20 Sep");
    expect(d.question).toBe("What were people saying about performance and bugs between 7 and 20 September 2026?");
    expect(d.rectangular).toBe(true);
    expect([d.first, d.last]).toEqual(["2026-09-07", "2026-09-20"]);
    expect(askHref(d.question)).toBe(`/?q=${encodeURIComponent(d.question)}`);
  });

  it("topics follow the grid's order, not the click order", () => {
    const cells = [{ topic: "maps", period: wk("2026-09-07") }, { topic: "performance", period: wk("2026-09-07") }];
    expect(describeSel(cells, TOPICS, weeks, "week", W).title).toBe("Performance and Maps");
  });

  it("every topic reads as the whole community", () => {
    const cells = TOPICS.map((t) => ({ topic: t.key, period: months[1] }));
    const d = describeSel(cells, TOPICS, months, "month", W);
    expect(d.title).toBe("All topics");
    expect(d.question).toBe("What were people talking about in July 2026?");
  });

  it("many topics are counted in the title and trimmed in the question", () => {
    const cells = TOPICS.slice(0, 5).map((t) => ({ topic: t.key, period: wk("2026-09-07") }));
    const d = describeSel(cells, [...TOPICS, { key: "ranked", name: "Ranked" }], weeks, "week", W);
    expect(d.title).toBe("5 topics");
    expect(d.question).toBe("What were people saying about performance, bugs, maps and 2 other topics in the week of 7 September 2026?");
  });

  it("a different stretch per topic is asked topic by topic", () => {
    const cells = [
      { topic: "performance", period: wk("2026-09-07") },
      { topic: "bugs", period: wk("2026-09-14") },
    ];
    const d = describeSel(cells, TOPICS, weeks, "week", W);
    expect(d.rectangular).toBe(false);
    expect(d.question).toBe(
      "What were people saying about performance in the week of 7 September 2026, and about bugs in the week of 14 September 2026?",
    );
    expect(d.when).toBe("7–20 Sep");
  });
});

describe("when, as a noun", () => {
  it("names the far side of a comparison without a preposition", () => {
    expect(whenNoun([wk("2026-09-07")], weeks, "week", W)).toBe("the week of 7 September 2026");
    expect(whenNoun([wk("2026-08-31"), wk("2026-09-07")], weeks, "week", W)).toBe("31 August – 13 September 2026");
    expect(whenNoun([dy("2026-07-03"), dy("2026-07-12")], days, "day", W)).toBe("3 July and 12 July 2026");
    expect(whenNoun([months[1], months[2]], months, "month", W)).toBe("July to August 2026");
  });
});

describe("comparing two blocks", () => {
  const block = (topics: string[], ps: ReturnType<typeof wk>[]) => topics.flatMap((topic) => ps.map((period) => ({ topic, period })));

  it("the same topic in two weeks repeats only the time", () => {
    const q = comparison([block(["performance"], [wk("2026-09-07")]), block(["performance"], [wk("2026-09-14")])], TOPICS, weeks, "week", W);
    expect(q).toBe("How did what people said about performance in the week of 7 September 2026 compare with the week of 14 September 2026?");
  });

  it("two topics in the same week repeat only the topics", () => {
    const q = comparison([block(["performance"], [wk("2026-09-07")]), block(["maps"], [wk("2026-09-07")])], TOPICS, weeks, "week", W);
    expect(q).toBe("How did what people said about performance compare with what they said about maps, in the week of 7 September 2026?");
  });

  it("different topics at different times say both in full", () => {
    const q = comparison(
      [block(["performance", "bugs"], [wk("2026-08-31"), wk("2026-09-07")]), block(["pvp"], [wk("2026-09-14")])],
      TOPICS,
      weeks,
      "week",
      W,
    );
    expect(q).toBe(
      "How did what people said about performance and bugs between 31 August and 13 September 2026 compare with what they said about PvP balance in the week of 14 September 2026?",
    );
  });

  it("whole columns compare the community with itself over time", () => {
    const all = TOPICS.map((t) => t.key);
    const q = comparison([block(all, [wk("2026-07-06")]), block(all, [wk("2026-09-07")])], TOPICS, weeks, "week", W);
    expect(q).toBe("How did what people said in the week of 6 July 2026 compare with the week of 7 September 2026?");
  });

  it("three blocks are listed; one block, or too many, are not a comparison", () => {
    const three = [wk("2026-08-24"), wk("2026-09-07"), wk("2026-09-21")].map((p) => block(["maps"], [p]));
    expect(comparison(three, TOPICS, weeks, "week", W)).toBe(
      "How did what people said about maps in the week of 24 August 2026 compare with the week of 7 September and 21–24 September 2026?",
    );
    expect(comparison([block(["maps"], [wk("2026-09-07")])], TOPICS, weeks, "week", W)).toBeNull();
    const five = weeks.slice(0, 10).filter((_, i) => i % 2 === 0).map((p) => block(["maps"], [p]));
    expect(comparison(five, TOPICS, weeks, "week", W)).toBeNull();
  });
});

describe("the one-tap rewrites", () => {
  const agg = (x: Partial<Agg>): Agg => ({ ...EMPTY_AGG, ...x });
  const population = agg({ n: 10628, moodSum: 4820, moodN: 10628 }); // average 45
  const one = [{ topic: "performance", period: wk("2026-09-07") }];
  const base = { topics: TOPICS, all: weeks, res: "week" as const, w: W };

  it("one block: what was said first, then the week before and the other topics, with dates written out", () => {
    const s = suggestions({ ...base, cells: one, blocks: [one], sel: agg({ n: 50, moodSum: 22.5, moodN: 50 }), population });
    expect(s.map((x) => x.label)).toEqual(["What was said", "Compare with the week before", "Compare with the other topics"]);
    expect(s[0].question).toBe("What were people saying about performance in the week of 7 September 2026?");
    expect(s[1].question).toBe("How did what people said about performance in the week of 7 September 2026 compare with the week of 31 August 2026?");
    expect(s[2].question).toBe(
      "How did what people said about performance in the week of 7 September 2026 compare with what they said about the other topics in the same week?",
    );
  });

  it("a longer stretch is compared with a stretch of the same length", () => {
    const cells = [wk("2026-08-31"), wk("2026-09-07")].map((period) => ({ topic: "maps", period }));
    expect(periodsBefore(cells.map((c) => c.period), weeks)!.map((p) => p.key)).toEqual(["2026-08-17", "2026-08-24"]);
    const s = suggestions({ ...base, cells, blocks: [cells], sel: agg({ n: 50 }), population });
    expect(s[1]).toMatchObject({ label: "Compare with the 2 weeks before" });
    expect(s[1].question).toMatch(/compare with 17–30 August 2026\?$/);
  });

  it("near the start of the data the chip names the stretch that exists, not the selection's length", () => {
    const cells = [weeks[1], weeks[2], weeks[3]].map((period) => ({ topic: "maps", period }));
    const s = suggestions({ ...base, cells, blocks: [cells], sel: agg({ n: 50 }), population });
    expect(s[1].label).toBe("Compare with the week before");
    expect(s[1].question).toMatch(/compare with 18–21 June 2026\?$/);
  });

  it("the first week has nothing before it, and every topic has no others", () => {
    const cells = TOPICS.map((t) => ({ topic: t.key, period: weeks[0] }));
    const s = suggestions({ ...base, cells, blocks: [cells], sel: agg({ n: 50 }), population });
    expect(s.map((x) => x.id)).toEqual(["what"]);
    expect(periodsBefore([weeks[3], weeks[5]], weeks)).toBeNull(); // two stretches have no single "before"
  });

  it("a clearly gloomier or happier selection gets a mood question; a small one does not", () => {
    const low = suggestions({ ...base, cells: one, blocks: [one], sel: agg({ n: 40, moodSum: 14, moodN: 40 }), population });
    expect(low.at(-1)).toEqual({
      id: "mood",
      label: "Why the mood was low",
      question: "What made the mood lower than usual in conversations about performance in the week of 7 September 2026?",
    });
    const high = suggestions({ ...base, cells: one, blocks: [one], sel: agg({ n: 40, moodSum: 24, moodN: 40 }), population });
    expect(high.at(-1)!.label).toBe("What lifted the mood");
    const tiny = suggestions({ ...base, cells: one, blocks: [one], sel: agg({ n: 4, moodSum: 0, moodN: 4 }), population });
    expect(tiny.some((x) => x.id === "mood")).toBe(false);
  });

  // D48: no question is built from a release; the grid carries none.
  it("offers no question about a release", () => {
    const s = suggestions({ ...base, cells: one, blocks: [one], sel: agg({ n: 50, moodSum: 22.5, moodN: 50 }), population });
    expect(s.some((x) => x.id === "event" || /after|release|update/i.test(x.label))).toBe(false);
  });

  it("two blocks: the comparison is the default, all of it together the alternative", () => {
    const a = [{ topic: "performance", period: wk("2026-09-07") }];
    const b = [{ topic: "performance", period: wk("2026-09-21") }];
    const s = suggestions({ ...base, cells: [...a, ...b], blocks: [a, b], sel: agg({ n: 50 }), population });
    expect(s.map((x) => x.label)).toEqual(["Compare the two", "Ask about all of it together"]);
    expect(s[0].question).toBe("How did what people said about performance in the week of 7 September 2026 compare with 21–24 September 2026?");
    expect(s[1].question).toBe("What were people saying about performance in the weeks of 7 September and 21 September 2026?");
  });
});

// Open item 2026-09-26 (left in round 0): the questions named no year. Every date a question carries says its year,
// taken from the dataset's own periods; where a phrase's dates share a year it is written once, at the end. Titles
// (whenShort) are display and carry none.
describe("the year in a question", () => {
  const W2 = { from: "2025-11-20", to: "2026-01-24" };
  const weeks2 = buildPeriods("week", W2.from, W2.to);
  const days2 = buildPeriods("day", W2.from, W2.to);
  const months2 = buildPeriods("month", W2.from, W2.to);
  const wk2 = (iso: string) => weeks2.find((p) => p.key === iso)!;
  const dy2 = (iso: string) => days2.find((p) => p.key === iso)!;

  it("comes from the data, not from this year", () => {
    expect(whenPhrase([wk2("2025-12-08")], weeks2, "week", W2)).toBe("in the week of 8 December 2025");
    expect(whenPhrase([months2[0]], months2, "month", W2)).toBe("in November 2025");
  });

  it("is written once when both ends share it, and on each end across a new year", () => {
    expect(whenPhrase([wk2("2025-12-08"), wk2("2025-12-15")], weeks2, "week", W2)).toBe("between 8 and 21 December 2025");
    expect(whenPhrase([wk2("2025-12-22"), wk2("2025-12-29")], weeks2, "week", W2)).toBe("between 22 December 2025 and 4 January 2026");
    expect(whenPhrase([months2[1], months2[2]], months2, "month", W2)).toBe("between December 2025 and January 2026");
    expect(whenNoun([wk2("2025-12-29")], weeks2, "week", W2)).toBe("the week of 29 December 2025");
    expect(whenNoun([dy2("2025-12-31"), dy2("2026-01-01")], days2, "day", W2)).toBe("31 December 2025 – 1 January 2026");
    expect(whenPhrase([dy2("2025-12-03"), dy2("2026-01-09")], days2, "day", W2)).toBe("on 3 December 2025 and 9 January 2026");
    expect(whenPhrase([months2[0], months2[2]], months2, "month", W2)).toBe("in November 2025 and January 2026");
    const scattered = ["2025-11-21", "2025-12-01", "2025-12-15", "2026-01-05"].map(dy2);
    expect(whenPhrase(scattered, days2, "day", W2)).toBe("on 4 separate days between 21 November 2025 and 5 January 2026");
  });

  it("reaches every question Explore offers, and no title", () => {
    const one = [{ topic: "performance", period: wk2("2026-01-05") }];
    const s = suggestions({
      topics: TOPICS,
      all: weeks2,
      res: "week",
      w: W2,
      cells: one,
      blocks: [one],
      sel: { ...EMPTY_AGG, n: 40, moodSum: 14, moodN: 40 },
      population: { ...EMPTY_AGG, n: 1000, moodSum: 450, moodN: 1000 },
    });
    expect(s.map((x) => x.question)).toEqual([
      "What were people saying about performance in the week of 5 January 2026?",
      "How did what people said about performance in the week of 5 January 2026 compare with the week of 29 December 2025?",
      "How did what people said about performance in the week of 5 January 2026 compare with what they said about the other topics in the same week?",
      "What made the mood lower than usual in conversations about performance in the week of 5 January 2026?",
    ]);
    expect(describeSel(one, TOPICS, weeks2, "week", W2).when).toBe("5–11 Jan");
    const block = (p: ReturnType<typeof wk2>) => [{ topic: "maps", period: p }];
    expect(comparison([block(wk2("2025-12-15")), block(wk2("2025-12-29")), block(wk2("2026-01-12"))], TOPICS, weeks2, "week", W2)).toBe(
      "How did what people said about maps in the week of 15 December 2025 compare with the week of 29 December 2025 and the week of 12 January 2026?",
    );
  });
});
