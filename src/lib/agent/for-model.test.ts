import { describe, expect, it } from "vitest";
import type { AggregateResult } from "@/lib/data/aggregate";
import type { ScanResult } from "@/lib/data/scan";
import { REFUSED } from "./flags";
import {
  aggregateForModel,
  conversationsForModel,
  COUNTS_ONLY,
  failedWords,
  periodOf,
  refusalWords,
  scanForModel,
  sliceWords,
  voicesForModel,
} from "./for-model";

// QA 2026-09-25: an answer quoted mood as "0.238" beside an activity line reading "24 / 100", and read "80 of 129"
// complaint-filtered conversations as "the topic leans critical". The model's text is where both were fixed.
describe("what the model reads back", () => {
  const agg = (metric: AggregateResult["metric"], value: number): AggregateResult => ({
    metric,
    groupBy: "week",
    filters: { topic: "cheating", since: "2026-08-24", until: "2026-08-31" },
    rows: [{ key: "2026-08-24", value, n: 51 }],
    sql: "",
    params: [],
  });

  it("gives mood on the app's 0-100 scale and names the slice", () => {
    const t = aggregateForModel(agg("avg_sentiment", 0.238));
    expect(t).toContain("2026-08-24: 24/100 (n=51)");
    expect(t).toContain("over conversations touching topic cheating, from 2026-08-24, before 2026-08-31");
    expect(t).not.toContain("0.238");
  });

  it("leaves other metrics as they are", () => {
    expect(aggregateForModel(agg("conversations", 51))).toContain("2026-08-24: 51 (n=51)");
  });

  const ok = (flag?: "frustrated"): ScanResult => ({
    status: "ok",
    question: "q",
    filters: { topic: "updates", ...(flag ? { flag } : {}) },
    scanned: 129,
    relevant: 80,
    failed: 0,
    relevantByWeek: [],
    relevantByTopic: [],
    relevantIds: [],
    hits: [],
  });

  it("says a flag-filtered count is a share of the flagged slice, not of the topic", () => {
    const t = scanForModel(ok("frustrated"), 400);
    expect(t).toContain(
      "Scanned 129 conversations (conversations touching topic updates, only frustrated conversations); 80 relevant",
    );
    expect(t).toContain("All 129 were already frustrated conversations");
    expect(t).toContain("use aggregate");
  });

  it("says a scan's count is conversations on the question either way, not the ones that say yes (QA 2026-09-26)", () => {
    expect(scanForModel(ok(), 400)).toContain(
      "relevant to the question (they bear on it, whichever way they lean;",
    );
  });

  it("adds no such note when no flag narrowed the slice", () => {
    expect(scanForModel(ok(), 400)).not.toContain("already");
  });

  it("describes an unfiltered slice", () => {
    expect(sliceWords({})).toBe("all conversations");
  });
});

describe("voicesForModel", () => {
  const base = { filters: { topic: "updates" }, limit: 10, total_authors: 312, sql: "", params: [] };
  it("lists each voice on a line with the slice's head count as the denominator", () => {
    const out = voicesForModel({
      ...base,
      rows: [
        {
          author: "Deep-Pen420",
          messages: 40,
          conversations: 12,
          reactions: 3,
          started: 2,
          first_ts: "2026-07-01T10:00:00Z",
          last_ts: "2026-09-20T09:00:00Z",
        },
      ],
    });
    expect(out).toContain("The 1 most active of 312 people in conversations touching topic updates");
    expect(out).toContain(
      "Deep-Pen420: 40 messages in 12 conversations, started 2, 3 reactions, 2026-07-01 to 2026-09-20",
    );
  });
  it("says plainly when nobody wrote", () => {
    expect(voicesForModel({ ...base, rows: [] })).toBe(
      "Nobody wrote in conversations touching topic updates.",
    );
  });
  it("names an author filter in the slice", () => {
    expect(sliceWords({ author: "alwaysHK" })).toBe("only conversations alwaysHK wrote in");
  });
});

// QA 2026-09-26: asked how players reacted to 42.3, the model read only complaint threads and bug reports, even with a
// note beside each number telling it the question had not asked about them. The call is refused instead.
describe("refusalWords", () => {
  it("tells the model the call was not run, why, and to read again without the flag", () => {
    const t = refusalWords("frustrated");
    expect(t.startsWith(REFUSED)).toBe(true);
    expect(t).toContain("the question does not ask about frustrated conversations");
    expect(t).toContain("Nothing was read");
    expect(t).toContain("without filters.flag");
    expect(t).toContain("narrow by topic or dates instead");
  });
  it("names each kind in words", () => {
    expect(refusalWords("help")).toContain("does not ask about requests for help");
    expect(refusalWords("bug")).toContain("reading only bug reports");
  });
});

