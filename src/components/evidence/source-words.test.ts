import { describe, expect, it } from "vitest";
import { compact, engagement, loudness, mapHint, moreWords, placeWords, readableText, topicNamesOf } from "./source-words";

const reddit = { platform: "Reddit", community: "r/somecommunity" };
const discord = { platform: "Discord", community: "Some Server" };

describe("compact", () => {
  it("keeps small numbers whole and shortens large ones", () => {
    expect([0, 7, 999, 1000, 1234, 9950, 12500, 1_250_000].map(compact)).toEqual(["0", "7", "999", "1k", "1.2k", "10k", "13k", "1.3M"]);
  });
  it("keeps the sign of a downvoted message", () => {
    expect(compact(-4)).toBe("−4");
    expect(compact(-1500)).toBe("−1.5k");
  });
});

describe("engagement", () => {
  // QA 2026-09-26: the panel said "62 votes" and "62 points", Explore "+75 net votes".
  it("calls a Reddit score net votes, spelled out in full on hover", () => {
    expect(engagement(reddit, 1234)).toEqual({ kind: "votes", short: "1.2k", long: "1,234 net votes: upvotes minus downvotes", unit: "net votes" });
    expect(engagement(reddit, 1).long).toBe("1 net vote: upvotes minus downvotes");
    expect(engagement(reddit, 1).unit).toBe("net vote");
    expect(engagement(reddit, -3).long).toBe("-3 net votes: upvotes minus downvotes");
    expect(engagement(reddit, 62).long).not.toMatch(/points?\b/);
  });
  it("calls a Discord score reactions", () => {
    expect(engagement(discord, 12)).toEqual({ kind: "reactions", short: "12", long: "12 reactions", unit: "reactions" });
    expect(engagement(discord, 1).unit).toBe("reaction");
  });
  it("uses a neutral word when the platform is unknown", () => {
    expect(engagement(undefined, 5)).toEqual({ kind: "score", short: "5", long: "Score 5", unit: "score" });
    expect(engagement({ platform: "Forum" }, 5).kind).toBe("score");
  });
});

describe("placeWords", () => {
  it("puts a Reddit thread in its community, with the flair as a tag", () => {
    expect(placeWords(reddit, "Discussion")).toEqual({ where: "r/somecommunity", tag: "Discussion" });
  });
  it("puts a Discord message in its #channel", () => {
    expect(placeWords(discord, "general")).toEqual({ where: "#general", tag: "Some Server" });
  });
  it("falls back to whatever the data names", () => {
    expect(placeWords(undefined, "help")).toEqual({ where: "help", tag: null });
    expect(placeWords({ community: "c" }, "")).toEqual({ where: "c", tag: null });
  });
});

describe("loudness", () => {
  it("is 0 for nothing or less, 1 for the loudest, and log-scaled in between", () => {
    expect(loudness(0, 100)).toBe(0);
    expect(loudness(-5, 100)).toBe(0);
    expect(loudness(100, 100)).toBe(1);
    expect(loudness(10, 1000)).toBeGreaterThan(0.3);
    expect(loudness(10, 1000)).toBeLessThan(0.4);
  });
});

describe("readableText", () => {
  // QA 2026-09-25: a card read "\*drives through metal road barrier\*" and "\-Working as intended".
  it("drops markdown escapes and decodes Reddit's entities, leaving the rest as typed", () => {
    expect(readableText("\\*drives through metal road barrier\\*")).toBe("*drives through metal road barrier*");
    expect(readableText("\\-Working as intended")).toBe("-Working as intended");
    expect(readableText("a &gt; b &amp;&amp; c &lt; d")).toBe("a > b && c < d");
    expect(readableText("C:\\path and a\\nb")).toBe("C:\\path and a\\nb");
  });
});

// QA 2026-09-26: "tap one to open it" on a desktop with a mouse.
describe("mapHint", () => {
  it("says select, not tap, in both pictures, with the platform's engagement word", () => {
    expect(mapHint("tree", "votes")).toBe("Each dot is a message, each line a reply. Bigger dots drew more net votes; select one to open it.");
    expect(mapHint("tree", "score")).toContain("drew more engagement");
    expect(mapHint("timeline", "reactions")).toBe(
      "Each branch is a reply chain; top-level messages hang from the conversation. Bigger dots drew more reactions; select one to open it.",
    );
    for (const h of [mapHint("tree", "reactions"), mapHint("timeline", "votes")]) expect(h).not.toMatch(/\btap\b/i);
  });
});

// QA 2026-09-26: the "+1 more" list said "the other 1 are below".
describe("moreWords", () => {
  it("agrees every count with its verb", () => {
    expect(moreWords(2, 1, 1, 1)).toBe("2 conversations say this. 1 is cited in the answer; the other one is below.");
    expect(moreWords(5, 2, 3, 3)).toBe("5 conversations say this. 2 are cited in the answer; the other 3 are below.");
    expect(moreWords(40, 0, 12, 40)).toBe("40 conversations say this. The 12 clearest are below.");
    expect(moreWords(3, 0, 3, 3)).toBe("3 conversations say this. All 3 are below.");
    expect(moreWords(1200, 1, 1, 1199)).toBe("1,200 conversations say this. 1 is cited in the answer; the clearest of the other 1,199 is below.");
  });
});

describe("topicNamesOf", () => {
  const names = new Map([
    ["bugs", "Bugs and crashes"],
    ["pricing", "Prices"],
  ]);
  it("names every topic of the conversation, primary first", () => {
    expect(topicNamesOf(["pricing", "bugs"], names)).toEqual(["Prices", "Bugs and crashes"]);
  });
  it("leaves out other and unlabelled, which nobody tracks", () => {
    expect(topicNamesOf(["other"], names)).toEqual([]);
    expect(topicNamesOf(["unlabelled"], names)).toEqual([]);
    expect(topicNamesOf(undefined, names)).toEqual([]);
  });
  it("reads a key with no name as its words", () => {
    expect(topicNamesOf(["anti-cheat"], names)).toEqual(["anti cheat"]);
  });
});
