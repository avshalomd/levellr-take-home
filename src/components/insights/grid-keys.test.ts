import { describe, expect, it } from "vitest";
import { EMPTY_SELECTION, selectRow } from "@/lib/data/insights-selection";
import { clampSpot, keyMods, moveSpot, selectOnKey, spotSelector } from "./grid-keys";

// QA 2026-09-26: a topic name or a date selects its whole row or column, but the arrows stopped at the first square,
// so only a mouse could reach them. A 3-topic x 4-period grid.
const R = 3;
const C = 4;

describe("moveSpot", () => {
  it("ArrowLeft from the first square reaches the topic name, ArrowRight leads back", () => {
    expect(moveSpot({ r: 1, c: 0 }, "left", R, C)).toEqual({ r: 1, c: -1 });
    expect(moveSpot({ r: 1, c: -1 }, "right", R, C)).toEqual({ r: 1, c: 0 });
  });

  it("ArrowUp from the top row reaches the date, ArrowDown leads back", () => {
    expect(moveSpot({ r: 0, c: 2 }, "up", R, C)).toEqual({ r: -1, c: 2 });
    expect(moveSpot({ r: -1, c: 2 }, "down", R, C)).toEqual({ r: 0, c: 2 });
  });

  it("inside the squares the arrows move as before, and Home stays on the row's first square", () => {
    expect(moveSpot({ r: 1, c: 2 }, "left", R, C)).toEqual({ r: 1, c: 1 });
    expect(moveSpot({ r: 1, c: 2 }, "up", R, C)).toEqual({ r: 0, c: 2 });
    expect(moveSpot({ r: 1, c: 2 }, "home", R, C)).toEqual({ r: 1, c: 0 });
    expect(moveSpot({ r: 2, c: 3 }, "down", R, C)).toEqual({ r: 2, c: 3 });
  });

  it("moves along the topic names and along the dates, and stops at their ends", () => {
    expect(moveSpot({ r: 0, c: -1 }, "down", R, C)).toEqual({ r: 1, c: -1 });
    expect(moveSpot({ r: 0, c: -1 }, "up", R, C)).toEqual({ r: 0, c: -1 }); // never the empty corner
    expect(moveSpot({ r: 0, c: -1 }, "left", R, C)).toEqual({ r: 0, c: -1 });
    expect(moveSpot({ r: -1, c: 0 }, "left", R, C)).toEqual({ r: -1, c: 0 }); // never the empty corner
    expect(moveSpot({ r: -1, c: 0 }, "right", R, C)).toEqual({ r: -1, c: 1 });
    expect(moveSpot({ r: -1, c: 3 }, "right", R, C)).toEqual({ r: -1, c: 3 });
    expect(moveSpot({ r: -1, c: 1 }, "up", R, C)).toEqual({ r: -1, c: 1 });
  });

  it("End and Home keep to their line from a name or a date", () => {
    expect(moveSpot({ r: 2, c: -1 }, "end", R, C)).toEqual({ r: 2, c: 3 });
    expect(moveSpot({ r: -1, c: 2 }, "home", R, C)).toEqual({ r: -1, c: 0 });
    expect(moveSpot({ r: -1, c: 0 }, "end", R, C)).toEqual({ r: -1, c: 3 });
  });
});

describe("clampSpot", () => {
  it("keeps a name or a date a header when the grid shrinks under it", () => {
    expect(clampSpot({ r: -1, c: 9 }, R, C)).toEqual({ r: -1, c: 3 });
    expect(clampSpot({ r: 5, c: -1 }, R, C)).toEqual({ r: 2, c: -1 });
    expect(clampSpot({ r: 5, c: 9 }, R, C)).toEqual({ r: 2, c: 3 });
  });
  it("returns the same object when nothing changes, and never the corner", () => {
    const s = { r: 1, c: 1 };
    expect(clampSpot(s, R, C)).toBe(s);
    expect(clampSpot({ r: -1, c: -1 }, R, C)).toEqual({ r: 0, c: 0 });
  });
});

describe("spotSelector", () => {
  it("names the square, the topic-name button or the date button", () => {
    expect(spotSelector({ r: 1, c: 2 })).toBe('[data-cell="1:2"]');
    expect(spotSelector({ r: 1, c: -1 })).toBe('[data-head="row"][data-r="1"]');
    expect(spotSelector({ r: -1, c: 2 })).toBe('[data-head="col"][data-c="2"]');
  });
});

// QA 2026-09-26: with a row taken, Space on a date added the column (27 squares) where Enter and a click replace it (13).
describe("selectOnKey", () => {
  const plain = { shift: false, toggle: false };
  const row1 = selectRow(EMPTY_SELECTION, 1, C);

  it("takes a date's column afresh on Space, exactly as on Enter", () => {
    for (const key of [" ", "Enter"] as const) {
      const sel = selectOnKey(row1, { r: -1, c: 2 }, key, plain, R, C);
      expect([...sel.cells].sort(), key).toEqual(["0:2", "1:2", "2:2"]);
    }
  });

  it("takes a topic's row afresh on Space, exactly as on Enter", () => {
    const col = selectOnKey(EMPTY_SELECTION, { r: -1, c: 0 }, "Enter", plain, R, C);
    for (const key of [" ", "Enter"] as const) expect(selectOnKey(col, { r: 2, c: -1 }, key, plain, R, C).cells.size, key).toBe(C);
  });

  it("adds the line with Cmd/Ctrl, as a click does", () => {
    expect(selectOnKey(row1, { r: -1, c: 2 }, " ", { shift: false, toggle: true }, R, C).cells.size).toBe(C + R - 1);
  });

  // Review 2026-09-26: with "Add squares" on, a click added and a key started afresh.
  it("adds with Enter on a square or a header while 'Add squares' is on, as a click does", () => {
    const noKeys = { shiftKey: false, metaKey: false, ctrlKey: false };
    expect(selectOnKey(row1, { r: 0, c: 0 }, "Enter", keyMods(noKeys, true), R, C).cells.size).toBe(C + 1);
    expect(selectOnKey(row1, { r: -1, c: 2 }, "Enter", keyMods(noKeys, true), R, C).cells.size).toBe(C + R - 1);
    expect(selectOnKey(row1, { r: 0, c: 0 }, "Enter", keyMods(noKeys, false), R, C).cells.size).toBe(1);
    expect(keyMods({ ...noKeys, ctrlKey: true }, false)).toEqual({ shift: false, toggle: true });
  });

  it("on a square, Space adds or removes it and Enter starts afresh", () => {
    expect(selectOnKey(row1, { r: 0, c: 0 }, " ", plain, R, C).cells.size).toBe(C + 1);
    expect(selectOnKey(row1, { r: 1, c: 0 }, " ", plain, R, C).cells.size).toBe(C - 1);
    expect([...selectOnKey(row1, { r: 0, c: 0 }, "Enter", plain, R, C).cells]).toEqual(["0:0"]);
  });
});
