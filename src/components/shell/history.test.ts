import { describe, expect, it } from "vitest";
import { chatIdOf, clipTitle, groupChats } from "./history";

const at = (iso: string, id = iso) => ({ id, title: id, updated_at: iso });

describe("groupChats", () => {
  const now = new Date(2026, 8, 25, 18, 0); // 25 Sep, local time

  it("groups by day, newest first, and leaves out empty groups", () => {
    const chats = [
      at(new Date(2026, 8, 25, 9).toISOString(), "this-morning"),
      at(new Date(2026, 8, 25, 17).toISOString(), "just-now"),
      at(new Date(2026, 8, 24, 12).toISOString(), "yesterday"),
      at(new Date(2026, 8, 1, 12).toISOString(), "old"),
    ];
    expect(groupChats(chats, now).map((g) => [g.label, g.chats.map((c) => c.id)])).toEqual([
      ["Today", ["just-now", "this-morning"]],
      ["Yesterday", ["yesterday"]],
      ["Earlier", ["old"]],
    ]);
  });

  it("puts the last week in its own group", () => {
    expect(groupChats([at(new Date(2026, 8, 20, 12).toISOString())], now)[0].label).toBe("Previous 7 days");
  });
});

describe("chatIdOf", () => {
  it("reads the chat id from a chat path only", () => {
    expect(chatIdOf("/c/abc-123")).toBe("abc-123");
    expect(chatIdOf("/")).toBeNull();
    expect(chatIdOf("/insights")).toBeNull();
    expect(chatIdOf(null)).toBeNull();
  });
});

// QA 2026-09-26: the Undo toast cut the chat's title mid-word ("…cheaters i…").
describe("clipTitle", () => {
  it("leaves a title that fits alone", () => {
    expect(clipTitle("How do players feel about the update?")).toBe("How do players feel about the update?");
  });
  it("cuts a long title at a word boundary, with an ellipsis and no dangling punctuation", () => {
    const t = "What do people say about cheaters in ranked matches since the patch?";
    const out = clipTitle(t);
    expect(out).toBe("What do people say about cheaters in…");
    expect(out.length).toBeLessThanOrEqual(40);
    expect(clipTitle("Why are players angry about cheaters, and bans lately?")).toBe("Why are players angry about cheaters…");
  });
  it("cuts inside one very long word rather than leave a stub", () => {
    expect(clipTitle("Anti-" + "x".repeat(60))).toBe(`Anti-${"x".repeat(34)}…`);
  });
});
