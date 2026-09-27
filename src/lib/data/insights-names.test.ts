import { beforeEach, describe, expect, it, vi } from "vitest";

// The page's names read: every statement it sends is recorded, so the test can hold it to one read and no write.
const db = vi.hoisted(() => ({ sent: [] as string[], rows: [] as unknown[], fail: false }));
vi.mock("./db", () => ({
  query: async (text: string) => {
    db.sent.push(text);
    if (db.fail) throw new Error("connection terminated");
    return db.rows;
  },
}));

// Next's cache, in memory (outside a Next server unstable_cache has no store).
vi.mock("next/cache", () => import("@/test/next-cache-fake"));

import { resetNextCache } from "@/test/next-cache-fake";
import { topicsChanged } from "./insights";
import { NAMES_SQL, namesOf, topicNames } from "./insights-names";

beforeEach(() => {
  resetNextCache();
  db.sent = [];
  db.rows = [];
  db.fail = false;
});

describe("namesOf", () => {
  it("maps each key to its name as written, ampersand and all", () => {
    expect(namesOf([{ key: "highlights", name: "Highlights & Creations", description: "…" }, { key: "other", name: "Other" }])).toEqual({
      highlights: "Highlights & Creations",
      other: "Other",
    });
  });
  it("skips entries it cannot use rather than failing the page", () => {
    expect(namesOf([{ key: "a" }, { name: "B" }, { key: "c", name: "  " }, null, { key: "d", name: "D" }])).toEqual({ d: "D" });
    expect(namesOf(null)).toEqual({});
    expect(namesOf("not a list")).toEqual({});
  });
});

describe("topicNames", () => {
  it("reads the active label set's names in one read-only query", async () => {
    db.rows = [{ labels: [{ key: "highlights", name: "Highlights & Creations", description: "" }] }];
    expect(await topicNames()).toEqual({ highlights: "Highlights & Creations" });
    expect(db.sent).toHaveLength(1);
    expect(db.sent[0]).toBe(NAMES_SQL);
  });
  it("never adopts a label set: with none stored it returns nothing and writes nothing", async () => {
    expect(await topicNames()).toEqual({});
    expect(db.sent.join("\n")).not.toMatch(/INSERT|UPDATE|DELETE|count\(/i);
  });
  it("returns nothing when the database cannot be read, so the page still renders", async () => {
    db.fail = true;
    expect(await topicNames()).toEqual({});
  });
  // Open item 2026-09-26: a warm Explore load reads nothing; a rename (the edit route calls topicsChanged) reads again.
  it("is cached until the topics change, and a failed read is not kept", async () => {
    db.rows = [{ labels: [{ key: "highlights", name: "Highlights", description: "" }] }];
    await topicNames();
    expect(await topicNames()).toEqual({ highlights: "Highlights" });
    expect(db.sent).toHaveLength(1);
    db.rows = [{ labels: [{ key: "highlights", name: "Highlights & Creations", description: "" }] }];
    topicsChanged();
    expect(await topicNames()).toEqual({ highlights: "Highlights & Creations" });
    expect(db.sent).toHaveLength(2);

    topicsChanged();
    db.fail = true;
    expect(await topicNames()).toEqual({});
    db.fail = false;
    expect(await topicNames()).toEqual({ highlights: "Highlights & Creations" });
    expect(db.sent).toHaveLength(5); // the failed load tried the edited set, then the loader's
  });
});
