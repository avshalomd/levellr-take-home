import { beforeEach, describe, expect, it, vi } from "vitest";

// Open item 2026-09-26: Explore's grid and topic names are cached until the topics change (lib/data/insights.ts). The
// two routes that change them must say so: an edit always, a relabel step once the job has stopped running (it moves
// conversations only as it finishes). A refused edit changed nothing and says nothing.
const s = vi.hoisted(() => ({ changed: 0, status: "running", refuse: false }));
vi.mock("@/lib/data/insights", () => ({ topicsChanged: () => s.changed++ }));
vi.mock("@/lib/labels/store", () => ({
  editInstant: async () => {
    if (s.refuse) throw new Error("The conversations are being sorted.");
  },
  panel: async () => ({ active: { version: 1, labels: [] }, job: null, budget: { spentUsd: 0, capUsd: 3 }, moodTarget: null }),
  start: async () => ({ id: "j1", status: s.status }),
  step: async () => ({ status: s.status, done: 1, total: 2, costUsd: 0, error: null }),
}));

import { POST as edit } from "./edit/route";
import { POST as step } from "./backfill/step/route";
import { POST as start } from "./backfill/route";

const post = (body: object) => new Request("http://x/api/taxonomy", { method: "POST", body: JSON.stringify(body) });

beforeEach(() => {
  s.changed = 0;
  s.status = "running";
  s.refuse = false;
});

describe("the topic routes invalidate Explore's cache", () => {
  it("after an edit", async () => {
    expect((await edit(post({ op: "rename", key: "bugs", name: "Bugs" }))).status).toBe(200);
    expect(s.changed).toBe(1);
  });

  it("not after a refused edit", async () => {
    s.refuse = true;
    expect((await edit(post({ op: "rename", key: "bugs", name: "Bugs" }))).status).toBe(400);
    expect(s.changed).toBe(0);
  });

  it("after the relabel step that finishes the job, not after the batches before it", async () => {
    await step(post({ jobId: "j1" }));
    expect(s.changed).toBe(0);
    s.status = "done";
    await step(post({ jobId: "j1" }));
    expect(s.changed).toBe(1);
  });

  // D46: a draft that only removes topics asks nothing and is applied when it is confirmed.
  it("when a confirmed draft is applied at once (removals only), not when it starts a run", async () => {
    await start(post({ draftId: "d1" }));
    expect(s.changed).toBe(0);
    s.status = "done";
    await start(post({ draftId: "d1" }));
    expect(s.changed).toBe(1);
  });
});
