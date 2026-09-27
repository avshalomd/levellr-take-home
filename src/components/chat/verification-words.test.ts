import { describe, expect, it } from "vitest";
import type { VerificationPart } from "@/lib/agent/ui-types";
import { answeredIn, corroborationWords, plainClaim, verificationWords } from "./verification-words";

const done = (supported: number, cited: number) =>
  ({ status: "done", claims: [], supported, cited, invalidIds: [], uncitedSentences: 0 }) as VerificationPart;

describe("verificationWords", () => {
  it("says nothing before the check has started", () => {
    expect(verificationWords(undefined)).toBeNull();
  });

  it("reports the result in plain words", () => {
    expect(verificationWords(done(7, 8))?.text).toBe("Checked: 7 of 8 claims are backed by the messages they cite");
    expect(verificationWords(done(5, 5))?.text).toBe("Checked: all 5 claims are backed by the messages they cite");
    expect(verificationWords(done(1, 1))?.text).toBe("Checked: the claim is backed by the messages they cite");
  });

  // QA 2026-09-27: a failed claim check read "Checked: 0 of 9 claims are backed".
  it("says apart the claims the check never reached, and never counts them as unbacked", () => {
    const part = (supported: number, cited: number, unchecked: number) => ({ ...done(supported, cited), unchecked }) as VerificationPart;
    expect(verificationWords(part(7, 8, 1))?.text).toBe("Checked: all 7 claims are backed by the messages they cite; 1 more could not be checked");
    expect(verificationWords(part(5, 8, 2))?.text).toBe("Checked: 5 of 6 claims are backed by the messages they cite; 2 more could not be checked");
    expect(verificationWords(part(0, 9, 9))).toEqual({ state: "quiet", text: "The claims could not be checked this time." });
    expect(verificationWords(part(7, 8, 0))?.text).toBe("Checked: 7 of 8 claims are backed by the messages they cite");
  });

  it("says both, not all 2 (QA 2026-09-25)", () => {
    expect(verificationWords(done(2, 2))?.text).toBe("Checked: both claims are backed by the messages they cite");
    expect(verificationWords(done(1, 2))?.text).toBe("Checked: 1 of 2 claims are backed by the messages they cite");
  });

  // QA 2026-09-26, round 5: five points quoting thread titles and a cause, with no chip and nothing under them.
  it("says plainly when an answer from the tools cites no message, so nothing was checked", () => {
    expect(verificationWords({ status: "uncited", read: false })).toEqual({ state: "quiet", text: "Counts only: no messages are cited, so this answer was not checked against any." });
    expect(verificationWords({ status: "uncited", read: true })).toEqual({ state: "quiet", text: "No messages are cited here, so this answer was not checked against any." });
  });
  // Open item 2026-09-26 (D45): an uncited answer's rates are checked against the counts; one still wrong is said.
  it("adds the rate note under an uncited answer whose rate is still wrong, and says what a counts rewrite corrects", () => {
    const rate = { claim: "a", stated: "3.8", known: [] };
    expect(verificationWords({ status: "uncited", read: false, rates: [rate] })).toEqual({
      state: "quiet",
      text: "Counts only: no messages are cited, so this answer was not checked against any.",
      note: "One per-day rate here does not match the counts it comes from.",
    });
    expect(verificationWords({ status: "uncited", read: true, rates: [rate, rate] })?.note).toBe("2 per-day rates here do not match the counts they come from.");
    expect(verificationWords({ status: "running" }, { status: "running", weak: 1, counts: true })).toEqual({ state: "tightening", text: "Correcting 1 claim to match the counts…" });
  });
  it("says it is finding the messages while an uncited answer is sent back to cite them", () => {
    expect(verificationWords({ status: "running" }, { status: "running", weak: 5, cite: true })).toEqual({ state: "tightening", text: "Finding the messages behind each point…" });
  });

  it("says a rewrite is running, with how many claims it is tightening", () => {
    const w = verificationWords({ status: "running" }, { status: "running", weak: 2 });
    expect(w).toMatchObject({ state: "tightening", text: "Tightening 2 claims to match what the messages say…" });
  });

  it("notes a kept rewrite, and stays silent about one that was not kept", () => {
    const kept = verificationWords(done(6, 6), { status: "done", kept: true, text: "", before: { supported: 4, cited: 6 } });
    expect(kept?.note).toMatch(/tightened/);
    expect(verificationWords(done(4, 6), { status: "done", kept: false, text: "", before: { supported: 4, cited: 6 } })?.note).toBeUndefined();
  });

  it("adds no tightening note under an answer whose kept text only gained citations (review 2026-09-26)", () => {
    expect(verificationWords(done(3, 3), { status: "done", kept: true, cite: true, text: "", before: { supported: 0, cited: 0 } })?.note).toBeUndefined();
    expect(verificationWords({ status: "failed", error: "x" }, { status: "done", kept: true, cite: true, text: "", before: { supported: 0, cited: 0 } })).toEqual({
      state: "quiet",
      text: "The claims could not be checked this time.",
    });
  });

  it("notes a per-day rate that still matches none the counts gave (QA 2026-09-26)", () => {
    const rate = { claim: "September ran 9 per day.", stated: "9", known: ["11.3 per day over 24 days"] };
    expect(verificationWords({ ...done(2, 2), rates: [rate] } as VerificationPart)?.note).toBe("One per-day rate here does not match the counts it comes from.");
    expect(verificationWords({ ...done(2, 2), rates: [rate, rate] } as VerificationPart)?.note).toBe("2 per-day rates here do not match the counts they come from.");
    expect(verificationWords({ ...done(2, 2), rates: [] } as VerificationPart)?.note).toBeUndefined();
  });

  it("stays calm when the check fails", () => {
    expect(verificationWords({ status: "failed", error: "boom" })).toMatchObject({ state: "quiet" });
    expect(verificationWords({ status: "failed", error: "boom" })?.text).not.toMatch(/boom/);
  });

  it("says nothing under an answer that cites no message, such as a refusal (QA 2026-09-25)", () => {
    expect(verificationWords(done(0, 0))).toBeNull();
  });
});

