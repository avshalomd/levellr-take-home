import { describe, expect, it } from "vitest";
import { REFUSED } from "@/lib/agent/flags";
import {
  activitySummary,
  barFill,
  haltSteps,
  barFull,
  answerLead,
  conversationsRead,
  kindWords,
  questionWords,
  relevantWords,
  aboutWords,
  withoutRefused,
  readWords,
  pickChart,
  rangeWords,
  rowLabel,
  scopeWords,
  seriesCallouts,
  stepsSettled,
  sourceWords,
  stepLines,
  stepsToggleLabel,
  stepWords,
  valueLabel,
} from "./activity-words";

const names = new Map([["performance-access", "Performance & Access"]]);
const RAW = /tool-|scan|aggregate|read_conversation|dataset_overview|performance-access|conv\d|t[13]_|[{}]/;

describe("stepWords", () => {
  it("says how many conversations a finished read covered, and how many bear on the question", () => {
    const w = stepWords(
      {
        type: "tool-scan",
        state: "output-available",
        input: { question: "Does anyone report stutter?", filters: { topic: "performance-access", since: "2026-09-09" } },
        output: { status: "ok", scanned: 240, relevant: 38 },
      },
      names,
    );
    expect(w.text).toBe("Read 240 conversations about Performance & Access, from 9 Sep");
    // "bear on", not "answer": the count is conversations on the question either way (QA 2026-09-26)
    expect(w.detail).toBe("38 of them bear on “Does anyone report stutter?”");
    expect(w.running).toBe(false);
  });

  it("describes a read in progress", () => {
    const w = stepWords({ type: "tool-scan", state: "input-available", input: { question: "Q?" } }, names);
    expect(w).toMatchObject({ text: "Reading conversations", detail: "On “Q?”", running: true });
  });

  // QA 2026-09-26: "Read 118 conversations about Cheating & Bans, complaining, between 9 Sep and 24 Sep".
  it("names a flagged read by its kind of conversation, never by a filter word", () => {
    const w = stepWords(
      {
        type: "tool-scan",
        state: "output-available",
        input: { question: "Do people think the bans work?", about: "the ban waves", filters: { topic: "cheating-bans", flag: "complaint", since: "2026-09-09", until: "2026-09-25" } },
        output: { status: "ok", scanned: 118, relevant: 83 },
      },
      new Map([["cheating-bans", "Cheating & Bans"]]),
    );
    expect(w.text).toBe("Read 118 complaints about Cheating & Bans, from 9 to 24 Sep");
    expect(w.detail).toBe("83 of them were about the ban waves");
    expect(`${w.text} ${w.detail}`).not.toMatch(/complaining|reporting bugs|asking for/);
  });

  it("says what a read was about in the agent's plain words, else a short question, never a question cut off", () => {
    expect(questionWords("Does anyone report stutter or FPS drops after 43.1?", "stutter after 43.1")).toBe("stutter after 43.1");
    expect(questionWords("Does anyone report stutter?")).toBe("“Does anyone report stutter?”");
    expect(questionWords("What changes are people asking for? Group similar requests such as maps and modes.")).toBe("“What changes are people asking for?”");
    const long = "What concrete changes or additions are people asking for most often, grouped by maps, modes, gameplay systems and matchmaking";
    expect(questionWords(long)).toBe("the question");
    expect(questionWords(long, " ")).toBe("the question");
  });

  it("explains a slice that was too big instead of showing a number of nothing", () => {
    const w = stepWords({ type: "tool-scan", state: "output-available", input: {}, output: { status: "too-broad", total: 1240 } });
    expect(w.text).toBe("Found 1,240 conversations");
    expect(w.detail).toMatch(/narrowing/);
  });

  // QA 2026-09-26: 'Searching for "new Rondo map changes update 43.1 Rondo" complaining'.
  it("phrases a search by what it looked for, never by its search string", () => {
    const find = (input: object) => stepWords({ type: "tool-find", state: "output-available", input, output: { hits: [1, 2, 3] } });
    expect(find({ query: "new Rondo map changes update 43.1 Rondo", about: "the Rondo changes", filters: { flag: "complaint" } })).toMatchObject({
      text: "Looked for conversations about the Rondo changes in complaints",
      detail: "Found 3 matching conversations",
    });
    // an older step, saved before the agent said what it looked for
    expect(find({ query: "new Rondo map changes update 43.1 Rondo" }).text).toBe("Looked for conversations");
  });

  // QA 2026-09-26: "Counted the average mood in total. In conversations about…" read as a broken sentence.
  it("phrases a count as one sentence: what, in which conversations, and how it was split", () => {
    const agg = (metric: string, group_by: string, filters: object) => stepWords({ type: "tool-aggregate", state: "output-available", input: { metric, group_by, filters } }, names).text;
    expect(agg("share_complaint", "week", { flag: "bug" })).toBe("Worked out the share of complaints among bug reports, week by week");
    expect(agg("avg_sentiment", "none", { topic: "performance-access", since: "2026-07-01", until: "2026-08-01" })).toBe(
      "Worked out the average mood in conversations about Performance & Access, from 1 to 31 Jul",
    );
    expect(agg("conversations", "week", { flag: "complaint", since: "2026-09-09" })).toBe("Counted complaints from 9 Sep, week by week");
    expect(agg("authors", "topic", {})).toBe("Counted people taking part in conversations, topic by topic");
    expect(stepWords({ type: "tool-aggregate", state: "output-available", input: { metric: "messages", group_by: "none" } }).detail).toBeUndefined();
  });

  it("names a conversation read in full by its title, never its handle", () => {
    const w = stepWords({ type: "tool-read_conversation", state: "output-available", input: { id: "conv123" }, output: { thread_title: "Stutter after 43.1" } });
    expect(w.text).toBe("Read “Stutter after 43.1” in full");
  });

  it("never shows a tool name, a raw topic key, an id or JSON", () => {
    const steps = [
      { type: "tool-dataset_overview", state: "output-available" },
      { type: "tool-scan", state: "input-streaming", input: { filters: { topic: "performance-access" } } },
      { type: "tool-aggregate", state: "input-available", input: { metric: "avg_sentiment", group_by: "topic" } },
      { type: "tool-read_conversation", state: "input-available", input: { id: "conv99" } },
      { type: "tool-find", state: "output-error", input: { query: "x" } },
      { type: "tool-something_new", state: "output-available" },
    ];
    for (const s of steps) {
      const w = stepWords(s, names);
      expect(`${w.text} ${w.detail ?? ""}`).not.toMatch(RAW);
    }
  });

  it("says a failed step calmly", () => {
    // QA 2026-09-26: "This step did not finish; the answer uses the others." read as the machine talking.
    expect(stepWords({ type: "tool-find", state: "output-error", input: { query: "x" } }).detail).toBe("This search didn't finish, so the answer leaves it out");
    expect(stepWords({ type: "tool-scan", state: "output-error", input: { question: "x" } }).detail).toBe("This read didn't finish, so the answer leaves it out");
    expect(stepWords({ type: "tool-aggregate", state: "output-error", input: { metric: "conversations", group_by: "none" } }).detail).toBe("This count didn't finish, so the answer leaves it out");
  });
});

