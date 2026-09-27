import { describe, expect, it } from "vitest";
import { instructions, timeBefore } from "./instructions";

// The standing instructions are prose, so this only pins the rules behind the reader's numbers and this community's
// facts: "now" is the last message, the channels and their games, the brief's three questions, and the one unit.
const veil = {
  community: "Veil of Ages Discord",
  platform: "Discord",
  about: "",
  from: "2026-09-13",
  to: "2026-09-27",
  now: "2026-09-27T19:30:00.000Z",
};
const text = instructions(veil);

describe("instructions, the rules carried over", () => {
  it("asks for one scan per slice", () => {
    expect(text).toMatch(/Scan a slice once/);
  });
  it("keeps a scan's slice size apart from its relevant count", () => {
    expect(text).toMatch(/never give the slice's size as the number\s+of conversations that say something/);
  });
  it("filters to a flag only when the question asks for it", () => {
    expect(text).toMatch(
      /Filter to a flag \(excited, frustrated, bug, requests for changes, help\) only when/,
    );
  });
});

describe("instructions, this community", () => {
  it("counts relative dates back from the last message, not the clock", () => {
    expect(text).toMatch(/Now is 2026-09-27 19:30 UTC, the time of the last message/);
    expect(text).toMatch(/"The last 3 days" or "the last\s+few days" is since 2026-09-24T19:30Z/);
    expect(text).toMatch(/the last 7 days, since\s+2026-09-20T19:30Z/);
    expect(text).toMatch(/Never set `until` for a\s+period that runs to now/);
  });
  it("names the channels and the game each is about", () => {
    expect(text).toMatch(/new-release-discussion, new-release-spoilers: Bushido/);
    expect(text).toMatch(/remaster-discussion, remaster-spoilers: Tides Remastered/);
    expect(text).toMatch(/upcoming-releases: Hollow/);
  });
  it("routes the brief's three questions", () => {
    expect(text).toMatch(/"what are people excited about" -> scan with filters.flag excited/);
    expect(text).toMatch(/"what frustrates people" -> scan with filters.flag frustrated/);
    expect(text).toMatch(/"what should we post \(this week\)"[\s\S]*"Suggestion:"[\s\S]*not\s+findings/);
  });
  // Production QA 2026-09-27 (P4): post ideas ranked by engagement first, each on two conversations or said to be thin.
  it("ranks what to post by engagement and grounds each suggestion in two conversations", () => {
    expect(text).toMatch(/"what should we post \(this week\)" -> first aggregate engagement by topic/);
    expect(text).toMatch(/at least\s+two different conversations/);
    expect(text).toMatch(/only one\s+conversation shows\s+this\)", or leave it out\. A note at the end does not do this for it/);
  });
  // P3, P8, P10, P12, P17.
  it("reads a follow-up's slice, keeps message dates as written, and says when a period is outside", () => {
    expect(text).toMatch(/"which of those are bugs\?"[\s\S]*is a new read/);
    expect(text).toMatch(/quote it as the message writes it/);
    expect(text).toMatch(/never call it upcoming, past/);
    expect(text).toMatch(/is still counted or read with the tools over the period asked/);
    expect(text).toMatch(/says the conversations do not cover that period, never that there were none/);
    expect(text).toMatch(/Each point once/);
    expect(text).toMatch(/"rose 51%", never "rose by \+51%"/);
  });
  it("measures what resonates as engagement, never reactions alone", () => {
    expect(text).toMatch(/Engagement is\s+distinct authors \+ replies \+ reactions per conversation/);
    expect(text).toMatch(/never call\s+something resonating from reactions alone/);
  });
  it("says the unit is the conversation, a 15-minute session in one channel", () => {
    expect(text).toMatch(
      /Everything is counted by conversation: the messages in one channel with no gap over 15 minutes/,
    );
  });
});

describe("timeBefore", () => {
  it("is the moment the given number of days before now, to the minute", () => {
    expect(timeBefore("2026-09-27T19:30:00.000Z", 3)).toBe("2026-09-24T19:30Z");
    expect(timeBefore("2026-09-27T19:30:00.000Z", 7)).toBe("2026-09-20T19:30Z");
  });
});

// QA 2026-09-27: "What are people saying about multiplayer and co-op?" read every conversation; "patch 1.2" and a
// "cancelled" Ebontide were answered as if true; "sentiment on Reddit" was answered from Discord unsaid.
describe("instructions, subjects and premises", () => {
  it("lists the topics by name and key, and reads a topic's subject as that topic", () => {
    const t = instructions(veil, [{ key: "multiplayer-and-co-op", name: "Multiplayer and co-op" }]);
    expect(t).toContain("- Multiplayer and co-op (multiplayer-and-co-op)");
    expect(t).toMatch(/scan with\s+filters\.topic set to its key, never every\s+conversation/);
  });
  // Eval 2026-09-27: with every topic subject sent to a topic scan, lookups ("How hard is the new Domains mode?", "What
  // crashes did people report?") read a whole topic and led with its mood; find answers them from the messages.
  it("sends a specific question inside a topic to find, and gives a mood only when asked", () => {
    const t = instructions(veil, [{ key: "domains", name: "Domains" }]);
    expect(t).toMatch(/A specific question inside a topic is not a broad one/);
    expect(t).toMatch(/Those go to find first, with no topic filter/);
    expect(text).toMatch(/-> find, even when a topic covers it/);
    expect(text).toMatch(/Give a mood only when the question asks how people feel/);
  });
  it("checks a premise before answering, and says when another platform is asked about", () => {
    expect(text).toMatch(/Check a question's premise before answering it/);
    expect(text).toMatch(/Never describe reactions to a thing the conversations do not show/);
    expect(text).toMatch(/A question about another platform or\s+community \(Reddit/);
  });
});

