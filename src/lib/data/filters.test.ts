import { describe, expect, it } from "vitest";
import { FLAG_THRESHOLD, isIsoDate, whereOf } from "./filters";

describe("whereOf", () => {
  it("is TRUE with no filters and adds no parameters", () => {
    const params: unknown[] = [];
    expect(whereOf({}, params)).toBe("TRUE");
    expect(params).toEqual([]);
  });

  it("numbers every value as a parameter, in order", () => {
    const params: unknown[] = [];
    const sql = whereOf(
      { channel: "Discussion", topic: "maps", since: "2026-09-01", until: "2026-09-08", flag: "bug" },
      params,
    );
    expect(sql).toBe(
      "c.channel = $1 AND $2 = ANY(c.topics) AND c.started_at >= $3::timestamptz AND c.started_at < $4::timestamptz" +
        ` AND c.p_bug >= ${FLAG_THRESHOLD}`,
    );
    expect(params).toEqual(["Discussion", "maps", "2026-09-01", "2026-09-08"]);
  });

  it("a topic means every conversation touching it (membership), not only its primary topic", () => {
    const params: unknown[] = [];
    expect(whereOf({ topic: "maps" }, params)).toBe("$1 = ANY(c.topics)");
    expect(params).toEqual(["maps"]);
  });

  it("an author means the conversations that person wrote in, with the handle as a parameter, never spliced", () => {
    const params: unknown[] = ["already there"];
    const handle = "x'); DROP TABLE messages; --";
    const sql = whereOf({ topic: "maps", author: handle }, params, "cv");
    expect(sql).toBe(
      "$2 = ANY(cv.topics) AND EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = cv.id AND m.author = $3)",
    );
    expect(sql).not.toContain("DROP");
    expect(params).toEqual(["already there", "maps", handle]);
  });
});

// Review 2026-09-26: "July 2026" reached Postgres's ::timestamptz and threw.
describe("isIsoDate", () => {
  it("takes a day, with or without a time and zone, that the calendar has", () => {
    for (const s of [
      "2026-07-01",
      "2026-07-01T00:00:00Z",
      "2026-07-01T10:30",
      "2026-07-01 10:30:00+02",
      "2024-02-29",
    ])
      expect(isIsoDate(s), s).toBe(true);
  });
  it("refuses words, a month alone and a day the calendar lacks", () => {
    for (const s of ["July 2026", "2026-07", "07/01/2026", "2026-02-30", "2026-13-01", ""])
      expect(isIsoDate(s), s).toBe(false);
  });
});