describe("scopeWords", () => {
  it("reads a date range as words", () => {
    // `until` is exclusive: 1 Sep up to (not including) 15 Sep is 1-14 Sep, and a one-day span is "on" that day
    expect(scopeWords({ since: "2026-09-01", until: "2026-09-15" }, names)).toBe(" from 1 to 14 Sep");
    expect(scopeWords({ since: "2026-08-31", until: "2026-09-07" }, names)).toBe(" from 31 Aug to 6 Sep");
    expect(scopeWords({ since: "2026-08-31", until: "2026-09-01" }, names)).toBe(" on 31 Aug");
    expect(scopeWords({ since: "2026-09-01T00:00:00Z", until: "2026-09-08T00:00:00Z" }, names)).toBe(" from 1 to 7 Sep");
  });
  it("says a flag as the kind of conversation, with its topic", () => {
    expect(scopeWords({ flag: "bug", topic: "performance-access", channel: "Discussion" }, names)).toBe(" in bug reports about Performance & Access, in Discussion");
    expect(kindWords("help", 1)).toBe("request for help");
    expect(kindWords(undefined)).toBe("conversations");
    expect(kindWords("unknown-flag")).toBe("conversations");
  });
  it("falls back to a readable topic when the key has no name", () => {
    expect(scopeWords({ topic: "maps-modes" }, names)).toBe(" about maps modes");
  });
});

describe("rowLabel and valueLabel", () => {
  it("turns keys and values into what a reader expects", () => {
    expect(rowLabel("performance-access", "topic", names)).toBe("Performance & Access");
    expect(rowLabel("2026-09-07", "week", names)).toBe("7–13 Sep");
    expect(rowLabel("2026-09-08", "day", names)).toBe("8 Sep");
    expect(rowLabel("2026-09", "month", names)).toBe("September 2026");
    expect(valueLabel("net_votes", 178501)).toBe("178,501");
    expect(valueLabel("share_bug", 0.237)).toBe("24%");
    expect(valueLabel("avg_sentiment", 0.41)).toBe("41 / 100");
    expect(valueLabel("conversations", 1240)).toBe("1,240");
  });
});

