import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelMessage } from "ai";
import type { z } from "zod";
import { REFUSED } from "./flags";

// The tools refuse a call narrowed to a kind of conversation the reader's question never named (QA 2026-09-26: "How
// did people react to version 42.3?" read only 224 complaint threads and 25 bug reports). The data layer is stubbed:
// what matters is that a refused call reads nothing, and that an asked-for flag, or none, still runs.

const scanMock = vi.fn();
const searchMock = vi.fn();
const aggregateMock = vi.fn();
const voicesMock = vi.fn();
vi.mock("@/lib/data/scan", () => ({ scan: (...a: unknown[]) => scanMock(...a), MAX_SCAN: 2500 }));
vi.mock("@/lib/data/search", () => ({ searchConversations: (...a: unknown[]) => searchMock(...a) }));
vi.mock("@/lib/data/voices", () => ({ topVoices: (...a: unknown[]) => voicesMock(...a) }));
vi.mock("@/lib/data/aggregate", () => ({
  aggregate: (...a: unknown[]) => aggregateMock(...a),
  METRICS: { conversations: {}, avg_sentiment: {} },
  GROUPINGS: { none: {}, week: {} },
}));
vi.mock("@/lib/data/read", () => ({
  conversationIdOf: vi.fn(),
  getConversation: vi.fn(),
  topicLabels: async () => [{ key: "updates", name: "updates", description: "" }],
  getOverview: vi.fn(async () => ({
    topics: [{ key: "cheating-bans", name: "Cheating & Bans", n: 900 }],
    releases: [{ version: "43.1" }],
  })),
}));
// The scope check (scope.ts) asks Jev; never over the network here. Default: the question is off-topic.
const decideMock = vi.fn<(a: { state: { question: string } }) => Promise<unknown>>(async () => ({
  answers: { bears: { type: "noul", noul: 0.1 } },
}));
vi.mock("@/lib/llm/decide", () => ({
  decide: (a: { state: { question: string } }) => decideMock(a),
  noul: (instructions: string) => ({ type: "noul", instructions }),
}));

const { isTransient, makeTools } = await import("./tools");

const asked = (...questions: string[]): ModelMessage[] =>
  questions.flatMap((q, i) => [
    ...(i ? [{ role: "assistant" as const, content: "..." }] : []),
    { role: "user" as const, content: [{ type: "text" as const, text: q }] },
  ]);
// The AI SDK's execute takes the call's options; only `messages` and `toolCallId` are read.
const opts = (messages: ModelMessage[]) => ({ toolCallId: "t1", messages }) as never;
// A tool's input schema is the zod object it was given; the SDK's type widens it.
const parse = (schema: unknown, input: unknown) => (schema as z.ZodType).safeParse(input);