// QA 2026-09-26, round 5: July (31 days) against 1-24 September by raw counts, "cosmetics fell from 144 to 109 - the
// biggest shift", when per day it was flat (4.6 against 4.5).
describe("a count and the days it covers", () => {
  const window = { from: "2026-06-18", to: "2026-09-24" };
  const count = (
    since: string,
    until: string,
    value: number,
    groupBy: AggregateResult["groupBy"] = "topic",
  ) => {
    const filters = { since, until };
    return aggregateForModel({
      metric: "conversations",
      groupBy,
      filters,
      rows: [{ key: "cosmetics-store", value, n: value }],
      sql: "",
      params: [],
      period: periodOf(filters, window),
    });
  };

  it("clips a period to the data, with until exclusive", () => {
    expect(periodOf({ since: "2026-07-01", until: "2026-08-01" }, window)).toEqual({
      since: "2026-07-01",
      until: "2026-08-01",
      days: 31,
    });
    expect(periodOf({ since: "2026-09-01", until: "2026-10-01" }, window)).toEqual({
      since: "2026-09-01",
      until: "2026-09-25",
      days: 24,
    });
    expect(periodOf({}, window)).toEqual({ since: "2026-06-18", until: "2026-09-25", days: 99 });
    expect(periodOf({ since: "2026-09-01" })).toBeNull();
  });

  it("gives each row a per-day rate and the period's length, and says to compare rates", () => {
    const july = count("2026-07-01", "2026-08-01", 144);
    const september = count("2026-09-01", "2026-09-25", 109);
    expect(july).toContain("cosmetics-store: 144, 4.6 per day over 31 days (n=144)");
    expect(september).toContain("cosmetics-store: 109, 4.5 per day over 24 days (n=109)");
    expect(september).toContain("Period: 2026-09-01 to 2026-09-24, 24 days.");
    expect(september).toContain(
      "To compare periods of different lengths, compare the per-day rates, never the raw counts",
    );
  });

  // Review 2026-09-26, live: July and September counted by day, no rate given, and the answer worked July's out itself.
  it("gives a count by day or by week its total and rate over the whole period", () => {
    const filters = { since: "2026-07-01", until: "2026-08-01" };
    const rows = [
      { key: "2026-07-01", value: 40, n: 40 },
      { key: "2026-07-02", value: 22, n: 22 },
    ];
    const byDay = aggregateForModel({
      metric: "conversations",
      groupBy: "day",
      filters,
      rows,
      sql: "",
      params: [],
      period: periodOf(filters, window),
    });
    expect(byDay).toContain("2026-07-01: 40 (n=40)");
    expect(byDay).toContain(
      "Period: 2026-07-01 to 2026-07-31, 31 days. In all: 62, 2.0 per day over 31 days. To compare periods of different lengths, compare the per-day rates",
    );
    expect(count("2026-07-01", "2026-08-01", 144)).not.toContain("In all:"); // by topic: each row has its own rate
  });

  it("rates a week row over its own days, so a partial week is not read as a drop", () => {
    const t = aggregateForModel({
      metric: "conversations",
      groupBy: "week",
      filters: { since: "2026-09-09" },
      rows: [{ key: "2026-09-07", value: 50, n: 50 }],
      sql: "",
      params: [],
      period: periodOf({ since: "2026-09-09" }, window),
    });
    expect(t).toContain("2026-09-07: 50, 10.0 per day over 5 days (n=50)");
  });

  it("leaves a mood or a share without a rate, and tells the model counts carry nothing to cite", () => {
    const t = aggregateForModel({
      metric: "avg_sentiment",
      groupBy: "none",
      filters: {},
      rows: [{ key: "all", value: 0.4, n: 9 }],
      sql: "",
      params: [],
      period: periodOf({}, window),
    });
    expect(t).toContain("all: 40/100 (n=9)");
    expect(t).not.toContain("per day");
    expect(t).toContain(COUNTS_ONLY);
    expect(COUNTS_ONLY).toMatch(
      /Anything the answer says about what people wrote \(examples, thread names, causes, quotes\) must come from scan or find results and be cited/,
    );
  });
});