describe("activitySummary", () => {
  const scan = (scanned: number, filters = {}) => ({ type: "tool-scan", state: "output-available", input: { filters }, output: { status: "ok", scanned, relevant: 3, filters } });
  it("folds every finished step into one line", () => {
    const steps = [
      { type: "tool-dataset_overview", state: "output-available" },
      scan(600, { channel: "Discussion" }),
      scan(240, { channel: "Bug Report" }),
      { type: "tool-find", state: "output-available", input: { query: "stutter" }, output: { hits: [] } },
      { type: "tool-find", state: "output-available", input: { query: "lag" }, output: { hits: [] } },
      { type: "tool-aggregate", state: "output-available", output: { rows: [] } },
      { type: "tool-read_conversation", state: "output-available", output: { thread_title: "x" } },
    ];
    expect(activitySummary(steps)).toEqual({ text: "Read 840 conversations, opened 1 conversation in full, searched twice and counted conversations", running: false });
  });
  it("shows the step that is running while the agent works", () => {
    const steps = [scan(10), { type: "tool-scan", state: "input-available", input: { question: "Q?" } }];
    expect(activitySummary(steps)).toEqual({ text: "Reading conversations", running: true });
  });
  // QA 2026-09-25: 118 conversations read with two questions said "Read 236". QA 2026-09-26: "Read at least 118" over
  // two steps that each said 118.
  // QA 2026-09-26: "12 of them bear on version 42.3 reaction" read like a machine's label.
  it("says what a read's conversations were about in plain words, without the lean the agent asked about", () => {
    expect(relevantWords(12, "How did people react to 42.3?", "the 42.3 update")).toBe("12 of them were about the 42.3 update");
    expect(relevantWords(12, "q", "version 42.3 reaction")).toBe("12 of them were about version 42.3");
    expect(relevantWords(1, "q", "reactions to the 42.3 update")).toBe("1 of them was about the 42.3 update");
    expect(relevantWords(0, "q", "the ban waves")).toBe("None of them were about the ban waves");
    expect(relevantWords(38, "Does anyone report stutter?")).toBe("38 of them bear on “Does anyone report stutter?”");
    expect(aboutWords("reaction")).toBe("reaction"); // nothing left once the lean goes: the words stay as given
    expect(questionWords("q", "version 42.3 reaction")).toBe("version 42.3");
  });

  it("says a slice read for two questions is the same conversations read twice", () => {
    const slice = { flag: "complaint", since: "2026-09-09" };
    const ask = (question: string) => ({ ...scan(118, slice), input: { question } });
    expect(activitySummary([ask("Is the anti-cheat working?"), ask("Who do they blame?")]).text).toBe("Read the same 118 complaints twice, for two questions");
    // the same question over the same slice is one line in the list, so one read in the summary (review 2026-09-26)
    expect(activitySummary([ask("Q?"), ask("Q?")]).text).toBe("Read 118 complaints");
    expect(activitySummary([scan(118, slice)]).text).toBe("Read 118 complaints");
  });
  it("never says 'at least': reads that may share conversations are said as sets that may overlap", () => {
    const text = activitySummary([
      { ...scan(118, { flag: "complaint" }), input: { question: "Q1?" } },
      { ...scan(90, { topic: "maps-modes" }), input: { question: "Q2?" } },
    ]).text;
    // QA 2026-09-26: "Read two sets of conversations, 25 and 224, that may overlap" read awkwardly. Never their sum:
    // a conversation in both would be counted twice.
    expect(text).toBe("Read 118 and 90 conversations in two passes");
    expect(text).not.toMatch(/at least|208/);
  });
  // QA 2026-09-26, round 5: "Read 1,232 complaints and counted once" left the reader asking what was counted.
  it("says what was counted, never 'counted once'", () => {
    const agg = { type: "tool-aggregate", state: "output-available", output: { rows: [] } };
    const counting = (metric: string, group_by: string, filters = {}) => ({ ...agg, input: { metric, group_by, filters } });
    expect(activitySummary([agg]).text).toBe("Counted conversations");
    expect(activitySummary([scan(1232, { flag: "complaint" }), counting("conversations", "topic", { flag: "complaint" })]).text).toBe(
      "Read 1,232 complaints and counted complaints by topic",
    );
    expect(activitySummary(Array.from({ length: 18 }, (_, i) => counting("conversations", "week", { topic: `t${i}` }))).text).toBe("Counted conversations by week 18 times");
    expect(activitySummary([counting("avg_sentiment", "week"), counting("conversations", "none")]).text).toBe("Worked out the average mood by week and counted conversations");
    expect(activitySummary([counting("avg_sentiment", "week"), counting("conversations", "none"), counting("share_complaint", "topic")]).text).toBe("Made three counts");
  });
  // QA 2026-09-26, production: the headline said "and one step didn't finish". It says only what succeeded; the step
  // that did not finish keeps its own line in the expanded list, flagged `failed`.
  it("keeps a step that did not finish out of the headline, and flags it in the list", () => {
    const failed = { type: "tool-scan", state: "output-error", input: { question: "Q?", filters: { topic: "maps-modes" } }, toolCallId: "f" };
    const ok = { ...scan(207, { topic: "updates-feedback" }), toolCallId: "s" };
    expect(activitySummary([ok, failed]).text).toBe("Read 207 conversations");
    const lines = stepLines([ok, failed]);
    expect(lines.map((l) => [l.id, l.failed])).toEqual([["s", false], ["f", true]]);
    expect(lines[1].words.detail).toBe("This read didn't finish, so the answer leaves it out");
  });
  it("still says so when nothing succeeded", () => {
    const failed = { type: "tool-scan", state: "output-error", input: { question: "Q?" } };
    expect(activitySummary([failed]).text).toBe("One step did not finish");
  });
  // QA 2026-09-26, round 5: a count whose input was still arriving read "Working out conversations in conversations".
  it("never garbles a count whose metric is not known yet", () => {
    expect(stepWords({ type: "tool-aggregate", state: "input-streaming", input: {} }).text).toBe("Counting conversations");
    expect(stepWords({ type: "tool-aggregate", state: "input-streaming", input: { metric: "avg_sent" } }).text).toBe("Counting conversations");
    expect(stepWords({ type: "tool-aggregate", state: "input-available", input: { metric: "avg_sentiment", group_by: "week" } }).text).toBe("Working out the average mood in conversations, week by week");
    for (const metric of ["conversations", "messages", "authors", "avg_sentiment", "share_negative", "share_bug", "share_feature", "share_complaint", "share_help"])
      for (const state of ["input-streaming", "output-available"])
        expect(stepWords({ type: "tool-aggregate", state, input: { metric, group_by: "none" } }).text).not.toMatch(/(\b\w+\b) in \1\b|conversations in conversations/);
  });
  it("never shows the off-topic reply's call as a step", () => {
    const off = { type: "tool-out_of_scope", state: "output-available", toolCallId: "o1", input: {}, output: { status: "off-topic", text: "t" } };
    expect(withoutRefused([off])).toEqual([]);
    expect(stepLines([off])).toEqual([]);
  });
  // QA 2026-09-26: "Looked at what the data covers" over a turn of several steps named only the first.
  it("says every step when nothing was read, searched or counted", () => {
    const overview = { type: "tool-dataset_overview", state: "output-available" };
    const broad = { type: "tool-scan", state: "output-available", output: { status: "too-broad", total: 9000 } };
    const failed = { type: "tool-find", state: "output-error" };
    expect(activitySummary([overview, broad]).text).toBe("Looked at what the data covers and found no set of conversations small enough to read");
    expect(activitySummary([overview, broad, { ...broad, input: { question: "Q?", filters: { topic: "maps-modes" } } }, failed]).text).toBe(
      "Looked at what the data covers, tried two sets of conversations, none small enough to read and one step did not finish",
    );
  });
  it("says something true when only the overview ran, and counts a too-broad read as nothing read", () => {
    expect(activitySummary([{ type: "tool-dataset_overview", state: "output-available" }]).text).toBe("Looked at what the data covers");
    const broad = { type: "tool-scan", state: "output-available", output: { status: "too-broad", total: 9000 } };
    expect(activitySummary([broad, { type: "tool-find", state: "output-available" }]).text).toBe("Searched once");
  });
});