describe("a flag the question never named", () => {
  const tools = makeTools();
  const reaction = asked("How did people react to version 42.3?");
  beforeEach(() => {
    for (const m of [scanMock, searchMock, aggregateMock, voicesMock])
      m.mockReset().mockResolvedValue({ status: "ok", hits: [], rows: [] });
  });

  // Review 2026-09-26: returned as a result, not thrown. Thrown, the AI SDK sent the browser "An error occurred." in its
  // place and the refused call showed as a step that did not finish.
  it("refuses the call before it reads anything, telling the model to read again without it", async () => {
    const out = await tools.scan.execute!(
      { question: "Reaction to 42.3?", filters: { topic: "updates", flag: "frustrated" } },
      opts(reaction),
    );
    expect(out).toMatchObject({ status: "refused", flag: "frustrated" });
    const model = await tools.scan.toModelOutput!({
      toolCallId: "t1",
      input: {} as never,
      output: out as never,
    });
    expect(model).toMatchObject({ type: "text" });
    expect((model as { value: string }).value.startsWith(REFUSED)).toBe(true);
    expect((model as { value: string }).value).toMatch(
      /does not ask about frustrated conversations[\s\S]*without filters\.flag/,
    );
    expect(scanMock).not.toHaveBeenCalled();
  });

  it("refuses it on every tool that takes a slice, and the model reads the refusal from each", async () => {
    const f = { filters: { flag: "bug" as const } };
    const outs = [
      ["find", await tools.find.execute!({ query: "42.3", ...f }, opts(reaction))],
      [
        "aggregate",
        await tools.aggregate.execute!({ metric: "conversations", group_by: "week", ...f }, opts(reaction)),
      ],
      ["voices", await tools.voices.execute!({ ...f }, opts(reaction))],
    ] as const;
    for (const [name, out] of outs) {
      expect(out, name).toMatchObject({ status: "refused", flag: "bug" });
      const model = await tools[name].toModelOutput!({
        toolCallId: "t1",
        input: {} as never,
        output: out as never,
      });
      expect((model as { value: string }).value.startsWith(REFUSED), name).toBe(true);
    }
    expect(searchMock).not.toHaveBeenCalled();
    expect(aggregateMock).not.toHaveBeenCalled();
    expect(voicesMock).not.toHaveBeenCalled();
  });

  it("keeps a genuine failure an error, so it is not taken for a refusal", async () => {
    await expect(
      tools.scan.execute!({ question: "Q?", filters: { topic: "nope" } }, opts(reaction)),
    ).rejects.toThrow(/No topic "nope"/);
  });

  it("runs a read with no flag, and one whose flag the question (or the one it follows up) names", async () => {
    await tools.scan.execute!(
      { question: "Reaction to 42.3?", filters: { topic: "updates" } },
      opts(reaction),
    );
    await tools.scan.execute!(
      { question: "Complaints?", filters: { flag: "frustrated" } },
      opts(asked("What do people complain about after 42.3?")),
    );
    await tools.aggregate.execute!(
      { metric: "conversations", group_by: "week", filters: { flag: "frustrated" } },
      opts(asked("What are people complaining about?", "And in July?")),
    );
    expect(scanMock).toHaveBeenCalledTimes(2);
    // Each read also takes its slice's mood from the labels (the "avg_sentiment" calls); one count was asked for.
    expect(aggregateMock.mock.calls.filter((c) => c[0] === "conversations")).toHaveLength(1);
  });
});

