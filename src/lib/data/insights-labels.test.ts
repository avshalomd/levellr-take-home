import { describe, expect, it } from "vitest";
import {
  addToDraft,
  applyInstant,
  buildDraft,
  dropFromDraft,
  durationEstimate,
  namesInWords,
  proposalWords,
  topicCountWords,
  eta,
  formatUsd,
  isInstant,
  nameTaken,
  nextNewKey,
  reconcile,
  shownDescription,
  sourceLine,
  viewLabels,
  type DraftEdit,
  type Label,
} from "./insights-labels";

const L = (key: string, name: string, description = `${name} talk`, n = 10): Label => ({ key, name, description, n });
const ACTIVE = [L("perf", "Performance", "FPS and crashes", 300), L("bugs", "Bugs", "Broken things", 200), L("maps", "Maps", "Maps", 100), L("other", "Other", "None fits", 50)];

describe("which edits are instant", () => {
  it("rename, combine and rewording a description are instant; the rest need a relabel", () => {
    expect(isInstant({ op: "rename", key: "perf", name: "Speed" })).toBe(true);
    expect(isInstant({ op: "merge", keys: ["perf", "bugs"], name: "Tech" })).toBe(true);
    expect(isInstant({ op: "describe", key: "perf", description: "x" })).toBe(true);
    expect(isInstant({ op: "add", key: "new:1", name: "Esports", description: "x" })).toBe(false);
    expect(isInstant({ op: "remove", key: "maps" })).toBe(false);
    expect(isInstant({ op: "redefine", key: "maps", description: "x" })).toBe(false);
  });

  it("an edit to a label that does not exist yet is never instant: it belongs to the draft", () => {
    expect(isInstant({ op: "rename", key: "new:1", name: "x" })).toBe(false);
    expect(isInstant({ op: "merge", keys: ["perf", "new:1"], name: "x" })).toBe(false);
    expect(isInstant({ op: "merge", keys: ["perf"], name: "x" })).toBe(false);
  });
});

describe("optimistic instant edits", () => {
  it("rename and describe change one label in place", () => {
    const out = applyInstant(ACTIVE, { op: "rename", key: "bugs", name: "  Glitches " });
    expect(out.map((l) => l.name)).toEqual(["Performance", "Glitches", "Maps", "Other"]);
    expect(applyInstant(ACTIVE, { op: "describe", key: "maps", description: "Map talk" })[2].description).toBe("Map talk");
  });

  it("combine sums the counts and keeps the first part's place", () => {
    const out = applyInstant(ACTIVE, { op: "merge", keys: ["bugs", "perf"], name: "Technical" });
    expect(out.map((l) => [l.name, l.n])).toEqual([
      ["Technical", 500],
      ["Maps", 100],
      ["Other", 50],
    ]);
    expect(out[0].description).toBe("FPS and crashes Broken things");
  });
});