describe("conversationsRead", () => {
  const r = (scanned: number, filters: Record<string, string> = {}) => ({ filters, scanned });
  it("adds nothing for a slice inside another, and adds up slices that cannot overlap", () => {
    // complaints about one topic sit inside that topic; two channels or two date spans share nothing
    expect(conversationsRead([r(300, { topic: "maps-modes" }), r(40, { topic: "maps-modes", flag: "complaint" })])).toMatchObject({ n: 300, exact: true });
    expect(conversationsRead([r(300, { channel: "Discussion" }), r(200, { channel: "Bug Report" })])).toMatchObject({ n: 500, exact: true });
    expect(conversationsRead([r(60, { since: "2026-07-01", until: "2026-08-01" }), r(80, { since: "2026-09-01" })])).toMatchObject({ n: 140, exact: true });
    expect(conversationsRead([r(80, { since: "2026-09-01", until: "2026-09-15" }), r(70, { since: "2026-09-09" })])).toEqual({ n: 80, exact: false, sets: [80, 70] });
  });
  it("reads a slice with the same dates written two ways as one slice", () => {
    expect(conversationsRead([r(118, { since: "2026-09-09" }), r(118, { since: "2026-09-09T00:00:00Z" })])).toMatchObject({ n: 118, exact: true });
    expect(readWords([{ ...r(118, { since: "2026-09-09" }), question: "a" }, { ...r(118, { since: "2026-09-09T00:00:00Z" }), question: "b" }])).toBe(
      "read the same 118 conversations twice, for two questions",
    );
  });
  it("is nothing when nothing was read", () => {
    expect(conversationsRead([])).toEqual({ n: 0, exact: true, sets: [] });
    expect(readWords([])).toBeNull();
  });
  it("gives the total when the reads nest or cannot overlap", () => {
    expect(readWords([{ ...r(300, { channel: "Discussion" }), question: "a" }, { ...r(200, { channel: "Bug Report" }), question: "b" }])).toBe("read 500 conversations");
  });
  // D46: a conversation can touch several topics, so two topics' reads may share conversations and are never added up.
  it("never adds up two topics' reads: they may share conversations", () => {
    expect(conversationsRead([r(300, { topic: "maps-modes" }), r(200, { topic: "performance-access" })])).toEqual({ n: 300, exact: false, sets: [300, 200] });
  });
});

describe("the steps button", () => {
  it("is named for what it does and what it shows", () => {
    expect(stepsToggleLabel(false, "Read 118 conversations and searched twice", 4)).toBe("Show the 4 steps: Read 118 conversations and searched twice");
    expect(stepsToggleLabel(true, "Looked at what the data covers", 1)).toBe("Hide the step: Looked at what the data covers");
  });
});

describe("stepsSettled", () => {
  it("is true only once the answer's text has begun after the last step", () => {
    const tool = { type: "tool-scan" };
    expect(stepsSettled([{ type: "step-start" }, tool])).toBe(false);
    expect(stepsSettled([{ type: "text", text: "Let me look." }, tool, { type: "step-start" }])).toBe(false);
    expect(stepsSettled([tool, { type: "step-start" }, { type: "text", text: " " }])).toBe(false);
    expect(stepsSettled([tool, { type: "step-start" }, { type: "text", text: "Most complaints are" }])).toBe(true);
    expect(stepsSettled([{ type: "text", text: "No tools were needed." }])).toBe(true);
  });
});

describe("rangeWords", () => {
  it("says a span of days the short way", () => {
    expect(rangeWords("2026-09-09", "2026-09-13")).toBe("9–13 Sep");
    expect(rangeWords("2026-08-31", "2026-09-06")).toBe("31 Aug–6 Sep");
    expect(rangeWords("2026-09-24", "2026-09-24")).toBe("24 Sep");
  });
});

describe("pickChart", () => {
  const agg = (id: string, rows: { key: string; value: number }[], extra: object = {}) => ({
    type: "tool-aggregate",
    state: "output-available",
    toolCallId: id,
    input: { metric: "share_complaint", group_by: "week", filters: { topic: "performance-access" } },
    output: { metric: "share_complaint", groupBy: "week", rows: rows.map((r) => ({ ...r, n: 1 })) },
    ...extra,
  });
  const weeks = [
    { key: "2026-09-01", value: 0.2 },
    { key: "2026-09-08", value: 0.4 },
  ];
  it("draws the last count that has something to compare, titled in words", () => {
    const c = pickChart([agg("a", weeks), agg("b", [{ key: "all", value: 0.3 }])], names);
    expect(c).toMatchObject({ id: "a", title: "The share of complaints by week, about Performance & Access", metric: "share_complaint" });
    expect(c!.rows).toEqual(weeks);
  });
  // QA 2026-09-26: a read's week-by-week tally under a yes/no question ("Do players express approval of the
  // anti-cheat…?") read as the people who approve, beside an answer saying most hate it. A read is never drawn.
  it("never draws a read's tally, and draws nothing for a single number", () => {
    const s = {
      type: "tool-scan",
      state: "output-available",
      toolCallId: "s",
      input: { question: "Do players express approval of anti-cheat enforcement?", filters: {} },
      output: { status: "ok", relevantByWeek: [{ key: "2026-09-01", n: 22 }, { key: "2026-09-08", n: 36 }, { key: "2026-09-15", n: 30 }] },
    };
    expect(pickChart([s])).toBeNull();
    expect(pickChart([s, agg("b", [{ key: "all", value: 0.3 }])])).toBeNull();
    expect(pickChart([agg("a", weeks), s])).toMatchObject({ id: "a" });
  });
  it("labels week rows with the days they hold, so the rows agree with the dates in the title", () => {
    // QA: "between 9 Sep and 24 Sep" (now "from 9 to 24 Sep") over a first row "7 Sep" - the database keys a week by its Monday
    const span = { since: "2026-09-09", until: "2026-09-25" };
    const rows = [{ key: "2026-09-07", value: 25 }, { key: "2026-09-14", value: 46 }, { key: "2026-09-21", value: 38 }];
    const c = pickChart([
      { type: "tool-aggregate", state: "output-available", toolCallId: "a", input: { metric: "conversations", group_by: "week", filters: span }, output: { metric: "conversations", groupBy: "week", filters: span, rows: rows.map((r) => ({ ...r, n: r.value })) } },
    ])!;
    expect(c.title).toBe("Conversations by week, from 9 to 24 Sep");
    expect(c.rows.map((r) => rowLabel(r.key, c.groupBy, names, c.span))).toEqual(["9–13 Sep", "14–20 Sep", "21–24 Sep"]);
  });
  it("ignores a count that is still running", () => {
    expect(pickChart([agg("a", weeks, { state: "input-available" })])).toBeNull();
  });
});

