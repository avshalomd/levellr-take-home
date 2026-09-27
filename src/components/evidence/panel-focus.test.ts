import { describe, expect, it } from "vitest";
import { nearestScroll, returnTarget, stripScrollBehavior, wrapTarget } from "./panel-focus";

// Stand-ins for DOM elements: only what returnTarget reads.
const el = (connected: boolean, name = "el") => ({ name, isConnected: connected }) as unknown as HTMLElement;
const answer = (connected: boolean, chip: HTMLElement | null) =>
  ({ isConnected: connected, querySelector: (sel: string) => (sel === '[data-cite="msg12"]' ? chip : null) }) as unknown as Element;

describe("returnTarget", () => {
  it("goes back to the chip that opened the panel", () => {
    const chip = el(true);
    expect(returnTarget({ el: chip, cite: "msg12", scope: answer(true, null) })).toBe(chip);
  });

  it("finds the same citation in the same answer when the chip was drawn again", () => {
    const fresh = el(true, "fresh");
    expect(returnTarget({ el: el(false), cite: "msg12", scope: answer(true, fresh) })).toBe(fresh);
  });

  it("gives up, rather than guess, when the answer itself is gone or the opener was not a chip", () => {
    expect(returnTarget({ el: el(false), cite: "msg12", scope: answer(false, el(true)) })).toBeNull();
    expect(returnTarget({ el: el(false), scope: answer(true, el(true)) })).toBeNull();
  });
});

describe("wrapTarget", () => {
  // The sheet's content in page order; "code" is a scrolling box the browser made focusable, which the list omits.
  const page = ["sheet", "close", "tab", "code", "row", "tail"];
  const precedes = (a: string, b: string) => page.indexOf(a) < page.indexOf(b);
  const items = ["close", "tab", "row"];
  const wrap = (current: string | null, back: boolean) => wrapTarget(items, current, back, precedes, "sheet");

  it("wraps Tab from the last element to the first, and Shift+Tab from the first to the last", () => {
    expect(wrap("row", false)).toBe("close");
    expect(wrap("close", true)).toBe("row");
  });

  it("wraps from the sheet itself, which has focus right after it opens", () => {
    expect(wrap(null, true)).toBe("row");
    expect(wrap("sheet", true)).toBe("row");
    expect(wrap("sheet", false)).toBe("close");
  });

  it("leaves every move inside the sheet to the browser", () => {
    expect(wrap("close", false)).toBeNull();
    expect(wrap("tab", false)).toBeNull();
    expect(wrap("tab", true)).toBeNull();
    expect(wrap("row", true)).toBeNull();
  });

  // Review 2026-09-26: an element the list did not name was taken for one outside, and Tab jumped to the top.
  it("reads an unlisted element by its place in the page", () => {
    expect(wrap("code", false)).toBeNull();
    expect(wrap("code", true)).toBeNull();
    expect(wrap("tail", false)).toBe("close");
  });

  it("does nothing in a sheet with nothing to focus", () => {
    expect(wrapTarget([], null, false, precedes)).toBeNull();
  });
});

describe("nearestScroll", () => {
  const view = { left: 100, right: 500 };

  it("does not move a tab that is already in view", () => {
    expect(nearestScroll(view, { left: 120, right: 200 }, 20)).toBe(0);
  });

  it("scrolls the least distance to bring a tab in, with room beside it", () => {
    expect(nearestScroll(view, { left: 480, right: 560 }, 20)).toBe(80); // hidden past the right edge
    expect(nearestScroll(view, { left: 40, right: 120 }, 20)).toBe(-80); // hidden past the left edge
  });
});

// Review 2026-09-26: picking a message from the "+N more" list brings the tab strip back as a new element, at its
// start; it must jump to the open tab, not glide there from the first one.
describe("stripScrollBehavior", () => {
  it("jumps on a strip just put on the page, and glides on one already showing", () => {
    expect(stripScrollBehavior(true, false)).toBe("auto");
    expect(stripScrollBehavior(false, false)).toBe("smooth");
  });
  it("never glides for a reader who asks for less motion", () => {
    expect(stripScrollBehavior(false, true)).toBe("auto");
  });
});
