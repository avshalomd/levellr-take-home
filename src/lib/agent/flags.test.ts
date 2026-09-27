import { describe, expect, it } from "vitest";
import { flagsNamed, followUpContext, lastQuestion, questionInContext, unaskedFlag } from "./flags";

describe("flagsNamed", () => {
  it("reads the kinds of conversation a question or a first sentence names", () => {
    expect([
      ...flagsNamed("Among the complaint threads about the Rondo changes, most are negative."),
    ]).toEqual(["complaint"]);
    expect([...flagsNamed("Which bugs are reported most?")]).toEqual(["bug"]);
    expect([...flagsNamed("What are people asking for most?")]).toEqual(["feature"]);
    expect([...flagsNamed("Where do new players ask for help?")]).toEqual(["help"]);
  });
  // QA 2026-09-26: each of these was narrowed to one kind of conversation it never named.
  it("finds no kind in a question about feelings, reactions or who takes part", () => {
    for (const q of [
      "How do players feel about the Rondo changes?",
      "What was the reaction to the Rondo changes?",
      "Who is most active in discussions about lag?",
      "How did the mood in July compare with September?",
    ])
      expect([...flagsNamed(q)]).toEqual([]);
  });
});

// Review 2026-09-26: whole words, and only where the word means the kind.
describe("flagsNamed, the words", () => {
  it("does not read a kind into words that only share its spelling", () => {
    for (const q of [
      "What do people think of the new features?",
      "What do the data suggest about the patch?",
      "Help me understand the July dip.",
      "Is the debugger mentioned?",
    ])
      expect([...flagsNamed(q)], q).toEqual([]);
  });
  it("reads the kinds from their other names", () => {
    expect([...flagsNamed("What are the main gripes?")]).toEqual(["complaint"]);
    expect([...flagsNamed("What are the main frustrations?")]).toEqual(["complaint"]);
    expect([...flagsNamed("Is the new map buggy?")]).toEqual(["bug"]);
    expect([...flagsNamed("Which glitches come up?")]).toEqual(["bug"]);
    expect([...flagsNamed("Are there crashes after the patch?")]).toEqual(["bug"]);
    expect([...flagsNamed("What issues do people report?")]).toEqual(["bug"]);
    expect([...flagsNamed("What do players want changed?")]).toEqual(["feature"]);
    expect([...flagsNamed("Any suggestions for the lobby?")]).toEqual(["feature"]);
    expect([...flagsNamed("Which feature requests are most common?")]).toEqual(["feature"]);
    expect([...flagsNamed("Where do new players look for help?")]).toEqual(["help"]);
  });
  // Review 2026-09-26: each of these re-admitted a narrowing the question never asked for.
  it("reads no kind into a feeling, a wish to know or a request that is not the reader's subject", () => {
    for (const q of [
      "Are players frustrated with the Rondo changes?",
      "What frustrates players most?",
      "I wish to know how people reacted to 42.3.",
      "How did people take the requested changes?",
    ])
      expect([...flagsNamed(q)], q).toEqual([]);
  });
  it("reads requests only as a request noun or as what people request", () => {
    for (const q of [
      "Which feature requests come up most?",
      "Are there requests for a new map?",
      "What do players request most?",
      "What is most requested?",
      "What are people asking for?",
      "Any change requests after 42.3?",
      "What is on the players' wishlist?",
    ])
      expect([...flagsNamed(q)], q).toEqual(["feature"]);
  });
  it("reads a request for help as help alone", () => {
    for (const q of [
      "How many help requests came in?",
      "Are there requests for help with the installer?",
      "Who is asking for help?",
      "Do people request help in Discussion?",
    ])
      expect([...flagsNamed(q)], q).toEqual(["help"]);
  });
  it("reads Norwegian", () => {
    expect([...flagsNamed("Hva klager folk på?")]).toEqual(["complaint"]);
    expect([...flagsNamed("Hvilke feil rapporteres?")]).toEqual(["bug"]);
    expect([...flagsNamed("Hva ønsker spillerne seg?")]).toEqual(["feature"]);
    expect([...flagsNamed("Hvor ber nye spillere om hjelp?")]).toEqual(["help"]);
  });
});

describe("questionInContext", () => {
  it("carries the earlier question's kind into a follow-up", () => {
    const q = ["What are people complaining about in September?", "And in July?"];
    expect(flagsNamed(questionInContext(q)).has("complaint")).toBe(true);
    expect(
      flagsNamed(questionInContext(["Which bugs come up most?", "What about after the patch?"])).has("bug"),
    ).toBe(true);
  });
  it("starts afresh on a full question, and on a follow-up that names its own kind", () => {
    expect(
      questionInContext([
        "What are people complaining about?",
        "How do players feel about the Rondo changes?",
      ]),
    ).toBe("How do players feel about the Rondo changes?");
    expect([
      ...flagsNamed(questionInContext(["What are people complaining about?", "And the bugs?"])),
    ]).toEqual(["bug"]);
  });
  it("is empty with no questions", () => {
    expect(questionInContext([])).toBe("");
  });
});

