import { beforeEach, describe, expect, it, vi } from "vitest";

// Open item 2026-09-26: Explore's grid made one query on every load, the read of the data version its cache is keyed
// on. The version is cached now, under a tag the topic edits invalidate. The database here is a counted fake that
// answers each statement by what it reads; Next's cache is the in-memory fake (src/test/next-cache-fake.ts).
const db = vi.hoisted(() => ({ sent: [] as string[], version: "7/100/1000", fail: false }));
const kind = (sql: string) =>
  /concat_ws/.test(sql)
    ? "version"
    : /unnest\(\$1::text\[\]/.test(sql)
      ? "selection"
      : /GROUPING SETS/.test(sql)
        ? "grid"
        : /min\(started_at\)/.test(sql)
          ? "bounds"
          : /FROM releases/.test(sql)
            ? "releases"
            : /dataset_meta/.test(sql)
              ? "source"
              : "other";
vi.mock("./db", () => ({
  query: async (sql: string) => {
    const k = kind(sql);
    db.sent.push(k);
    if (db.fail) throw new Error("connection terminated");
    if (k === "version") return [{ v: db.version }];
    if (k === "bounds") return [{ lo: "2026-06-18", hi: "2026-09-24" }];
    if (k === "selection")
      return [
        {
          totals: { n: 1, engagement: 0, messages: 1, mood_sum: 0, mood_n: 0, people: 1 },
          sessions: [],
          voices: [],
        },
      ];
    return [];
  },
}));
vi.mock("next/cache", () => import("@/test/next-cache-fake"));

import { advance, resetNextCache, revalidated } from "@/test/next-cache-fake";
import { getGrid, getSelection, INSIGHTS_VERSION_TAG, topicsChanged } from "./insights";

const count = (k: string) => db.sent.filter((x) => x === k).length;

beforeEach(() => {
  resetNextCache();
  db.sent = [];
  db.version = "7/100/1000";
  db.fail = false;
});

describe("the Explore grid's cache", () => {
  it("a second load of the same view sends no query at all", async () => {
    await getGrid("week");
    const first = db.sent.length;
    expect(count("version")).toBe(1);
    expect(count("grid")).toBe(1);
    await getGrid("week");
    expect(db.sent.length).toBe(first);
  });

  it("a topic edit invalidates it: the version is read again, and a new version counts the grid again", async () => {
    await getGrid("week");
    db.version = "8/100/1000"; // what an edit leaves behind: a new active label set
    topicsChanged();
    expect(revalidated).toEqual([{ tag: INSIGHTS_VERSION_TAG, profile: { expire: 0 } }]);
    await getGrid("week");
    expect(count("version")).toBe(2);
    expect(count("grid")).toBe(2);
  });

  it("an invalidation with nothing changed reads only the version, not the grid", async () => {
    await getGrid("week");
    topicsChanged();
    await getGrid("week");
    expect(count("version")).toBe(2);
    expect(count("grid")).toBe(1);
  });

  it("a writer outside the app (a script, the loader) is seen once the version's five minutes are up", async () => {
    await getGrid("week");
    db.version = "8/100/1200";
    advance(299);
    await getGrid("week");
    expect(count("grid")).toBe(1);
    advance(2);
    await getGrid("week");
    expect(count("version")).toBe(2);
    expect(count("grid")).toBe(2);
  });

  it("a selection shares the cached version", async () => {
    await getGrid("week");
    await getSelection([{ topic: "bugs", from: "2026-09-07", to: "2026-09-14" }]);
    await getSelection([{ topic: "bugs", from: "2026-09-07", to: "2026-09-14" }]);
    expect(count("version")).toBe(1);
    expect(count("selection")).toBe(1);
  });

  it("a version that could not be read is not kept", async () => {
    db.fail = true;
    await expect(getGrid("week")).rejects.toThrow();
    db.fail = false;
    await getGrid("week");
    await getGrid("week");
    expect(count("version")).toBe(2); // the failed read, then one good one
  });
});
