import { describe, expect, it } from "vitest";
import { CHIP_TEXT, cardPlacement, chipClass } from "./CitationChip";

const rect = (left: number, top: number, width: number, height: number) => ({ left, top, right: left + width, bottom: top + height });
const CARD = { width: 288, height: 150 };

// QA 2026-09-26: at 1440px with the evidence column open, a chip near the chat's left edge had its card start at x246,
// while the chat is cut off at x264.
describe("cardPlacement", () => {
  const chat = rect(264, 0, 696, 900); // the chat's scroller between the sidebar and the evidence column

  it("centres the card over a chip with room on both sides", () => {
    expect(cardPlacement(rect(600, 400, 18, 18), chat, CARD)).toEqual({ shift: 0, below: false });
  });

  it("slides the card right, inside the clipping box, for a chip near its left edge", () => {
    const chip = rect(390, 400, 18, 18); // centred, the card would start at 399 - 144 = 255
    const { shift } = cardPlacement(chip, chat, CARD);
    expect(399 - 144 + shift).toBe(264 + 8);
  });

  it("slides the card left for a chip near the right edge", () => {
    const chip = rect(940, 400, 18, 18);
    const { shift } = cardPlacement(chip, chat, CARD);
    expect(949 - 144 + shift + CARD.width).toBe(960 - 8);
  });

  it("drops the card below a chip with no room above it", () => {
    expect(cardPlacement(rect(600, 60, 18, 18), chat, CARD).below).toBe(true);
    expect(cardPlacement(rect(600, 300, 18, 18), chat, CARD).below).toBe(false);
  });
});

// QA 2026-09-26: the chip's number measured 4.41:1 in the light theme. The contrast is measured in the browser by
// e2e/chat.spec.ts; this pins which classes carry it.
describe("chipClass", () => {
  it("darkens a chip's number in the light theme and keeps the accent in the dark", () => {
    expect(chipClass("backed")).toContain(CHIP_TEXT);
    expect(chipClass("backed")).not.toMatch(/(^| )text-pulse( |$)/);
  });

  it("gives a selected chip white on the solid accent in the dark theme, and no darkened text", () => {
    const on = chipClass("backed", true);
    expect(on).toContain("dark:bg-pulse-solid");
    expect(on).toContain("text-white");
    expect(on).not.toContain("dark:text-pulse");
  });
});