describe("pickChart for a comparison of periods", () => {
  // QA: "How did the mood about maps and modes in July compare with September?" charted September only
  const mood = (id: string, since: string, until: string, rows: { key: string; value: number; n: number }[], group = "week", topic = "maps-modes") => ({
    type: "tool-aggregate",
    state: "output-available",
    toolCallId: id,
    input: { metric: "avg_sentiment", group_by: group, filters: { topic, since, until } },
    output: { metric: "avg_sentiment", groupBy: group, filters: { topic, since, until }, rows },
  });
  const july = mood("jul", "2026-07-01", "2026-08-01", [{ key: "all", value: 0.4, n: 50 }], "none");
  const sep = mood("sep", "2026-09-01", "2026-09-25", [
    { key: "2026-08-31", value: 0.3, n: 10 },
    { key: "2026-09-07", value: 0.36, n: 30 },
  ]);
  const topics = new Map([["maps-modes", "Maps & Modes"]]);

  it("draws both periods side by side, in time order, whatever order they were counted in", () => {
    const c = pickChart([sep, july], topics)!;
    expect(c).toMatchObject({ id: "jul", title: "The average mood by period, about Maps & Modes", groupBy: "period", metric: "avg_sentiment" });
    expect(c.rows.map((r) => r.key)).toEqual(["1–31 Jul", "1–24 Sep"]);
    expect(c.rows[0].value).toBe(0.4);
    // a mood is a mean over conversations: September's weeks weigh by how many conversations each holds
    expect(c.rows[1].value).toBeCloseTo((0.3 * 10 + 0.36 * 30) / 40);
  });
  it("adds counts of conversations across a period's weeks", () => {
    const n = (id: string, since: string, until: string, rows: { key: string; value: number }[]) => ({
      type: "tool-aggregate",
      state: "output-available",
      toolCallId: id,
      input: { metric: "conversations", group_by: "week", filters: { since, until } },
      output: { metric: "conversations", groupBy: "week", filters: { since, until }, rows: rows.map((r) => ({ ...r, n: r.value })) },
    });
    const c = pickChart([n("a", "2026-07-01", "2026-08-01", [{ key: "2026-06-29", value: 20 }, { key: "2026-07-06", value: 30 }]), n("b", "2026-09-01", "2026-09-08", [{ key: "2026-08-31", value: 12 }, { key: "2026-09-07", value: 1 }])])!;
    expect(c.rows).toEqual([{ key: "1–31 Jul", value: 50 }, { key: "1–7 Sep", value: 13 }]);
  });
  // QA 2026-09-26, round 5: July's 144 against 1-24 September's 109 drew as a fall when per day it was flat.
  it("draws periods of different lengths per day, from the days the tool stamped on each count", () => {
    const total = (id: string, since: string, until: string, value: number, days: number) => ({
      type: "tool-aggregate",
      state: "output-available",
      toolCallId: id,
      input: { metric: "conversations", group_by: "none", filters: { topic: "cosmetics-store", since, until } },
      output: { metric: "conversations", groupBy: "none", filters: { topic: "cosmetics-store", since, until }, rows: [{ key: "all", value, n: value }], period: { since, until, days } },
    });
    const c = pickChart([total("jul", "2026-07-01", "2026-08-01", 144, 31), total("sep", "2026-09-01", "2026-09-25", 109, 24)], new Map([["cosmetics-store", "Cosmetics & Store"]]))!;
    expect(c).toMatchObject({ title: "Conversations per day by period, about Cosmetics & Store", metric: "conversations_per_day" });
    expect(c.rows.map((r) => [r.key, valueLabel(c.metric, r.value)])).toEqual([["1–31 Jul", "4.6 per day"], ["1–24 Sep", "4.5 per day"]]);
    // periods of the same length stay as counts
    const even = pickChart([total("a", "2026-07-01", "2026-07-11", 30, 10), total("b", "2026-09-01", "2026-09-11", 20, 10)])!;
    expect(even).toMatchObject({ metric: "conversations" });
    expect(even.rows.map((r) => r.value)).toEqual([30, 20]);
  });
  it("compares only the same count of the same slice over separate dates", () => {
    const other = mood("other", "2026-07-01", "2026-08-01", [{ key: "all", value: 0.4, n: 50 }], "none", "performance-access");
    expect(pickChart([other, sep], topics)).toMatchObject({ id: "sep", groupBy: "week" });
    const overlapping = mood("over", "2026-09-10", "2026-09-20", [{ key: "all", value: 0.4, n: 5 }], "none");
    expect(pickChart([sep, overlapping], topics)).toMatchObject({ id: "sep", groupBy: "week" });
  });
  // Review 2026-09-26: a total "before 9 Sep" beside a weekly series "from 9 Sep" became two bars, an 83-day total
  // against a 16-day one, and the trend the turn had counted was gone.
  it("keeps a week-by-week series when the other count is only its background", () => {
    const n = (id: string, group: string, f: { since?: string; until?: string }, rows: { key: string; value: number }[]) => ({
      type: "tool-aggregate",
      state: "output-available",
      toolCallId: id,
      input: { metric: "conversations", group_by: group, filters: f },
      output: { metric: "conversations", groupBy: group, filters: f, rows: rows.map((r) => ({ ...r, n: r.value })) },
    });
    const before = n("before", "none", { until: "2026-09-09" }, [{ key: "all", value: 3000 }]);
    const weekly = n("weekly", "week", { since: "2026-09-09" }, [
      { key: "2026-09-07", value: 100 },
      { key: "2026-09-14", value: 300 },
      { key: "2026-09-21", value: 200 },
    ]);
    expect(pickChart([before, weekly])).toMatchObject({ id: "weekly", groupBy: "week" });
  });
  it("does not add up a count cut short by the row cap", () => {
    const days = Array.from({ length: 60 }, (_, i) => ({ key: `2026-07-${String((i % 28) + 1).padStart(2, "0")}`, value: 1, n: 1 }));
    const cut = mood("cut", "2026-06-01", "2026-08-31", days, "day");
    const late = mood("late", "2026-09-01", "2026-09-25", [{ key: "2026-09-01", value: 0.3, n: 3 }, { key: "2026-09-02", value: 0.3, n: 3 }], "day");
    expect(pickChart([cut, late], topics)).toMatchObject({ id: "late", groupBy: "day" });
  });
});

describe("seriesCallouts", () => {
  it("names the highest point and the last one, with their values", () => {
    const chart = { id: "a", title: "", metric: "share_bug", groupBy: "week", rows: [{ key: "2026-08-31", value: 0.1 }, { key: "2026-09-07", value: 0.34 }, { key: "2026-09-14", value: 0.2 }] };
    expect(seriesCallouts(chart)).toEqual({ peak: "34% (7–13 Sep)", latest: "20% (14–20 Sep)" });
    expect(seriesCallouts({ ...chart, span: { until: "2026-09-18" } }).latest).toBe("20% (14–17 Sep)");
  });
});

