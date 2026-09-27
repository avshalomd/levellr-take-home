import { describe, expect, it } from "vitest";
import { asksWhatPeopleSay, groundingOf, needsRead, toolsUsed } from "./grounding";

// QA 2026-09-26, round 5: "What are people complaining about most in September?" came back as five points quoting
// thread titles ("State of PUBG", "Max Level Cheater") and a cause ("traced to AWS server congestion"), with no citation
// chip and no "Checked:" line, from a turn that had only counted.
const result = (toolName: string, output: unknown) => ({ type: "tool-result", toolName, output });
const step = (...content: unknown[]) => ({ content });
const counted = step(result("aggregate", { rows: [{ key: "cheating-bans", value: 202, n: 202 }] }));
const read = step(result("scan", { status: "ok", scanned: 202, relevant: 191, hits: [] }));

describe("needsRead", () => {
  it("makes a turn that only counted read before it answers what people complain about", () => {
    expect(needsRead([counted], "What are people complaining about most in September?")).toBe(true);
    expect(needsRead([counted], "And in July?")).toBe(true);
  });
  it("lets a turn that has read, or a question that asks only for numbers, answer", () => {
    expect(needsRead([counted, read], "What are people complaining about most in September?")).toBe(false);
    expect(needsRead([counted], "How many complaints were there in September?")).toBe(false);
    expect(needsRead([counted], "How has the mood changed week by week?")).toBe(false);
    expect(needsRead([counted], "Which topic grew the most in the last month?")).toBe(false);
  });
  it("never forces a read before anything was counted", () => {
    expect(needsRead([], "What are people complaining about?")).toBe(false);
    expect(needsRead([step(result("dataset_overview", {}))], "What are people complaining about?")).toBe(false);
  });
  // Review 2026-09-26: forced again after each of these, the model looped on reads to the step budget.
  it("forces a read at most once a turn: never after a read was tried, whatever came of it", () => {
    const q = "What do people say about lag?";
    const refused = step(result("scan", { status: "refused", flag: "complaint", words: "Not run:" }));
    const broad = step(result("scan", { status: "too-broad", total: 9000 }));
    const empty = step(result("scan", { status: "empty" }));
    const nothingFound = step(result("find", { hits: [], candidates: 40 }));
    const failed = step({ type: "tool-call", toolName: "scan", input: {} }, { type: "tool-error", toolName: "scan", error: "did not finish, twice" });
    for (const tried of [refused, broad, empty, nothingFound, failed]) expect(needsRead([counted, tried], q)).toBe(false);
    expect(needsRead([counted, step({ type: "tool-call", toolName: "find", input: {} })], q)).toBe(false);
    expect(needsRead([counted], q)).toBe(true);
  });
  it("reads the question in either language", () => {
    expect(asksWhatPeopleSay("Hva klager folk mest på?")).toBe(true);
    expect(asksWhatPeopleSay("Hvor mange klager var det i september?")).toBe(false);
  });
});

describe("groundingOf", () => {
  it("names an answer from the tools that cites nothing, and whether the turn read messages", () => {
    expect(groundingOf(false, [counted])).toEqual({ kind: "uncited", read: false });
    expect(groundingOf(false, [counted, read])).toEqual({ kind: "uncited", read: true });
    expect(groundingOf(true, [counted, read])).toEqual({ kind: "cited" });
  });
  it("says nothing under a reply that used no tool, like a question back", () => {
    expect(groundingOf(false, [])).toEqual({ kind: "none" });
    expect(groundingOf(false, [step(result("dataset_overview", {}))])).toEqual({ kind: "none" });
  });
  // Review 2026-09-26: a search with no hits had counted as a read.
  it("counts a search as a read only when it found something", () => {
    expect(toolsUsed([counted, step(result("find", { hits: [], candidates: 40 }))]).read).toBe(false);
    expect(toolsUsed([step(result("find", { hits: [{ ref: 1 }], candidates: 40 }))]).read).toBe(true);
    expect(groundingOf(false, [counted, step(result("find", { hits: [], candidates: 40 }))])).toEqual({ kind: "uncited", read: false });
  });
  it("takes the off-topic reply from the out_of_scope call", () => {
    const off = step(result("out_of_scope", { status: "off-topic", text: "I can't answer that." }));
    expect(groundingOf(false, [off])).toEqual({ kind: "off-topic", text: "I can't answer that." });
    expect(toolsUsed([off])).toEqual({ read: false, counted: false, offTopic: "I can't answer that." });
  });
});
