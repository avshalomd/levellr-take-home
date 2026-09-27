import { describe, expect, it } from "vitest";
import {
  EMPTY_SELECTION,
  blocks,
  extendTo,
  moveFocus,
  pointerDown,
  tap,
  cellKey,
  clampCell,
  pointerMove,
  rect,
  rowRuns,
  selectAll,
  selectColumn,
  selectRow,
  selectedCells,
  selectionBoxes,
  selectionId,
  toggleCell,
  type Selection,
  selectionTotals,
} from "./insights-selection";

const keys = (s: Selection) => [...s.cells].sort();

describe("rectangle drag", () => {
  it("a press selects one cell at once, before any movement", () => {
    const s = pointerDown(EMPTY_SELECTION, { r: 1, c: 2 });
    expect(keys(s)).toEqual(["1:2"]);
    expect(s.anchor).toEqual({ r: 1, c: 2 });
  });

  it("dragging grows the rectangle from the anchor, in any direction, and can shrink it again", () => {
    let s = pointerDown(EMPTY_SELECTION, { r: 1, c: 2 });
    s = pointerMove(s, { r: 2, c: 4 });
    expect(keys(s)).toEqual(["1:2", "1:3", "1:4", "2:2", "2:3", "2:4"]);
    s = pointerMove(s, { r: 0, c: 1 }); // back past the anchor, up and left
    expect(keys(s)).toEqual(["0:1", "0:2", "1:1", "1:2"]);
    s = pointerMove(s, { r: 1, c: 2 });
    expect(keys(s)).toEqual(["1:2"]);
  });

  it("rect is inclusive and order-free", () => {
    expect(rect({ r: 2, c: 3 }, { r: 1, c: 2 })).toEqual(rect({ r: 1, c: 2 }, { r: 2, c: 3 }));
    expect(rect({ r: 0, c: 0 }, { r: 0, c: 0 }).size).toBe(1);
  });

  it("a plain press starts over", () => {
    let s = pointerDown(EMPTY_SELECTION, { r: 0, c: 0 });
    s = pointerMove(s, { r: 3, c: 3 });
    s = pointerDown(s, { r: 5, c: 5 });
    expect(keys(s)).toEqual(["5:5"]);
  });
});

describe("shift extends", () => {
  it("from the anchor to the shift-clicked cell, replacing the previous rectangle", () => {
    let s = pointerDown(EMPTY_SELECTION, { r: 0, c: 0 });
    s = pointerDown(s, { r: 1, c: 2 }, { shift: true });
    expect(keys(s)).toEqual(["0:0", "0:1", "0:2", "1:0", "1:1", "1:2"]);
    s = pointerDown(s, { r: 0, c: 1 }, { shift: true }); // shrink: the anchor stays at 0:0
    expect(keys(s)).toEqual(["0:0", "0:1"]);
  });

  it("with no anchor, acts as a plain press", () => {
    expect(keys(pointerDown(EMPTY_SELECTION, { r: 2, c: 2 }, { shift: true }))).toEqual(["2:2"]);
  });

  it("keeps cells added earlier with Cmd", () => {
    let s = pointerDown(EMPTY_SELECTION, { r: 0, c: 0 });
    s = pointerDown(s, { r: 3, c: 3 }, { toggle: true });
    s = pointerDown(s, { r: 3, c: 5 }, { shift: true }); // extends from the Cmd anchor 3:3
    expect(keys(s)).toEqual(["0:0", "3:3", "3:4", "3:5"]);
  });
});

describe("cmd/ctrl toggles", () => {
  it("adds an unselected cell and removes a selected one, leaving the rest", () => {
    let s = pointerDown(EMPTY_SELECTION, { r: 0, c: 0 });
    s = pointerDown(s, { r: 2, c: 2 }, { toggle: true });
    expect(keys(s)).toEqual(["0:0", "2:2"]);
    s = pointerDown(s, { r: 0, c: 0 }, { toggle: true });
    expect(keys(s)).toEqual(["2:2"]);
  });

  it("a Cmd-drag adds a rectangle, or removes one when it began on a selected cell", () => {
    let s = pointerDown(EMPTY_SELECTION, { r: 0, c: 0 });
    s = pointerDown(s, { r: 1, c: 1 }, { toggle: true });
    s = pointerMove(s, { r: 1, c: 2 });
    expect(keys(s)).toEqual(["0:0", "1:1", "1:2"]);
    s = pointerDown(s, { r: 1, c: 1 }, { toggle: true }); // on a selected cell: subtract mode
    s = pointerMove(s, { r: 1, c: 2 });
    expect(keys(s)).toEqual(["0:0"]);
  });

  it("Space toggles the focused cell the same way", () => {
    const s = toggleCell(pointerDown(EMPTY_SELECTION, { r: 0, c: 0 }), { r: 0, c: 1 });
    expect(keys(s)).toEqual(["0:0", "0:1"]);
  });
});

