import { describe, expect, it } from "vitest";
import { placeTip, sheetInsets } from "./placement";

describe("sheetInsets", () => {
  it("anchors the sheet to the page column, clear of the sidebar", () => {
    // 1024 px window, sidebar 264 px, the page column from 264 to 1016.
    expect(sheetInsets({ left: 264, right: 1016 }, 1024)).toEqual({ left: 276, right: 20 });
  });
  it("on a phone, where the column is the whole window, keeps the plain 12 px gutter", () => {
    expect(sheetInsets({ left: 0, right: 375 }, 375)).toEqual({ left: 12, right: 12 });
  });
  it("never goes negative when the column is scrolled or wider than the window", () => {
    expect(sheetInsets({ left: -20, right: 400 }, 375)).toEqual({ left: 12, right: 12 });
  });
});

describe("placeTip", () => {
  const viewport = { width: 375, height: 812 };
  const tip = { width: 200, height: 70 };

  it("centres above the square when there is room", () => {
    expect(placeTip({ x: 180, top: 400, bottom: 432 }, tip, viewport)).toEqual({ left: 80, top: 322 });
  });
  it("stays inside the right edge for a square near it", () => {
    expect(placeTip({ x: 360, top: 400, bottom: 432 }, tip, viewport).left).toBe(375 - 8 - 200);
  });
  it("stays inside the left edge for a square near it", () => {
    expect(placeTip({ x: 10, top: 400, bottom: 432 }, tip, viewport).left).toBe(8);
  });
  it("drops below the square when there is no room above", () => {
    expect(placeTip({ x: 180, top: 40, bottom: 72 }, tip, viewport).top).toBe(80);
  });
  // QA 2026-09-26: over a top-row square the tooltip covered the month names.
  it("goes below a square when above it would reach over the dates (the ceiling is the top of the squares)", () => {
    expect(placeTip({ x: 180, top: 350, bottom: 382, ceiling: 300 }, tip, viewport).top).toBe(390);
    expect(placeTip({ x: 180, top: 400, bottom: 432, ceiling: 300 }, tip, viewport).top).toBe(322); // room above: as before
  });
  it("stays above the ceiling only when there is no room below either", () => {
    expect(placeTip({ x: 180, top: 750, bottom: 782, ceiling: 740 }, tip, viewport).top).toBe(672);
  });
  it("a tooltip wider than the window starts at the margin", () => {
    expect(placeTip({ x: 150, top: 400, bottom: 432 }, { width: 400, height: 70 }, { width: 300, height: 600 }).left).toBe(8);
  });
});
