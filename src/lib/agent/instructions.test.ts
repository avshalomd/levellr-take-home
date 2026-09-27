import { describe, expect, it } from "vitest";
import { daysBefore, instructions } from "./instructions";

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
      /Filter to a flag \(excited, frustrated, bugs, requests for changes, help\) only when/,
    );
  });
});

describe("instructions, this community", () => {
  it("counts relative dates back from the last message, not the clock", () => {
    expect(text).toMatch(/Now is 2026-09-27 19:30 UTC, the time of the last message/);
    expect(text).toMatch(/"The last 3 days" or "the last few days" is since\s+2026-09-24/);
    expect(text).toMatch(/the last 7 days, since 2026-09-20/);
  });
  it("names the channels and the game each is about", () => {
    expect(text).toMatch(/new-release-discussion, new-release-spoilers: Bushido/);
    expect(text).toMatch(/remaster-discussion, remaster-spoilers: Tides Remastered/);
    expect(text).toMatch(/upcoming-releases: Hollow/);
  });
  it("routes the brief's three questions", () => {
    expect(text).toMatch(/"what are people excited about" -> scan with filters.flag excited/);
    expect(text).toMatch(/"what frustrates people" -> scan with filters.flag frustrated/);
    expect(text).toMatch(/"what should we post \(this week\)"[\s\S]*"Suggestion:"[\s\S]*not findings/);
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

describe("daysBefore", () => {
  it("is the day the given number of days before now", () => {
    expect(daysBefore("2026-09-27T19:30:00.000Z", 3)).toBe("2026-09-24");
    expect(daysBefore("2026-09-27T19:30:00.000Z", 7)).toBe("2026-09-20");
  });
});