describe("the pending draft", () => {
  it("collects changes that need a relabel and ignores instant ones", () => {
    let d: DraftEdit[] = [];
    d = addToDraft(d, { op: "remove", key: "maps" });
    d = addToDraft(d, { op: "rename", key: "perf", name: "Speed" }); // instant: not part of the draft
    d = addToDraft(d, { op: "merge", keys: ["perf", "bugs"], name: "x" });
    d = addToDraft(d, { op: "add", key: nextNewKey(d), name: "Esports", description: "Tournaments" });
    expect(d).toEqual([
      { op: "remove", key: "maps" },
      { op: "add", key: "new:1", name: "Esports", description: "Tournaments" },
    ]);
  });

  it("folds a series of edits into the smallest draft that says the same thing", () => {
    let d: DraftEdit[] = [];
    d = addToDraft(d, { op: "add", key: "new:1", name: "Esport", description: "" });
    d = addToDraft(d, { op: "rename", key: "new:1", name: "Esports" }); // edits the new label
    d = addToDraft(d, { op: "describe", key: "new:1", description: "Tournaments" });
    d = addToDraft(d, { op: "redefine", key: "perf", description: "FPS" });
    d = addToDraft(d, { op: "redefine", key: "perf", description: "FPS, stutter" }); // the last one wins
    d = addToDraft(d, { op: "add", key: nextNewKey(d), name: "Temp", description: "x" });
    d = addToDraft(d, { op: "remove", key: "new:2" }); // removing a label just added forgets it
    d = addToDraft(d, { op: "remove", key: "perf" }); // removing supersedes redefining
    expect(d).toEqual([
      { op: "add", key: "new:1", name: "Esports", description: "Tournaments" },
      { op: "remove", key: "perf" },
    ]);
  });

  it("undo drops one change; reconcile drops changes to labels that were combined away", () => {
    const d: DraftEdit[] = [
      { op: "redefine", key: "perf", description: "x" },
      { op: "remove", key: "maps" },
      { op: "add", key: "new:1", name: "Esports", description: "y" },
    ];
    expect(dropFromDraft(d, "maps")).toHaveLength(2);
    const afterCombine = applyInstant(ACTIVE, { op: "merge", keys: ["maps", "bugs"], name: "World" }).map((l) =>
      l.name === "World" ? { ...l, key: "world" } : l,
    );
    expect(reconcile(d, afterCombine)).toEqual([
      { op: "redefine", key: "perf", description: "x" },
      { op: "add", key: "new:1", name: "Esports", description: "y" },
    ]);
  });
});

describe("the draft sent for pricing", () => {
  it("lays the draft over the active labels, and lists the changes in words", () => {
    const pending: DraftEdit[] = [
      { op: "remove", key: "maps" },
      { op: "redefine", key: "bugs", description: "Anything broken" },
      { op: "add", key: "new:1", name: "Esports", description: "Tournaments" },
    ];
    const view = viewLabels(ACTIVE, pending);
    expect(view.map((l) => [l.name, l.status])).toEqual([
      ["Performance", "kept"],
      ["Bugs", "redefined"],
      ["Maps", "removed"],
      ["Other", "kept"],
      ["Esports", "new"],
    ]);
    expect(view[1].before).toBe("Broken things");

    const draft = buildDraft(ACTIVE, pending);
    expect(draft.labels).toEqual([
      { key: "perf", name: "Performance", description: "FPS and crashes" },
      { key: "bugs", name: "Bugs", description: "Anything broken" },
      { name: "Esports", description: "Tournaments" },
    ]);
    expect(draft.changes).toEqual(["New wording for “Bugs”", "Remove “Maps”", "Add “Esports”"]);
    expect(draft.problems).toEqual([]);
  });

  it("refuses a draft with too few labels, blank names, duplicates or labels nobody described", () => {
    expect(buildDraft(ACTIVE, [{ op: "remove", key: "perf" }, { op: "remove", key: "bugs" }]).problems).toContain(
      "Keep at least two topics besides Other.",
    );
    const dup = buildDraft(ACTIVE, [{ op: "add", key: "new:1", name: "maps", description: "x" }]);
    expect(dup.problems).toContain("Two topics are called “Maps”.");
    const undescribed = buildDraft([...ACTIVE.slice(0, 3).map((l) => ({ ...l, description: "" })), ACTIVE[3]], [{ op: "remove", key: "maps" }]);
    expect(undescribed.problems).toEqual(["Describe 2 topics first: descriptions are what conversations are sorted by."]);
    const blank = buildDraft(ACTIVE, [{ op: "add", key: "new:1", name: " ", description: "x" }]);
    expect(blank.problems).toContain("Every topic needs a name.");
  });
});

