import { describe, expect, it } from "vitest";
import { MAX_VOICES, clampLimit, toVoice, voicesQuery } from "./voices";

describe("clampLimit", () => {
  it("keeps a sane row count", () => {
    expect(clampLimit(12)).toBe(12);
    expect(clampLimit(0)).toBe(1);
    expect(clampLimit(-3)).toBe(1);
    expect(clampLimit(7.9)).toBe(7);
    expect(clampLimit(10_000)).toBe(MAX_VOICES);
    expect(clampLimit(Number.NaN)).toBe(12);
  });
});

describe("voicesQuery", () => {
  it("scopes to the filtered conversations, leaves out bots and deleted accounts, and ranks by messages then score", () => {
    const { sql, params } = voicesQuery({ topic: "maps", since: "2026-09-01" }, 12);
    expect(sql).toContain(
      "SELECT c.id FROM conversations c WHERE $1 = ANY(c.topics) AND c.started_at >= $2::timestamptz",
    );
    expect(sql).toContain("NOT m.is_bot AND m.author <> 'deleted-user'");
    expect(sql).toMatch(/ORDER BY messages DESC, score DESC, v\.author\s+LIMIT \$3$/);
    expect(params).toEqual(["maps", "2026-09-01", 12]);
  });

  it("passes an author filter and the limit as parameters, never spliced", () => {
    const { sql, params } = voicesQuery({ author: "Deep-Pen420" }, 999);
    expect(sql).not.toContain("Deep-Pen420");
    expect(sql).toContain("m.author = $1");
    expect(params).toEqual(["Deep-Pen420", MAX_VOICES]);
  });
});

describe("toVoice", () => {
  it("drops the slice total and writes both timestamp spellings as the same ISO string", () => {
    const row = {
      author: "alwaysHK",
      messages: 3,
      conversations: 2,
      score: 9,
      started: 1,
      total_authors: 40,
    };
    const fromJson = toVoice({
      ...row,
      first_ts: "2026-06-19T20:47:24+00:00",
      last_ts: "2026-09-24T21:27:43+00:00",
    });
    const fromDriver = toVoice({
      ...row,
      first_ts: "2026-06-19T20:47:24.000Z",
      last_ts: "2026-09-24T21:27:43.000Z",
    });
    expect(fromJson).toEqual(fromDriver);
    expect(fromJson).toEqual({
      author: "alwaysHK",
      messages: 3,
      conversations: 2,
      score: 9,
      started: 1,
      first_ts: "2026-06-19T20:47:24.000Z",
      last_ts: "2026-09-24T21:27:43.000Z",
    });
  });
});