// Review 2026-09-26, why the per-day path missed the September rate: only the aggregate carried its days; a read
// (scan) said "271 relevant" for 1-24 September with no days, and the answer divided by 30. A read now says its own.
describe("a read and the days it covers", () => {
  const window = { from: "2026-06-18", to: "2026-09-24" };
  const read = (
    filters: { since?: string; until?: string },
    relevant: number,
    scanned: number,
  ): ScanResult => ({
    status: "ok",
    question: "q",
    filters,
    scanned,
    relevant,
    failed: 0,
    relevantByWeek: [],
    relevantByTopic: [],
    relevantIds: [],
    hits: [],
  });

  it("gives its counts per day over the days the data covers, in the one form the claim check reads", () => {
    const filters = { since: "2026-09-01", until: "2026-10-01" };
    const t = scanForModel({ ...read(filters, 271, 900), period: periodOf(filters, window) }, 2500);
    expect(t).toContain(
      "Period: 2026-09-01 to 2026-09-24, 24 days: 271 relevant, 11.3 per day over 24 days; 900 read, 37.5 per day over 24 days.",
    );
    expect(t).toContain(
      "compare these per-day rates, never the raw counts, and never work out a rate yourself",
    );
  });

  it("says no period when the days are not known", () => {
    expect(scanForModel(read({ since: "2026-09-01" }, 10, 20), 2500)).not.toContain("Period:");
  });
});

describe("a read, as the model reads it (QA 2026-09-26, round 5)", () => {
  const hit = {
    ref: 7,
    channel: "Discussion",
    topic: "updates",
    sentiment: 0.11,
    relevance: 0.9,
    started_at: "2026-09-10T10:00:00Z",
    transcript: "[msg1] a: lag",
  };
  const read = (extra: object = {}): ScanResult => ({
    status: "ok",
    question: "q",
    filters: {},
    scanned: 1232,
    relevant: 1170,
    failed: 0,
    relevantByWeek: [],
    relevantByTopic: [{ key: "cheating-bans", n: 300 }],
    relevantIds: [],
    hits: [hit as never],
    ...extra,
  });

  it("names the relevant count as the denominator of its breakdowns", () => {
    expect(scanForModel(read(), 2500)).toContain(
      'The breakdowns below count the 1170 relevant conversations: a share of them is "X of 1170", never "X of 1232".',
    );
  });
  it("gives the mood of everything read, and no mood per printed conversation", () => {
    const t = scanForModel({ ...read(), sliceMood: 0.38 }, 2500);
    expect(t).toContain(
      "Average mood of all 1232 conversations read: 38/100. Say the mood as this number, for the whole set; never as a range",
    );
    expect(t).not.toContain("11/100");
    expect(conversationsForModel([hit as never])).toBe(
      "## conversation conv7 · Discussion · topic updates · relevance 90% · 2026-09-10\n[msg1] a: lag",
    );
  });
  it("says the topic breakdown overlaps, and lists every topic of a conversation, primary first (D46)", () => {
    expect(scanForModel(read(), 2500)).toContain(
      "By topic, a conversation counts under each topic it touches, so the topic counts can add up to more than 1170.",
    );
    expect(conversationsForModel([{ ...hit, topics: ["updates", "performance"] } as never])).toMatch(
      /^## conversation conv7 · Discussion · topics updates, performance · /,
    );
    expect(conversationsForModel([{ ...hit, topics: ["updates"] } as never])).toMatch(/· topic updates ·/);
  });
  it("carries a note on how the read was made", () => {
    expect(scanForModel({ ...read(), notes: ["This read covered one topic only."] }, 2500)).toContain(
      "\nNote: This read covered one topic only.",
    );
  });
});

describe("failedWords", () => {
  it("tells the model the step is gone and what its first sentence must say", () => {
    expect(failedWords("scan")).toBe(
      'This read did not finish, twice, so nothing from it can be used. Answer from the other results. Your FIRST sentence says what the answer covers, in plain words: "One read didn\'t finish, so this covers only the conversations about <what the other results covered>." If nothing else was read, say that the conversations could not be read this time and suggest asking again.',
    );
    expect(failedWords("aggregate")).toMatch(/^This count did not finish/);
  });
});