describe("what the tools add around a call (QA 2026-09-26, round 5)", () => {
  const tools = makeTools(undefined, {
    community: "r/PUBATTLEGROUNDS",
    platform: "Reddit",
    about: "",
    from: "2026-06-18",
    to: "2026-09-24",
    now: "2026-09-24T23:00:00.000Z",
  });
  const q = asked("How do players feel about the latest update?");
  const ok = {
    status: "ok",
    scanned: 119,
    relevant: 80,
    filters: {},
    hits: [],
    relevantByWeek: [],
    relevantByTopic: [],
  };
  beforeEach(() => {
    for (const m of [scanMock, searchMock, aggregateMock, voicesMock]) m.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("tries a failed read once more, and the second try's result stands", async () => {
    scanMock.mockRejectedValueOnce(new Error("socket hang up")).mockResolvedValueOnce(ok);
    aggregateMock.mockResolvedValue({ rows: [{ key: "all", value: 0.38, n: 119 }] });
    const out = await tools.scan.execute!({ question: "Feelings about 43.1?" }, opts(q));
    expect(scanMock).toHaveBeenCalledTimes(2);
    expect(out).toMatchObject({ status: "ok", scanned: 119, sliceMood: 0.38 });
  });

  it("after a second failure, tells the model what to say first, in plain words", async () => {
    scanMock.mockRejectedValue(new Error("socket hang up"));
    await expect(tools.scan.execute!({ question: "Feelings about 43.1?" }, opts(q))).rejects.toThrow(
      /This read did not finish, twice[\s\S]*FIRST sentence says what the answer covers[\s\S]*"One read didn't finish, so this covers only/,
    );
    searchMock.mockRejectedValue(new Error("timeout"));
    await expect(tools.find.execute!({ query: "43.1" }, opts(q))).rejects.toThrow(
      /This search did not finish/,
    );
  });

  // QA 2026-09-26: made to read, a free model called scan with the question ", ".
  it("reads for the reader's own question when the call's question has no words", async () => {
    scanMock.mockResolvedValue(ok);
    searchMock.mockResolvedValue({ hits: [], candidates: 0 });
    aggregateMock.mockResolvedValue({ rows: [] });
    const july = asked("What are people complaining about most in September?", "And in July?");
    await tools.scan.execute!({ question: ", " }, opts(july));
    expect(scanMock.mock.calls[0][0]).toBe(
      "What are people complaining about most in September?\nAnd in July?",
    );
    await tools.find.execute!({ query: " " }, opts(july));
    expect(searchMock.mock.calls[0][0]).toBe(
      "What are people complaining about most in September?\nAnd in July?",
    );
    await tools.scan.execute!({ question: "Complaints in July?" }, opts(july));
    expect(scanMock.mock.calls[1][0]).toBe("Complaints in July?");
  });

  // Review 2026-09-26: the fallback joined the question before only when it named a kind.
  it("reads a wordless call for the follow-up with its question, when neither names a kind", async () => {
    scanMock.mockResolvedValue(ok);
    aggregateMock.mockResolvedValue({ rows: [] });
    await tools.scan.execute!(
      { question: ", " },
      opts(asked("What do people say about the new map?", "And in July?")),
    );
    expect(scanMock.mock.calls[0][0]).toBe("What do people say about the new map?\nAnd in July?");
  });

  // Review 2026-09-26: "July 2026" reached Postgres's ::timestamptz, which threw, and the retry hid the error the model
  // used to correct the date from.
  it("refuses a date that is not ISO before anything reads, with words the model can act on", () => {
    const bad = parse(tools.scan.inputSchema, { question: "Lag?", filters: { since: "July 2026" } });
    expect(bad.success).toBe(false);
    expect(bad.error?.issues[0].message).toBe(
      '"July 2026" is not a date the tools read: write an ISO date, e.g. 2026-07-01 (a month is since 2026-07-01, until 2026-08-01)',
    );
    expect(
      parse(tools.aggregate.inputSchema, {
        metric: "conversations",
        group_by: "none",
        filters: { until: "2026-02-30" },
      }).success,
    ).toBe(false);
    for (const since of ["2026-07-01", "2026-07-01T00:00:00Z", "2026-07-01T00:00:00.000+02:00"])
      expect(parse(tools.find.inputSchema, { query: "lag", filters: { since } }).success, since).toBe(true);
  });

  it("throws an error the input causes at once, unretried and in its own words", async () => {
    const pg = Object.assign(
      new Error('invalid input syntax for type timestamp with time zone: "July 2026"'),
      { code: "22007" },
    );
    scanMock.mockRejectedValue(pg);
    await expect(tools.scan.execute!({ question: "Lag?" }, opts(q))).rejects.toBe(pg);
    expect(scanMock).toHaveBeenCalledTimes(1);
  });

  it("retries only what a dropped connection, a timeout or a busy provider throws", () => {
    for (const e of [
      new Error("socket hang up"),
      new Error("Error connecting to database: fetch failed"),
      Object.assign(new Error("x"), { code: "ECONNRESET" }),
      Object.assign(new Error("terminating connection"), { code: "57P01" }),
      Object.assign(new Error("canceling statement due to statement timeout"), { code: "57014" }),
      Object.assign(new Error("busy"), { isRetryable: true }),
      Object.assign(new Error("The operation was aborted"), { name: "TimeoutError" }),
      new Error("wrapped", { cause: new Error("read ETIMEDOUT") }),
    ])
      expect(isTransient(e), e.message).toBe(true);
    for (const e of [
      Object.assign(new Error('invalid input syntax for type timestamp with time zone: "July 2026"'), {
        code: "22007",
      }),
      Object.assign(new Error('column "x" does not exist'), { code: "42703" }),
      new TypeError("Cannot read properties of undefined"),
      "a string",
    ])
      expect(isTransient(e), String(e)).toBe(false);
  });

  it("never retries an unknown topic, whose words already list the real ones", async () => {
    await expect(
      tools.scan.execute!({ question: "Q?", filters: { topic: "nope" } }, opts(q)),
    ).rejects.toThrow(/No topic "nope"/);
    expect(scanMock).not.toHaveBeenCalled();
  });

  it("gives the model the mood of everything read, and never a per-conversation mood", async () => {
    scanMock.mockResolvedValue(ok);
    aggregateMock.mockResolvedValue({ rows: [{ key: "all", value: 0.38, n: 119 }] });
    const out = await tools.scan.execute!({ question: "Feelings about 43.1?" }, opts(q));
    expect(aggregateMock).toHaveBeenCalledWith("avg_sentiment", "none", {});
    const model = await tools.scan.toModelOutput!({
      toolCallId: "t1",
      input: {} as never,
      output: out as never,
    });
    expect((model as { value: string }).value).toContain(
      "Average mood of all 119 conversations read: 38/100.",
    );
  });

  it("tells the model a release question read on one topic covers only that topic", async () => {
    scanMock.mockResolvedValue({ ...ok, filters: { topic: "updates" } });
    aggregateMock.mockResolvedValue({ rows: [] });
    const out = await tools.scan.execute!(
      { question: "Feelings about 43.1?", filters: { topic: "updates" } },
      opts(q),
    );
    expect((out as { notes?: string[] }).notes?.[0]).toMatch(
      /^This read covered one topic only\. A reaction to a release is every topic's conversations/,
    );
    const plain = await tools.scan.execute!(
      { question: "Lag?", filters: { topic: "updates" } },
      opts(asked("What do people say about lag?")),
    );
    expect((plain as { notes?: string[] }).notes).toBeUndefined();
  });

  it("stamps a count with the days it covers, clipped to the data", async () => {
    aggregateMock.mockResolvedValue({
      metric: "conversations",
      groupBy: "topic",
      filters: {},
      rows: [],
      sql: "",
      params: [],
    });
    const out = await tools.aggregate.execute!(
      { metric: "conversations", group_by: "none", filters: { since: "2026-09-01", until: "2026-10-01" } },
      opts(q),
    );
    expect(out).toMatchObject({ period: { since: "2026-09-01", until: "2026-09-25", days: 24 } });
  });

  // Production QA 2026-09-26: "+124%" worked out from rates rounded to one decimal, when 66 over 31 days to 113 over 24
  // is +121%. A second count of the same slice over another period comes back with the change, worked out in code.
  it("hands a count of the same slice over another period its change per day, from the unrounded rates", async () => {
    const tools = makeTools();
    const counted = (since: string, until: string, value: number) => ({
      metric: "conversations",
      groupBy: "topic",
      filters: { since, until },
      rows: [{ key: "updates", value }],
      sql: "",
      params: [],
    });
    const ask = asked("Which topics grew the most from August to September?");
    aggregateMock
      .mockResolvedValueOnce(counted("2026-08-01", "2026-09-01", 66))
      .mockResolvedValueOnce(counted("2026-09-01", "2026-09-25", 113));
    const aug = await tools.aggregate.execute!(
      { metric: "conversations", group_by: "topic", filters: { since: "2026-08-01", until: "2026-09-01" } },
      opts(ask),
    );
    const sep = await tools.aggregate.execute!(
      { metric: "conversations", group_by: "topic", filters: { since: "2026-09-01", until: "2026-09-25" } },
      opts(ask),
    );
    expect(aug).not.toHaveProperty("change");
    const model = await tools.aggregate.toModelOutput!({
      toolCallId: "t1",
      input: {} as never,
      output: sep as never,
    });
    expect((model as { value: string }).value).toContain(
      "Change in conversations per day, 2026-08-01 to 2026-08-31 against 2026-09-01 to 2026-09-24: updates +121%.",
    );
  });

  it("stamps a read with the days it covers, clipped to the data (review 2026-09-26)", async () => {
    scanMock.mockResolvedValue({ ...ok, filters: { since: "2026-09-01", until: "2026-10-01" } });
    aggregateMock.mockResolvedValue({ rows: [] });
    const out = await tools.scan.execute!(
      { question: "Lag?", filters: { since: "2026-09-01", until: "2026-10-01" } },
      opts(asked("What do people say about lag?")),
    );
    expect(out).toMatchObject({ period: { since: "2026-09-01", until: "2026-09-25", days: 24 } });
  });

  it("answers an off-topic question with the reply written in code", async () => {
    const out = (await tools.out_of_scope.execute!({}, opts(asked("What's the weather in Oslo?")))) as {
      status: string;
      text: string;
    };
    expect(out.status).toBe("off-topic");
    expect(out.text).toMatch(
      /^I can't answer that\. I only know what r\/PUBATTLEGROUNDS talked about from 18 June to 24 September 2026\. You could ask:/,
    );
    const model = await tools.out_of_scope.toModelOutput!({
      toolCallId: "t1",
      input: {} as never,
      output: out as never,
    });
    expect(model).toEqual({
      type: "text",
      value: "The app has written the reply to the reader. Write nothing more.",
    });
  });

  // Eval run 7, L09: "How do you aim the mortar?" was declined as general knowledge; the community has a guide on it.
  it("turns the call down when the conversations bear on the question, and tells the model to answer from them", async () => {
    decideMock.mockResolvedValueOnce({ answers: { bears: { type: "noul", noul: 0.94 } } });
    const out = await tools.out_of_scope.execute!({}, opts(asked("How do you aim the mortar?")));
    expect(out).toEqual({ status: "in-scope", bears: 0.94 });
    expect(decideMock.mock.calls.at(-1)![0].state).toMatchObject({
      question: "How do you aim the mortar?",
      conversations_from: "2026-06-18",
      conversations_to: "2026-09-24",
    });
    const model = await tools.out_of_scope.toModelOutput!({
      toolCallId: "t1",
      input: {} as never,
      output: out as never,
    });
    expect(model).toMatchObject({
      type: "text",
      value: expect.stringMatching(/^Not out of scope: .* Answer it from them/),
    });
  });

  it("takes the model's call when the check cannot be made", async () => {
    decideMock.mockRejectedValueOnce(new Error("jev timed out"));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const out = (await tools.out_of_scope.execute!({}, opts(asked("What's the weather in Oslo?")))) as {
      status: string;
    };
    expect(out.status).toBe("off-topic");
  });
});

// (sanity QA 2026-09-26) An earlier turn's result is replayed through toModelOutput on every follow-up, from the chat the
// browser sends; one saved in a shape the text no longer reads threw and failed the whole follow-up. It now reads as
// an unreadable result, and the turn goes on.
describe("an earlier result in a shape the text cannot read", () => {
  it("is read back as unreadable instead of failing the turn", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { UNREADABLE_RESULT } = await import("./tools");
    const tools = makeTools();
    const scan = await tools.scan.toModelOutput!({
      toolCallId: "t1",
      input: {} as never,
      output: { status: "ok", hits: [] } as never,
    });
    expect(scan).toEqual({ type: "text", value: UNREADABLE_RESULT });
    const count = await tools.aggregate.toModelOutput!({
      toolCallId: "t1",
      input: {} as never,
      output: {} as never,
    });
    expect(count).toEqual({ type: "text", value: UNREADABLE_RESULT });
  });
});