describe("rows and columns", () => {
  it("a topic label selects its whole row; shift takes the rows between", () => {
    let s = selectRow(EMPTY_SELECTION, 1, 3);
    expect(keys(s)).toEqual(["1:0", "1:1", "1:2"]);
    s = selectRow(s, 3, 3, { shift: true });
    expect(keys(s)).toEqual(["1:0", "1:1", "1:2", "2:0", "2:1", "2:2", "3:0", "3:1", "3:2"]);
  });

  it("a column header selects every topic in that period; shift takes the columns between", () => {
    let s = selectColumn(EMPTY_SELECTION, 2, 2);
    expect(keys(s)).toEqual(["0:2", "1:2"]);
    s = selectColumn(s, 0, 2, { shift: true });
    expect(keys(s)).toEqual(["0:0", "0:1", "0:2", "1:0", "1:1", "1:2"]);
  });

  it("cmd adds a row, and removes it when the whole row is already in", () => {
    let s = selectRow(EMPTY_SELECTION, 0, 2);
    s = selectRow(s, 2, 2, { toggle: true });
    expect(keys(s)).toEqual(["0:0", "0:1", "2:0", "2:1"]);
    s = selectRow(s, 0, 2, { toggle: true });
    expect(keys(s)).toEqual(["2:0", "2:1"]);
  });

  it("select all takes every cell", () => {
    expect(selectAll(2, 3).cells.size).toBe(6);
    expect(selectAll(0, 3).cells.size).toBe(0);
  });
});

describe("keyboard", () => {
  it("arrows move the focus and stop at the edges", () => {
    expect(moveFocus({ r: 0, c: 0 }, "up", 3, 4)).toEqual({ r: 0, c: 0 });
    expect(moveFocus({ r: 0, c: 0 }, "right", 3, 4)).toEqual({ r: 0, c: 1 });
    expect(moveFocus({ r: 2, c: 3 }, "down", 3, 4)).toEqual({ r: 2, c: 3 });
    expect(moveFocus({ r: 1, c: 2 }, "home", 3, 4)).toEqual({ r: 1, c: 0 });
    expect(moveFocus({ r: 1, c: 2 }, "end", 3, 4)).toEqual({ r: 1, c: 3 });
  });

  it("shift+arrows extend from where the gesture began", () => {
    let s = extendTo(EMPTY_SELECTION, { r: 1, c: 1 }, { r: 1, c: 2 });
    expect(keys(s)).toEqual(["1:1", "1:2"]);
    s = extendTo(s, { r: 1, c: 2 }, { r: 2, c: 2 });
    expect(keys(s)).toEqual(["1:1", "1:2", "2:1", "2:2"]);
  });
});

describe("reading a selection", () => {
  it("lists cells row-major and ids them stably", () => {
    let s = pointerDown(EMPTY_SELECTION, { r: 1, c: 1 });
    s = pointerMove(s, { r: 0, c: 0 });
    expect(selectedCells(s)).toEqual([
      { r: 0, c: 0 },
      { r: 0, c: 1 },
      { r: 1, c: 0 },
      { r: 1, c: 1 },
    ]);
    expect(selectionId(s)).toBe("0:0,0:1,1:0,1:1");
  });

  it("merges consecutive periods per topic into one range", () => {
    expect(
      rowRuns([
        { r: 0, c: 1 },
        { r: 0, c: 2 },
        { r: 0, c: 3 },
        { r: 0, c: 6 },
        { r: 2, c: 0 },
      ]),
    ).toEqual([
      { r: 0, from: 1, to: 3 },
      { r: 0, from: 6, to: 6 },
      { r: 2, from: 0, to: 0 },
    ]);
  });

  it("outlines a rectangle as one box and a scattered selection as one box per piece", () => {
    let s = pointerDown(EMPTY_SELECTION, { r: 1, c: 2 });
    s = pointerMove(s, { r: 3, c: 4 });
    expect(selectionBoxes(selectedCells(s))).toEqual([{ r0: 1, r1: 3, c0: 2, c1: 4 }]);
    s = pointerDown(s, { r: 5, c: 0 }, { toggle: true });
    s = pointerDown(s, { r: 2, c: 3 }, { toggle: true }); // punch a hole in the middle row
    expect(selectionBoxes(selectedCells(s))).toEqual([
      { r0: 1, r1: 1, c0: 2, c1: 4 },
      { r0: 2, r1: 2, c0: 2, c1: 2 },
      { r0: 2, r1: 2, c0: 4, c1: 4 },
      { r0: 3, r1: 3, c0: 2, c1: 4 },
      { r0: 5, r1: 5, c0: 0, c1: 0 },
    ]);
  });
});