describe("who is talking", () => {
  const v = (rows: { author: string; messages: number }[], filters = {}) => ({ type: "tool-voices", state: "output-available", toolCallId: "v", input: { filters }, output: { rows } });
  it("says whose voices a step found, by name", () => {
    const w = stepWords(v([{ author: "Deep-Pen420", messages: 9 }, { author: "alwaysHK", messages: 5 }], { topic: "performance-access" }), names);
    expect(w).toMatchObject({ text: "Looked at who is talking about Performance & Access", detail: "Most active: Deep-Pen420 and alwaysHK" });
  });
  it("draws them as the chart when they are the last count", () => {
    const c = pickChart([v([{ author: "a", messages: 9 }, { author: "b", messages: 5 }])]);
    expect(c).toMatchObject({ title: "Most active people, by messages written", rows: [{ key: "a", value: 9 }, { key: "b", value: 5 }], groupBy: "author" });
    expect(activitySummary([v([])]).text).toBe("Looked at who is talking");
  });
  it("reads an author filter as words", () => {
    expect(scopeWords({ author: "alwaysHK" }, names)).toBe(" with alwaysHK in them");
  });
});

// QA 2026-09-26: mood bars were scaled to the largest value, so 38/100 and 37/100 both drew nearly full.
describe("bar scaling", () => {
  it("draws a mood or a share against its whole scale", () => {
    expect(barFull("avg_sentiment", [0.38, 0.37])).toBe(1);
    expect(barFill(0.38, barFull("avg_sentiment", [0.38, 0.37]))).toBeCloseTo(0.38);
    expect(barFull("share_complaint", [0.12, 0.3])).toBe(1);
  });
  it("draws a count against its largest value", () => {
    expect(barFull("conversations", [22, 36, 30])).toBe(36);
    expect(barFill(18, 36)).toBe(0.5);
    expect(barFull("messages", [0, 0])).toBe(1); // nothing to draw, never a division by zero
  });
  it("keeps a fill inside the bar", () => {
    expect(barFill(-3, 10)).toBe(0);
    expect(barFill(12, 10)).toBe(1);
  });
});

// QA 2026-09-26: "Counted the average mood. In conversations between 1 Jul and 31 Jul" three times over.
describe("stepLines", () => {
  const count = (id: string, group_by: string, state = "output-available") => ({
    type: "tool-aggregate",
    state,
    toolCallId: id,
    input: { metric: "avg_sentiment", group_by, filters: { since: "2026-07-01", until: "2026-08-01" } },
  });
  it("says a count's grouping, a total included, so different counts read differently", () => {
    expect(stepLines([count("a", "week"), count("b", "none")]).map((l) => l.words.text)).toEqual([
      "Worked out the average mood in conversations from 1 to 31 Jul, week by week",
      "Worked out the average mood in conversations from 1 to 31 Jul",
    ]);
  });
  // QA 2026-09-26: "Ran 5 times" told the reader nothing: a repeat folds silently.
  it("shows a step repeated word for word once, at its first place, saying nothing of the repeats", () => {
    const lines = stepLines([count("a", "none"), count("b", "week"), count("c", "none"), count("d", "none")]);
    expect(lines.map((l) => l.id)).toEqual(["a", "b"]);
    expect(lines[0].tool).toBe("aggregate");
    expect(JSON.stringify(lines)).not.toMatch(/Ran |times|twice/);
  });
  // Review 2026-09-26: folded by their words, two different scans with the same first sentence read as "Ran twice".
  it("never folds two different calls that read the same", () => {
    const scan = (id: string, question: string) => ({ type: "tool-scan", state: "output-available", toolCallId: id, input: { question } });
    expect(stepLines([scan("a", "Do they like it? Mostly the maps."), scan("b", "Do they like it? Mostly the guns.")])).toHaveLength(2);
  });
  it("never folds a step that is still running or did not finish", () => {
    expect(stepLines([count("a", "none"), count("b", "none", "input-available"), count("c", "none", "output-error")])).toHaveLength(3);
  });
});

// QA 2026-09-26: the tools refuse a call narrowed to a kind of conversation the question never named. It read
// nothing, so it is not a step: shown, it said "did not finish" beside the read made again without the flag.
describe("withoutRefused", () => {
  const read = { type: "tool-scan", state: "output-available", toolCallId: "b", input: { question: "Reaction?" }, output: { status: "ok", scanned: 224, relevant: 80 } };
  // Review 2026-09-26: the tools return a refusal as a result. Thrown, it reached the browser as the SDK's "An error
  // occurred." and every refused call read as a step that did not finish.
  const refused = {
    type: "tool-scan",
    state: "output-available",
    toolCallId: "a",
    input: { question: "Reaction?", filters: { flag: "complaint" } },
    output: { status: "refused", flag: "complaint", words: `${REFUSED} the question does not ask about complaints.` },
  };
  const failed = { type: "tool-scan", state: "output-error", toolCallId: "c", input: { question: "Reaction?" }, errorText: "Something went wrong while answering. Try again." };
  it("leaves out a refused call and keeps one that failed", () => {
    expect(withoutRefused([refused, read, failed]).map((s) => s.toolCallId)).toEqual(["b", "c"]);
    expect(activitySummary(withoutRefused([refused, read])).text).toBe("Read 224 conversations");
  });
  it("never counts a refused call as a step, in the summary or the list, even unfiltered", () => {
    expect(activitySummary([refused, read]).text).toBe("Read 224 conversations");
    expect(stepLines([refused, read]).map((l) => l.id)).toEqual(["b"]);
    expect(activitySummary([refused, { ...refused, toolCallId: "z", input: { question: "Other?", filters: { flag: "bug" } } }]).text).not.toMatch(/did not finish/);
  });
});

