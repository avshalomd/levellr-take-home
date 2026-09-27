import { describe, expect, it } from "vitest";
import { citedIn, groupClaims, lastWord, morePillWords, offeredQuestion, sentenceCuts, splitClosing } from "./claims";

type El = { text: string };
const textOf = (e: El) => e.text;
const flat = (pieces: (string | El)[]) => pieces.map((p) => (typeof p === "string" ? p : p.text)).join("");

describe("sentenceCuts", () => {
  it("cuts after a full stop followed by a capital", () => {
    const s = "Stutter is the top issue [msg1]. People blame the patch [msg2, msg3].";
    expect(sentenceCuts(s)).toEqual([s.indexOf("People")]);
  });

  it("keeps a citation written after the full stop with the sentence it follows", () => {
    const s = "It crashed on launch. [msg7] Then it was fixed.";
    const [cut] = sentenceCuts(s);
    expect(s.slice(0, cut)).toBe("It crashed on launch. [msg7] ");
  });

  it("does not cut inside a number or before a lower-case word", () => {
    expect(sentenceCuts("Version 43.1 shipped. then people complained")).toEqual([]);
  });
});

describe("citedIn", () => {
  it("lists each tag once, in order of appearance", () => {
    expect(citedIn("a [msg2, msg1] b [msg2] c [msg9]")).toEqual(["msg2", "msg1", "msg9"]);
  });
});

describe("groupClaims", () => {
  it("maps each sentence to the messages it cites", () => {
    const claims = groupClaims<El>(["Stutter is the top issue [msg1]. People blame the patch [msg2, msg3]. No one mentions refunds."], textOf);
    expect(claims.map((c) => c.tags)).toEqual([["msg1"], ["msg2", "msg3"], []]);
  });

  it("keeps a bold phrase inside the sentence it belongs to", () => {
    const pieces: (string | El)[] = ["Players say ", { text: "matchmaking is slow" }, " since the update [msg4]. Others disagree [msg5]."];
    const claims = groupClaims(pieces, textOf);
    expect(claims).toHaveLength(2);
    expect(claims[0].pieces).toHaveLength(3);
    expect(claims[0].tags).toEqual(["msg4"]);
    expect(claims[1].tags).toEqual(["msg5"]);
  });

  it("reads a citation inside an element", () => {
    const claims = groupClaims<El>(["Bots are everywhere ", { text: "[msg8]" }, "."], textOf);
    expect(claims.map((c) => c.tags)).toEqual([["msg8"]]);
  });

  it("loses and reorders nothing: the claims render the block unchanged", () => {
    const pieces: (string | El)[] = ["One [msg1]. ", { text: "Two" }, " is here [msg2]. Three.  "];
    const claims = groupClaims(pieces, textOf);
    expect(claims.map((c) => flat(c.pieces)).join("")).toBe(flat(pieces));
  });

  it("treats a bullet with no sentence end as one claim", () => {
    expect(groupClaims<El>(["Crashes after the patch [msg3, msg4]"], textOf)).toEqual([{ pieces: ["Crashes after the patch [msg3, msg4]"], tags: ["msg3", "msg4"] }]);
  });
});

describe("lastWord", () => {
  it("splits before the last word, keeping its trailing space", () => {
    expect(lastWord("moving gear into vehicles. ")).toEqual(["moving gear into ", "vehicles. "]);
    expect(lastWord("one")).toEqual(["", "one"]);
  });
  it("leaves whitespace alone", () => {
    expect(lastWord(" ")).toEqual(["", " "]);
    expect(lastWord("")).toEqual(["", ""]);
  });
});

describe("splitClosing", () => {
  // QA 2026-09-26: "+N more" sat after the full stop, at the start of the next sentence.
  it("cuts the punctuation that ends a claim, and the space after it, off its last piece", () => {
    expect(splitClosing(["Lag is up [msg1]. "])).toEqual([["Lag is up [msg1]"], ".", " "]);
    expect(splitClosing<El>(["Lag is ", { text: "up" }, " again?!"])).toEqual([["Lag is ", { text: "up" }, " again"], "?!", ""]);
  });
  it("drops a last piece that was only the punctuation", () => {
    expect(splitClosing<El>([{ text: "Lag [msg1]" }, "."])).toEqual([[{ text: "Lag [msg1]" }], ".", ""]);
  });
  it("returns a claim with no closing punctuation whole", () => {
    expect(splitClosing(["Queues are long [msg2]"])).toEqual([["Queues are long [msg2]"], "", ""]);
    expect(splitClosing<El>(["Queues ", { text: "long." }])).toEqual([["Queues ", { text: "long." }], "", ""]);
  });
});

// QA 2026-09-26: "I can't access live weather data." was a dead end; the answer now offers questions, a tap each.
describe("offeredQuestion", () => {
  it("takes a bullet that is one short question", () => {
    expect(offeredQuestion(" What are people saying about the new map? ")).toBe("What are people saying about the new map?");
  });
  it("leaves evidence, statements and long or several sentences alone", () => {
    expect(offeredQuestion("Queues are long [msg2].")).toBeNull();
    expect(offeredQuestion("Is lag worse [scan]?")).toBeNull();
    expect(offeredQuestion("Lag is up. Why?")).toBeNull();
    expect(offeredQuestion("Why?")).toBeNull();
    expect(offeredQuestion(`${"a".repeat(170)}?`)).toBeNull();
  });
});

// QA 2026-09-26: three chips and "+3 more" sat beside a panel saying "5 conversations say this. 2 are cited". Chips are
// one per conversation now (evidence.ts onePerConversation), and the pill counts conversations too.
describe("morePillWords", () => {
  it("counts in conversations: how many say it, how many are cited, how many more", () => {
    expect(morePillWords({ conversations: 5, moreTotal: 3 })).toBe("5 conversations say this: 2 cited in the answer, 3 more");
    expect(morePillWords({ conversations: 1240, moreTotal: 1238 })).toBe("1,240 conversations say this: 2 cited in the answer, 1,238 more");
  });
  it("never says a cited count of nothing", () => {
    expect(morePillWords({ conversations: 3, moreTotal: 3 })).toBe("3 conversations say this: 3 more");
  });
});