// (sanity QA 2026-09-26) "chat failed TypeError: Cannot read properties of undefined (reading 'slice')": a follow-up
// in a chat saved through PUT /api/chats (e2e/seed.ts) replays its find hit through toModelOutput, and that hit carries
// only id, thread_title, relevance and messages. The exact shape that reached for-model.ts:145.
describe("conversationsForModel on a hit saved in an older or slimmer shape", () => {
  const seeded = {
    id: "conv-seed",
    thread_title: "The anti-cheat is useless",
    relevance: 0.9,
    messages: [
      {
        id: "m-seed",
        ref: 990001,
        kind: "post",
        channel: "r/PUBATTLEGROUNDS",
        thread_id: "thread-seed",
        reply_to: null,
        conversation_id: "conv-seed",
        in_window: true,
        author: "someone",
        ts: "2026-09-10T10:00:00Z",
        text: "The anti-cheat is useless this season.",
        reactions: 5,
        removed: false,
        is_bot: false,
      },
    ],
  };

  it("does not throw, and gives the model the message previews it carries so its refs stay citable", () => {
    expect(conversationsForModel([seeded as never])).toBe(
      "## conversation (no handle) · ? · topic ? · relevance 90% · ?\nThe anti-cheat is useless\n[msg990001] someone · 2026-09-10: The anti-cheat is useless this season.",
    );
  });

  it("survives a hit with nothing in it, and no hits at all", () => {
    expect(conversationsForModel([{} as never])).toBe(
      "## conversation (no handle) · ? · topic ? · relevance ? · ?\n",
    );
    expect(conversationsForModel(undefined as never)).toBe("");
  });
});

// D46: by topic a conversation counts under every topic it touches, so an aggregate by topic overlaps.
describe("an aggregate by topic", () => {
  const byTopic = (total?: number) =>
    aggregateForModel({
      metric: "conversations",
      groupBy: "topic",
      filters: {},
      rows: [
        { key: "bugs", value: 60, n: 60 },
        { key: "maps", value: 50, n: 50 },
      ],
      ...(total === undefined ? {} : { total }),
      sql: "",
      params: [],
    });

  it("says its rows overlap, with the slice's real number of conversations", () => {
    expect(byTopic(80)).toContain(
      "these rows overlap and add up to more than the 80 conversations in the slice. Never add them up; shares by topic can add up to more than 100%.",
    );
  });
  it("says nothing of overlap when the rows do not overlap", () => {
    expect(byTopic()).not.toContain("overlap");
  });
});

// His ruling 27 Sep: the conversation is the one unit. A count of messages, people or votes says so, with what it
// cannot give, so an answer to a per-message question says what it counted instead.
describe("counts in the one unit, the conversation", () => {
  const window = { from: "2026-06-18", to: "2026-09-24" };
  const out = (
    metric: AggregateResult["metric"],
    groupBy: AggregateResult["groupBy"],
    rows: { key: string; value: number; n: number }[],
    filters = { since: "2026-07-01", until: "2026-09-25" },
  ) =>
    aggregateForModel({
      metric,
      groupBy,
      filters,
      rows,
      sql: "",
      params: [],
      period: periodOf(filters, window),
    });

  it("says the unit and its limits beside a count of messages, people or engagement, and not beside a count of conversations", () => {
    for (const m of ["messages", "authors", "engagement"] as const) {
      const t = out(m, "none", [{ key: "all", value: 10, n: 2 }]);
      expect(t).toContain("each conversation dated by the day it starts");
      expect(t).toMatch(
        /Counts of single messages by their own time, and one person's own messages or reactions are not available/,
      );
      expect(t).toContain("the answer's first sentence says what was counted instead");
    }
    expect(out("conversations", "none", [{ key: "all", value: 10, n: 10 }])).not.toContain(
      "dated by the day it starts",
    );
  });

  it("names engagement, and gives it per day over the period like any count", () => {
    const t = out("engagement", "none", [{ key: "all", value: 3100, n: 200 }], {
      since: "2026-09-01",
      until: "2026-09-11",
    });
    expect(t).toContain(
      "engagement (distinct authors + replies + reactions, summed over the conversations) by none",
    );
    expect(t).toContain("all: engagement score 3100, 310.0 per day over 10 days (a score, not a count; from 200 conversations)");
    // QA 2026-09-27: "Tides Remastered: 253" was written as "253 conversations".
    expect(t).toContain("An engagement score is never a number of conversations or people");
  });

  it("gives a month row the days of that month inside the period, so a partial month is not read as a whole one", () => {
    const t = out("conversations", "month", [
      { key: "2026-07", value: 3100, n: 3100 },
      { key: "2026-09", value: 2400, n: 2400 },
    ]);
    expect(t).toContain("2026-07: 3100, 100.0 per day over 31 days");
    expect(t).toContain("2026-09: 2400, 100.0 per day over 24 days");
    expect(t).toContain("The first and last periods of the conversations are partial");
  });
});