// QA 2026-09-26: a stopped chat, reopened, said "Reading conversations about Cheating & Bans…" with a breathing dot.
describe("haltSteps", () => {
  const read = { type: "tool-scan", state: "input-available", input: { question: "Q?", filters: { topic: "performance-access" } } };
  const looked = { type: "tool-dataset_overview", state: "output-available" };
  it("leaves the steps of an answer still being written as they are", () => {
    expect(haltSteps([looked, read], true)).toEqual([looked, read]);
  });
  it("reads a step cut off by a Stop as stopped, never as running", () => {
    const [, cut] = haltSteps([looked, read], false);
    expect(stepWords(cut, names)).toMatchObject({ running: false, failed: true, detail: "Stopped before this step finished" });
    expect(activitySummary(haltSteps([looked, read], false), names)).toEqual({ text: "Looked at what the data covers and stopped before the next step finished", running: false });
    expect(activitySummary(haltSteps([read], false), names).text).toBe("Stopped before the first step finished");
  });
});

// QA 2026-09-26: "118 read (83 relevant)" then "118 read again (88 relevant)" looked like one step shown twice.
describe("a slice read again for another question", () => {
  const read = (id: string, question: string, relevant: number, filters: object = { flag: "complaint", since: "2026-09-09" }) => ({
    type: "tool-scan",
    state: "output-available",
    toolCallId: id,
    input: { question, filters },
    output: { status: "ok", scanned: 118, relevant, filters },
  });
  it("says it is the same conversations again, and keeps what this read found", () => {
    const lines = stepLines([read("a", "Are the bans working?", 83), read("b", "Who do they blame?", 88)]);
    expect(lines.map((l) => l.words.text)).toEqual(["Read 118 complaints from 9 Sep", "Read the same 118 complaints again, for another question"]);
    expect(lines[1].words.detail).toBe("88 of them bear on “Who do they blame?”");
  });
  // Review 2026-09-26: the same question again (a different `top`) is not "another question".
  it("folds the same question over the same slice into one line", () => {
    const again = { ...read("b", "Are the bans working?", 83), input: { question: "Are the bans working?", filters: { flag: "complaint", since: "2026-09-09" }, top: 15 } };
    const lines = stepLines([read("a", "Are the bans working?", 83), again]);
    expect(lines).toHaveLength(1);
  });
  // Review 2026-09-26: with "Ran N times" gone the list folds repeats silently, and the summary counted every call:
  // "Counted 3 times" beside "1 step", "Read the same 118 complaints twice" over one line.
  it("gives the summary the steps the list shows", () => {
    const agg = (id: string) => ({ type: "tool-aggregate", state: "output-available", toolCallId: id, input: { metric: "conversations", group_by: "none" }, output: { rows: [] } });
    const repeats = [agg("a"), agg("b"), agg("c")];
    expect(stepLines(repeats)).toHaveLength(1);
    expect(activitySummary(repeats).text).toBe("Counted conversations");
    const twins = [read("a", "Are the bans working?", 83), { ...read("b", "Are the bans working?", 83), input: { question: "Are the bans working?", filters: { flag: "complaint", since: "2026-09-09" }, top: 15 } }];
    expect(stepLines(twins)).toHaveLength(1);
    expect(activitySummary(twins).text).toBe("Read 118 complaints");
    // two questions over one slice are two lines, and the summary says the same conversations twice
    const two = [read("a", "Are the bans working?", 83), read("b", "Who do they blame?", 88)];
    expect(stepLines(two)).toHaveLength(2);
    expect(activitySummary(two).text).toBe("Read the same 118 complaints twice, for two questions");
  });
  it("reads a different slice as its own", () => {
    const lines = stepLines([read("a", "Q1?", 83), read("b", "Q2?", 40, { topic: "maps-modes" })]);
    expect(lines[1].words.text).toBe("Read 118 conversations about maps modes");
  });
});

// QA 2026-09-26: the glyph's tooltip said "Counted from the labelled conversations, above".
describe("sourceWords", () => {
  it("says where a number comes from in plain words, as what the button does", () => {
    expect(sourceWords("aggregate")).toBe("Show where this number comes from: counting the conversations");
    expect(sourceWords("scan")).toBe("Show where this number comes from: reading the conversations");
    expect(sourceWords("voices")).toBe("Show where this number comes from: counting who is talking");
    for (const t of ["aggregate", "scan", "voices", "find"]) expect(sourceWords(t)).not.toMatch(/labelled|above|while reading/);
  });
});

describe("what the reader was told", () => {
  it("takes the answer's first sentence after the last step, and waits while it is being written", () => {
    const tool = { type: "tool-scan" };
    expect(answerLead([{ type: "text", text: "Let me look at complaints." }, tool, { type: "text", text: "Among the complaints, most are angry. Some" }], false)).toBe(
      "Among the complaints, most are angry.",
    );
    expect(answerLead([tool, { type: "text", text: "Among the complaints, most" }], false)).toBeNull();
    expect(answerLead([tool, { type: "text", text: "Most are angry [msg1].\n\n- One" }], false)).toBe("Most are angry [msg1].");
    expect(answerLead([tool, { type: "text", text: "Most are angry" }], true)).toBe("Most are angry");
    expect(answerLead([tool], true)).toBe("");
  });
  // Review 2026-09-26: a heading or a bold label on its own line is not the first sentence.
  it("passes over a heading or a bold label alone on its line", () => {
    const tool = { type: "tool-scan" };
    expect(answerLead([tool, { type: "text", text: "## Summary\n\nMost complaints are about bans. More" }], false)).toBe("Most complaints are about bans.");
    expect(answerLead([tool, { type: "text", text: "**Short answer:**\nMost are angry." }], true)).toBe("Most are angry.");
    expect(answerLead([tool, { type: "text", text: "## Summary\n" }], false)).toBeNull();
    expect(answerLead([tool, { type: "text", text: "**Bans** are the main complaint." }], true)).toBe("**Bans** are the main complaint.");
  });
});

