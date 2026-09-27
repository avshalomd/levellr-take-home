import { describe, expect, it } from "vitest";
import { citedTags } from "./refs";
import { claimsOf, plainClaim, pruneWeak, shownCitations, type ClaimSupport } from "./claims";

const cite = (id: string, support: number | null, status = "ok") => ({ id, support, status });
// The claims exactly as the verifier would store them for a text: claimsOf gives the sentences, the test the scores.
const checked = (
  text: string,
  scores: Record<string, number | null>,
  status: Record<string, string> = {},
): ClaimSupport[] =>
  claimsOf(text).map((c) => ({
    claim: c.claim,
    citations: c.ids.map((id) => cite(id, scores[id] ?? null, status[id])),
  }));

describe("claimsOf", () => {
  it("reads bullets and sentences as claims, with their refs", () => {
    expect(
      claimsOf("Mostly stutter.\n- Frame drops after the patch [msg1, msg2]. Also crashes [msg3]."),
    ).toEqual([
      { claim: "Mostly stutter.", ids: [] },
      { claim: "Frame drops after the patch.", ids: ["msg1", "msg2"] },
      { claim: "Also crashes.", ids: ["msg3"] },
    ]);
  });

  // The live answer of 2026-09-25: "...detection. [msg1, msg2] They also question..." had handed msg1 and msg2 to the
  // second sentence, so the verifier checked them against a claim they were never cited for.
  it("keeps citations written after the full stop with the sentence they follow", () => {
    expect(claimsOf("- Bans come from reports. [msg1, msg2] They also doubt replays. [msg3]")).toEqual([
      { claim: "Bans come from reports.", ids: ["msg1", "msg2"] },
      { claim: "They also doubt replays.", ids: ["msg3"] },
    ]);
  });

  it("starts a sentence at a digit or a quote, as the answer's hover claims do", () => {
    expect(claimsOf("Crashes rose [msg1]. 34% mention it [msg2].").map((c) => c.ids)).toEqual([
      ["msg1"],
      ["msg2"],
    ]);
  });
});

describe("pruneWeak", () => {
  const text =
    "People report stutter.\n- Frame drops after the patch [msg1, msg2, msg3].\n- Crashes on start [msg4, msg5].";

  it("drops a citation that does not back its claim when another one does", () => {
    const out = pruneWeak(text, checked(text, { msg1: 0.9, msg2: 0.2, msg3: 0.7, msg4: 0.3, msg5: 0.1 }));
    expect(out).toBe(
      "People report stutter.\n- Frame drops after the patch [msg1, msg3].\n- Crashes on start [msg4, msg5].",
    );
  });

  it("keeps every citation of a claim nothing backs, and every unchecked one", () => {
    const out = pruneWeak(text, checked(text, { msg1: 0.9, msg2: null, msg3: 0.1, msg4: 0.3, msg5: 0.1 }));
    expect(out).toContain("[msg1, msg2]");
    expect(out).toContain("[msg4, msg5]");
  });

  it("drops a made-up or unread ref beside a backed one, and a whole group with the space before it", () => {
    const t = "- Queue times are long [msg1] [msg9].";
    const out = pruneWeak(t, checked(t, { msg1: 0.8, msg9: 0.9 }, { msg9: "not-retrieved" }));
    expect(out).toBe("- Queue times are long [msg1].");
  });

  it("prunes per claim: a message weak for one claim stays where it backs another", () => {
    const t = "- Stutter [msg1, msg2].\n- Servers lag [msg2].";
    const claims = checked(t, {});
    claims[0].citations = [cite("msg1", 0.9), cite("msg2", 0.1)];
    claims[1].citations = [cite("msg2", 0.8)];
    expect(pruneWeak(t, claims)).toBe("- Stutter [msg1].\n- Servers lag [msg2].");
  });

  it("leaves a sentence the verifier never saw alone and still lines the rest up", () => {
    const verified = "- Stutter [msg1, msg2].";
    const shown = "Let me look into that [msg7, msg8].\n" + verified;
    const out = pruneWeak(shown, checked(verified, { msg1: 0.9, msg2: 0.1 }));
    expect(out).toBe("Let me look into that [msg7, msg8].\n- Stutter [msg1].");
  });

  it("is a no-op without a verification", () => {
    expect(pruneWeak(text, [])).toBe(text);
  });
});

// QA 2026-09-26: "+N more" counted a weak citation pruned from the text as cited. The chips the reader sees and the
// citations the count treats as cited are the same list.
describe("shownCitations", () => {
  it("is the chips pruneWeak leaves in the text", () => {
    const text = "- Stutter after the patch [msg1, msg2, msg3, msg4].";
    const [claim] = checked(text, { msg1: 0.9, msg2: 0.2, msg3: 0.7, msg4: 0.1 });
    expect(shownCitations(claim)).toEqual(["msg1", "msg3"]);
    expect(citedTags(pruneWeak(text, [claim]))).toEqual(shownCitations(claim));
  });
  it("keeps every citation of a claim none backs, less one to a message that does not exist", () => {
    const [claim] = checked(
      "- Stutter [msg1, msg2, msg9].",
      { msg1: 0.2, msg2: 0.3 },
      { msg9: "unknown-id" },
    );
    expect(shownCitations(claim)).toEqual(["msg1", "msg2"]);
  });
});

describe("plainClaim", () => {
  it("drops markdown emphasis and keeps a username's underscores", () => {
    expect(plainClaim("**wizard_brandon** says `FPS` is *worse*.")).toBe("wizard_brandon says FPS is worse.");
  });
});