// Review 2026-09-26, each case probed live: a follow-up leans on the question right before it, never across a full
// question, and a question about feelings or who takes part is never narrowed.
describe("questionInContext, what counts as a follow-up", () => {
  const kinds = (...q: string[]) => [...flagsNamed(questionInContext(q))];
  it("never reaches past a full question that named no kind", () => {
    expect(
      kinds("What are people complaining about?", "How do players feel about Rondo overall?", "And in July?"),
    ).toEqual([]);
  });
  it("carries a kind down a chain of follow-ups", () => {
    expect(kinds("What are people complaining about?", "And in July?", "What about September?")).toEqual([
      "complaint",
    ]);
    expect(kinds("Which bugs come up most?", "After the patch?", "In July?")).toEqual(["bug"]);
  });
  it("starts afresh on a short question about feelings or who takes part", () => {
    expect(kinds("What are people complaining about?", "How do players feel?")).toEqual([]);
    expect(kinds("What are people complaining about?", "Who is most active?")).toEqual([]);
    expect(kinds("What are people complaining about?", "And how do players feel?")).toEqual([]);
    expect(kinds("Hva klager folk på?", "Hvem er mest aktive?")).toEqual([]);
  });
  it("does not take 'now' or 'then' for a follow-up", () => {
    expect(kinds("Which bugs come up most?", "Now, how did people react to 42.3?")).toEqual([]);
    expect(
      kinds("Which bugs come up most?", "Then what changed in September for the maps and the modes?"),
    ).toEqual([]);
  });
  it("takes a short fragment with no question word, or one or two words, for a follow-up", () => {
    expect(kinds("What are people complaining about?", "In July?")).toEqual(["complaint"]);
    expect(kinds("What are people complaining about?", "September?")).toEqual(["complaint"]);
    expect(kinds("What are people complaining about?", "Why?")).toEqual(["complaint"]);
    expect(kinds("What are people complaining about?", "What changed after 42.3?")).toEqual([]);
  });
});

describe("unaskedFlag", () => {
  const asked = (text: string) => [
    { role: "user" as const, content: "What are people complaining about?" },
    { role: "assistant" as const, content: "..." },
    { role: "user" as const, content: [{ type: "text" as const, text }] },
  ];
  it("reads the latest question only", () => {
    expect(lastQuestion(asked("How do players feel about Rondo?"))).toBe("How do players feel about Rondo?");
    expect(lastQuestion([])).toBe("");
  });
  it("is the flag when the latest question did not name it, and nothing when it did or there was none", () => {
    expect(unaskedFlag("complaint", asked("How do players feel about Rondo?"))).toBe("complaint");
    expect(unaskedFlag("complaint", asked("And the complaints about Rondo?"))).toBeUndefined();
    expect(unaskedFlag(undefined, asked("How do players feel about Rondo?"))).toBeUndefined();
  });
  it("takes a follow-up to ask about the kind the question before it named", () => {
    expect(unaskedFlag("complaint", asked("And in July?"))).toBeUndefined();
    expect(unaskedFlag("bug", asked("And in July?"))).toBe("bug");
  });
});

// Review 2026-09-26: the forced read's ", " fallback used questionInContext, which joins the question before only when
// it named a kind, so "And in July?" after a question about the new map scanned for "And in July?".
describe("followUpContext", () => {
  it("joins a follow-up to the question before it, whether or not either names a kind", () => {
    expect(followUpContext(["What do people say about the new map?", "And in July?"])).toBe(
      "What do people say about the new map?\nAnd in July?",
    );
    expect(questionInContext(["What do people say about the new map?", "And in July?"])).toBe("And in July?");
  });
  it("carries a chain of follow-ups back to the full question", () => {
    expect(
      followUpContext(["What do people say about the new map?", "And in July?", "What about August?"]),
    ).toBe("What do people say about the new map?\nAnd in July?\nWhat about August?");
  });
  it("leaves a full question as it is, a full question about feelings too", () => {
    expect(
      followUpContext(["What do people say about the new map?", "Which weapons are people talking about?"]),
    ).toBe("Which weapons are people talking about?");
    expect(followUpContext(["What do people say about the new map?", "How do players feel?"])).toBe(
      "How do players feel?",
    );
    expect(followUpContext(["And in July?"])).toBe("And in July?");
    expect(followUpContext([])).toBe("");
  });

  // Review 2026-09-26: the flags' feelings exclusion had been inherited, and the read lost the new map.
  it("carries the subject into a follow-up about feelings, which flags still never narrow", () => {
    const qs = ["What do people say about the new map?", "And how did they feel in July?"];
    expect(followUpContext(qs)).toBe("What do people say about the new map?\nAnd how did they feel in July?");
    expect(followUpContext(["What do people say about the new map?", "And how do they feel?"])).toBe(
      "What do people say about the new map?\nAnd how do they feel?",
    );
    expect(questionInContext(["What are people complaining about?", "And how did they feel in July?"])).toBe(
      "And how did they feel in July?",
    );
  });
});
