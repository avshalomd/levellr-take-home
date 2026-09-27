import { beforeEach, describe, expect, it, vi } from "vitest";

// The agent's topic list (tools.ts reads topicLabels) must follow the team's edits in Explore: the active taxonomy
// wins over what the loader stored, and a database without the app tables still answers from the loader's set.
const db = vi.hoisted(() => ({ edited: null as unknown, noAppTables: false }));
vi.mock("./db", () => ({
  query: async (text: string) => {
    if (/FROM taxonomies/.test(text)) {
      if (db.noAppTables) throw new Error('relation "taxonomies" does not exist');
      return db.edited ? [{ labels: db.edited }] : [];
    }
    if (/key = 'topics'/.test(text)) return [{ value: [{ key: "domains", name: "Domains", description: "d" }] }];
    return [];
  },
}));

import { topicLabels } from "./read";

beforeEach(() => {
  db.edited = null;
  db.noAppTables = false;
});

describe("topicLabels", () => {
  it("is the loader's set before any edit", async () => {
    expect(await topicLabels()).toEqual([{ key: "domains", name: "Domains", description: "d" }]);
  });

  it("is the edited set once there is one, without the catch-all", async () => {
    db.edited = [
      { key: "domains", name: "Domains mode", description: "d" },
      { key: "switch", name: "Switch and platforms", description: "s" },
      { key: "other", name: "Other", description: "" },
    ];
    expect((await topicLabels()).map((l) => [l.key, l.name])).toEqual([
      ["domains", "Domains mode"],
      ["switch", "Switch and platforms"],
    ]);
  });

  it("falls back to the loader's set where db/app.sql was never applied", async () => {
    db.noAppTables = true;
    expect((await topicLabels()).map((l) => l.key)).toEqual(["domains"]);
  });
});