describe("answeredIn", () => {
  it("counts seconds in the singular and plural (QA 2026-09-25: 'Answered in 1 seconds')", () => {
    expect(answeredIn(1200)).toBe("Answered in 1 second");
    expect(answeredIn(12_400)).toBe("Answered in 12 seconds");
  });
  it("never says 0 seconds, and says nothing without a time", () => {
    expect(answeredIn(300)).toBe("Answered in under a second");
    expect(answeredIn(undefined)).toBeNull();
    expect(answeredIn(0)).toBeNull();
  });
});

describe("plainClaim", () => {
  // QA 2026-09-25: the expanded claim list read "**Praised:** …" with its asterisks.
  it("drops markdown emphasis, code ticks, link targets and a list marker", () => {
    expect(plainClaim("**Praised:** the new map and _faster_ matchmaking")).toBe("Praised: the new map and faster matchmaking");
    expect(plainClaim("- **Most common criticism:** `lag` in [ranked](https://x.y)")).toBe("Most common criticism: lag in ranked");
  });
  it("leaves a lone asterisk or an arithmetic star alone", () => {
    expect(plainClaim("2 * 3 players said so")).toBe("2 * 3 players said so");
  });
});

describe("corroborationWords", () => {
  const done = (pool: number, found: number, failed = 0, claims = 1, reads?: number) => ({
    status: "done" as const, pool, found, failed, reads,
    claims: Array.from({ length: claims }, () => ({ claim: "c", tags: ["msg1"], conversations: 3, more: [], moreTotal: 2 })),
  });
  it("says what the claims were weighed against, all of it or the most relevant part", () => {
    expect(corroborationWords(done(42, 42))?.text).toBe(
      "Each claim was also checked against all 42 conversations found to bear on the question. The number beside a claim is how many more of them say it.",
    );
    expect(corroborationWords(done(1, 1))?.text).toContain("against the one conversation found to bear on the question.");
  });
  // QA 2026-09-26: under steps saying 85 and 18 bear on the question, "the 80 conversations closest to the question"
  // never said 80 was a cap; under steps saying 12 and 80, "all 80 conversations found" lost the 12.
  it("says how many of how many when the part read was cut, and never 'all' for a cut", () => {
    const one = corroborationWords(done(80, 224, 2))!.text;
    expect(one).toContain("against the 80 conversations closest to the question, of the 224 found to bear on it (2 conversations could not be read).");
    expect(one).not.toMatch(/\ball\b/);
    expect(corroborationWords(done(80, 95, 0, 1, 2))!.text).toContain(
      "against the 80 conversations closest to the question, of the 95 the two reads found to bear on it.",
    );
  });
  // Review 2026-09-26: reads are the different slices the scans read; a turn of searches alone has none.
  it("names no reads when only searches fed the pool", () => {
    expect(corroborationWords(done(5, 5, 0, 1, 0))!.text).toContain("against all 5 conversations found to bear on the question.");
  });
  it("says the conversations several reads found between them are counted once", () => {
    expect(corroborationWords(done(80, 80, 0, 1, 2))!.text).toContain("against all 80 different conversations the two reads found to bear on the question.");
  });
  it("shows the work while it runs and stays silent when there was nothing to weigh", () => {
    expect(corroborationWords({ status: "running" })).toEqual({ running: true, text: "Counting the conversations behind each claim…" });
    expect(corroborationWords(done(5, 5, 0, 0))).toBeNull();
    expect(corroborationWords({ status: "failed", error: "x" })).toBeNull();
    expect(corroborationWords(undefined)).toBeNull();
  });
});