describe("small helpers", () => {
  it("names clash case-insensitively, except with themselves", () => {
    expect(nameTaken(ACTIVE, " maps ")).toBe(true);
    expect(nameTaken(ACTIVE, "Maps", "maps")).toBe(false);
    expect(nameTaken(ACTIVE, "Esports")).toBe(false);
  });

  it("money, time and provenance read plainly", () => {
    expect(formatUsd(0.1834)).toBe("$0.18");
    expect(formatUsd(0.004)).toBe("under $0.01");
    expect(durationEstimate(10628)).toBe("about 9 min");
    expect(durationEstimate(200)).toBe("under a minute");
    expect(eta(0, 100, 5000)).toBeNull();
    expect(eta(300, 10628, 15000)).toBe("about 9 min left");
    expect(eta(90, 100, 30000)).toBe("under a minute left");
    expect(sourceLine("adopted", "2026-09-25T16:11:19.045Z")).toBe("Found in the conversations on 25 Sep.");
    expect(sourceLine("edited", "2026-09-25")).toBe("Last edited by you on 25 Sep.");
    expect(sourceLine("relabelled", "2026-06-03")).toBe("Every conversation checked against these topics on 3 Jun.");
  });

  it("a data refresh that kept the topics says only when, plainly (QA 2026-09-26)", () => {
    const line = sourceLine("carried", "2026-09-25T16:11:19.045Z");
    expect(line).toBe("Last updated 25 Sep.");
    expect(line).not.toMatch(/version|label/i);
  });

  it("the pending changes and their problems say topics, never labels (D32, QA 2026-09-26)", () => {
    const draft = buildDraft(
      [L("maps", "Maps"), L("bugs", "Bugs"), L("other", "Other")],
      [{ op: "add", key: "new:1", name: "Maps", description: "" }, { op: "remove", key: "bugs" }],
    );
    for (const words of [...draft.changes, ...draft.problems]) expect(words).not.toMatch(/label/i);
  });
});

describe("shownDescription", () => {
  it("words the catch-all's built-in description in topics, not labels (QA 2026-09-26)", () => {
    expect(shownDescription({ key: "other", description: "None of the other labels fits." })).toBe(
      "Conversations that fit none of the other topics.",
    );
  });
  it("shows a description someone wrote as written, the catch-all's included", () => {
    expect(shownDescription({ key: "other", description: "Memes and off-topic chat." })).toBe("Memes and off-topic chat.");
    expect(shownDescription({ key: "maps", description: "None of the other labels fits." })).toBe("None of the other labels fits.");
    expect(shownDescription({ key: "other", description: "" })).toBe("");
  });
});

// D46: each topic is its own yes or no, so a confirmed draft asks again only about the new and redefined topics, and a
// removal is free. The confirmation says exactly that, by name.
describe("what a priced draft says it will do", () => {
  it("names the topics asked again, with the cost and time for those alone", () => {
    expect(proposalWords({ estimate: { conversations: 10628, usd: 0.1834 }, asks: ["Esports"], removes: [] })).toEqual([
      "Ask about “Esports” in each of the 10,628 conversations: about $0.18, about 9 min. The other topics keep their counts.",
    ]);
  });
  it("says a removal is free, and says both when a draft does both", () => {
    expect(proposalWords({ estimate: { conversations: 0, usd: 0 }, asks: [], removes: ["Memes"] })).toEqual([
      "“Memes” is taken off every conversation. Removing a topic is free.",
    ]);
    expect(proposalWords({ estimate: { conversations: 10, usd: 0.001 }, asks: ["A", "B"], removes: ["C", "D", "E"] })).toEqual([
      "Ask about “A” and “B” in each of the 10 conversations: about under $0.01, under a minute. The other topics keep their counts.",
      "“C”, “D” and “E” are taken off every conversation. Removing a topic is free.",
    ]);
  });
  it("lists names the way a sentence does", () => {
    expect(namesInWords([])).toBe("");
    expect(namesInWords(["Bugs"])).toBe("“Bugs”");
    expect(namesInWords(["Bugs", "Maps", "Lag"])).toBe("“Bugs”, “Maps” and “Lag”");
  });
});

describe("a topic's count in the editor", () => {
  it("counts the conversations touching it, as a share of all conversations", () => {
    expect(topicCountWords("Bugs", 412, 1000)).toEqual({ text: "412 conversations touch it, 41%", title: "41% of all 1,000 conversations touch Bugs" });
    expect(topicCountWords("Bugs", 1, 5000)).toEqual({ text: "1 conversation touches it", title: undefined });
    expect(topicCountWords("Bugs", 2, 1000).text).toBe("2 conversations touch it, <1%");
  });
});