describe("separate blocks", () => {
  const ids = (sel: { cells: ReadonlySet<string> }) => selectedCells(sel as never);
  it("a drag is one block, a Cmd-click elsewhere makes a second, ordered by time", () => {
    let s = pointerDown(EMPTY_SELECTION, { r: 1, c: 6 });
    s = pointerMove(s, { r: 2, c: 7 });
    s = pointerDown(s, { r: 0, c: 2 }, { toggle: true });
    const bs = blocks(ids(s));
    expect(bs).toHaveLength(2);
    expect(bs[0]).toEqual([{ r: 0, c: 2 }]); // earlier in time comes first, whatever the click order
    expect(bs[1]).toHaveLength(4);
  });

  it("cells that touch side by side join, an L-shape stays one block, corners do not join", () => {
    expect(blocks([{ r: 0, c: 0 }, { r: 0, c: 1 }, { r: 1, c: 1 }])).toHaveLength(1);
    expect(blocks([{ r: 0, c: 0 }, { r: 1, c: 1 }])).toHaveLength(2);
    expect(blocks([])).toEqual([]);
  });

  it("two topics in the same week, one row apart, are two blocks ordered down the grid", () => {
    const bs = blocks([{ r: 3, c: 5 }, { r: 1, c: 5 }]);
    expect(bs.map((b) => b[0].r)).toEqual([1, 3]);
  });
});

describe("finger taps", () => {
  it("a plain tap starts over; in Add squares mode it adds a separate square and a second tap takes it away", () => {
    let s = tap(EMPTY_SELECTION, { r: 0, c: 0 }, false);
    s = tap(s, { r: 3, c: 4 }, false);
    expect([...s.cells]).toEqual([cellKey(3, 4)]);
    s = tap(s, { r: 0, c: 0 }, true);
    expect(new Set(s.cells)).toEqual(new Set([cellKey(3, 4), cellKey(0, 0)]));
    s = tap(s, { r: 0, c: 0 }, true);
    expect([...s.cells]).toEqual([cellKey(3, 4)]);
  });
});

describe("clampCell", () => {
  it("keeps a focus inside a grid that shrank under it, and returns the same cell when it still fits", () => {
    expect(clampCell({ r: 3, c: 14 }, 13, 4)).toEqual({ r: 3, c: 3 }); // weeks -> months
    const fits = { r: 1, c: 1 };
    expect(clampCell(fits, 13, 4)).toBe(fits);
    expect(clampCell({ r: 5, c: 5 }, 0, 0)).toEqual({ r: 0, c: 0 });
  });
});

// D46: a conversation touching two topics sits in both rows, so a sum of squares across rows counts it twice.
describe("selectionTotals", () => {
  const agg = (n: number) => ({ n, engagement: n, messages: n, moodSum: 0, moodN: 0, people: n });

  it("shows the squares' sum at once when they are all in one topic's row", () => {
    expect(selectionTotals(agg(7), [{ r: 2, c: 0 }, { r: 2, c: 1 }], null)).toEqual(agg(7));
  });
  it("waits for the server's count of distinct conversations when the squares span topic rows", () => {
    expect(selectionTotals(agg(7), [{ r: 0, c: 0 }, { r: 1, c: 0 }], null)).toBeNull();
    // Two cells of 4 and 3 that share one conversation hold 6 conversations, not 7: the server's count wins.
    expect(selectionTotals(agg(7), [{ r: 0, c: 0 }, { r: 1, c: 0 }], agg(6))).toEqual(agg(6));
  });
});
