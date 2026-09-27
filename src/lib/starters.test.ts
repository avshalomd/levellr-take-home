import { describe, expect, it } from "vitest";
import { starterQuestions, topicQuestion } from "./starters";

describe("starter questions", () => {
  it("are written from the biggest labels, never from Other", () => {
    const qs = starterQuestions([
      { key: "other", name: "Other", n: 900 },
      { key: "billing", name: "Billing & Plans", n: 50 },
      { key: "sync-errors", name: "Sync Errors", n: 300 },
    ]);
    expect(qs[0]).toBe("What are people saying about sync errors lately?");
    expect(qs.some((q) => q.includes("billing & plans"))).toBe(true);
    expect(qs.join(" ")).not.toMatch(/other/i);
    expect(qs).toHaveLength(6); // Home's grid and its loading skeleton are six cards
  });

  it("keeps acronyms in a label name", () => {
    expect(starterQuestions([{ key: "api", name: "API Limits", n: 5 }])[0]).toBe("What are people saying about API limits lately?");
  });

  it("still offers questions for a dataset with no labels", () => {
    expect(starterQuestions([]).length).toBeGreaterThanOrEqual(3);
  });

  // D48: a release is a fact of one kind of community, not of the app; nothing on Home is built from one.
  it("name nothing specific to one community's releases", () => {
    expect(starterQuestions([{ key: "maps", name: "Maps", n: 5 }]).join(" ")).not.toMatch(/\b(update|patch|release|version)\b/i);
  });
});

describe("topic questions", () => {
  it("ask about a topic in sentence case", () => {
    expect(topicQuestion("Maps & Modes")).toBe("What are people saying about maps & modes?");
  });
});