// QA 2026-09-26: an answer about complaints charted the requests for help; "who is most active in discussions
// about lag" charted only the people reporting bugs.
describe("pickChart draws only a slice the reader was told about", () => {
  const moodBy = (id: string, flag: string | undefined, since: string, until: string) => {
    const filters = { flag, since, until };
    return {
      type: "tool-aggregate",
      state: "output-available",
      toolCallId: id,
      input: { metric: "avg_sentiment", group_by: "none", filters },
      output: { metric: "avg_sentiment", groupBy: "none", filters, rows: [{ key: "all", value: 0.3, n: 20 }] },
    };
  };
  const julyComplaints = moodBy("jc", "bug", "2026-07-01", "2026-08-01");
  const sepComplaints = moodBy("sc", "bug", "2026-09-01", "2026-09-25");
  const julyHelp = moodBy("jh", "help", "2026-07-01", "2026-08-01");
  const sepHelp = moodBy("sh", "help", "2026-09-01", "2026-09-25");
  const steps = [julyComplaints, sepComplaints, julyHelp, sepHelp];

  it("passes over a later count of a kind the answer does not name, for the one it does", () => {
    const c = pickChart(steps, names, "How did July compare with September?\nAmong the bug reports, the mood was lower in September.");
    expect(c).toMatchObject({ groupBy: "period", title: "The average mood by period, in bug reports" });
  });
  it("draws nothing when every count is narrowed to a kind the reader was never told about", () => {
    expect(pickChart(steps, names, "How did the mood in July compare with September?\nThe mood fell in September.")).toBeNull();
    expect(pickChart(steps, names)).toBeNull();
  });
  it("draws the whole question's count over a narrower one", () => {
    const all = moodBy("all", undefined, "2026-07-01", "2026-08-01");
    const allSep = moodBy("allSep", undefined, "2026-09-01", "2026-09-25");
    expect(pickChart([all, allSep, julyHelp, sepHelp], names, "How did the mood change?\nThe mood fell.")).toMatchObject({ id: "allSep", title: "The average mood by period" });
  });
  it("applies to who is talking too", () => {
    const voices = (id: string, filters: object) => ({ type: "tool-voices", state: "output-available", toolCallId: id, input: { filters }, output: { rows: [{ author: "a", messages: 9 }, { author: "b", messages: 5 }] } });
    const q = "Who is most active in discussions about lag?\nThe most active people are a and b.";
    expect(pickChart([voices("bugs", { flag: "bug", topic: "performance-access" })], names, q)).toBeNull();
    expect(pickChart([voices("all", { topic: "performance-access" }), voices("bugs", { flag: "bug", topic: "performance-access" })], names, q)).toMatchObject({ id: "all" });
    expect(pickChart([voices("bugs", { flag: "bug", topic: "performance-access" })], names, "Who reports the most bugs?\n")).toMatchObject({
      id: "bugs",
      title: "Most active people, by messages written, in bug reports about Performance & Access",
    });
  });
});

// Production QA 2026-09-26.
describe("pickChart, two periods and a subject's mood", () => {
  const count = (id: string, metric: string, group_by: string, filters: object, rows: { key: string; value: number }[], days?: number) => ({
    type: "tool-aggregate",
    state: "output-available",
    toolCallId: id,
    input: { metric, group_by, filters },
    output: { metric, groupBy: group_by, filters, rows: rows.map((r) => ({ ...r, n: 10 })), ...(days ? { period: { days } } : {}) },
  });
  const AUG = { since: "2026-08-01", until: "2026-09-01" };
  const SEP = { since: "2026-09-01", until: "2026-09-25" };

  // "Which topics grew the most from August to September?" drew September's topics alone.
  it("draws two periods of a count by topic as pairs, per day", () => {
    const c = pickChart(
      [
        count("aug", "conversations", "topic", AUG, [{ key: "performance-access", value: 66 }, { key: "updates", value: 310 }], 31),
        count("sep", "conversations", "topic", SEP, [{ key: "performance-access", value: 113 }, { key: "updates", value: 225 }], 24),
      ],
      names,
    );
    expect(c).toMatchObject({ id: "sep", groupBy: "period", metric: "conversations_per_day" });
    expect(c!.title).toBe("Conversations per day by topic, 1–31 Aug against 1–24 Sep");
    expect(c!.rows.map((r) => [r.key, r.value.toFixed(2)])).toEqual([
      ["updates · 1–31 Aug", "10.00"],
      ["updates · 1–24 Sep", "9.38"],
      ["Performance & Access · 1–31 Aug", "2.13"],
      ["Performance & Access · 1–24 Sep", "4.71"],
    ]);
  });

  it("pairs only the same slice over separate periods", () => {
    const aug = count("aug", "conversations", "topic", { ...AUG, flag: "complaint" }, [{ key: "updates", value: 31 }, { key: "x", value: 5 }], 31);
    const sep = count("sep", "conversations", "topic", SEP, [{ key: "updates", value: 24 }, { key: "x", value: 5 }], 24);
    expect(pickChart([aug, sep], names, "complaints")).toMatchObject({ id: "sep", groupBy: "topic" });
  });

  // Asked about one topic, the chart drew the whole community's mood.
  it("draws the subject's mood over the community's", () => {
    const weeks = [{ key: "2026-09-01", value: 0.4 }, { key: "2026-09-08", value: 0.35 }];
    const topic = count("topic", "avg_sentiment", "week", { topic: "performance-access" }, weeks);
    const all = count("all", "avg_sentiment", "week", {}, weeks);
    expect(pickChart([topic, all], names, "How do players feel about Performance & Access?")).toMatchObject({ id: "topic" });
    expect(pickChart([all, topic], names, "How do players feel about Performance & Access?")).toMatchObject({ id: "topic" });
  });

  it("says the mood is the whole community's when that is the only one, under a question naming a topic", () => {
    const all = count("all", "avg_sentiment", "week", {}, [{ key: "2026-09-01", value: 0.4 }, { key: "2026-09-08", value: 0.35 }]);
    expect(pickChart([all], names, "How do players feel about Performance and Access?")!.title).toBe("The average mood by week, whole community");
    expect(pickChart([all], names, "How do players feel?")!.title).toBe("The average mood by week");
  });

  // "Read 751 and 1,856 conversations in two passes" was taken for counts. Counts say "counted", never "read"; a read
  // says "read" because every conversation in it was read (lib/data/scan.ts).
  it("says counted for counts and read only for reads", () => {
    const counts = [
      count("aug", "conversations", "topic", AUG, [{ key: "updates", value: 310 }], 31),
      count("sep", "conversations", "topic", SEP, [{ key: "updates", value: 225 }], 24),
    ];
    expect(activitySummary(counts, names).text).toBe("Counted conversations by topic twice");
    expect(activitySummary(counts, names).text).not.toMatch(/read/i);
  });
});
