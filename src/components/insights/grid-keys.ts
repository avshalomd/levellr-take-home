// The Explore grid's keyboard focus, as pure arithmetic so every key is testable without a browser. Pinned by
// grid-keys.test.ts.
//
// The focus is one spot on a board one row and one column larger than the squares: row -1 is the dates along the top
// and column -1 the topic names down the side. A click on a topic name or a date takes its whole row or column, and
// until QA 2026-09-26 only a mouse could do that: the names and dates were out of the Tab order and the arrows stopped
// at the first square. Now ArrowLeft from the first column reaches the topic name, ArrowUp from the top row reaches
// the date, Enter or Space there selects the line, and ArrowRight / ArrowDown lead back into the squares. The corner
// (-1, -1) is nothing and is never reached.

import { moveFocus, pointerDown, selectColumn, selectRow, toggleCell, type CellId, type Dir, type Selection } from "@/lib/data/insights-selection";

/** A square ({r, c} both >= 0), a topic name ({r, c: -1}) or a date ({r: -1, c}). */
export type Spot = CellId;

export const isRowHead = (s: Spot) => s.c === -1 && s.r >= 0;
export const isColHead = (s: Spot) => s.r === -1 && s.c >= 0;
export const isCell = (s: Spot) => s.r >= 0 && s.c >= 0;

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

/** The modifiers a key selects with. "Add squares" (`adding`, the phone sheet's switch) makes every selection add, as
 *  Cmd/Ctrl does (review 2026-09-26: clicks honoured it, and Enter on a square or a header still started afresh). */
export const keyMods = (e: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }, adding: boolean) => ({
  shift: e.shiftKey,
  toggle: e.metaKey || e.ctrlKey || adding,
});

/** A spot kept on the board when the grid shrinks under it (Weeks -> Months drops columns). A header stays a header. */
export function clampSpot(s: Spot, rows: number, cols: number): Spot {
  const r = clamp(s.r, -1, rows - 1);
  const c = clamp(s.c, -1, cols - 1);
  if (r === -1 && c === -1) return { r: 0, c: 0 };
  return r === s.r && c === s.c ? s : { r, c };
}

/** Where an arrow key, Home or End takes the focus from `s`. */
export function moveSpot(s: Spot, dir: Dir, rows: number, cols: number): Spot {
  if (isRowHead(s)) {
    // Down the topic names; Right goes back into the row's first square, End to its last.
    if (dir === "up") return { r: clamp(s.r - 1, 0, rows - 1), c: -1 };
    if (dir === "down") return { r: clamp(s.r + 1, 0, rows - 1), c: -1 };
    if (dir === "right") return { r: s.r, c: 0 };
    if (dir === "end") return { r: s.r, c: cols - 1 };
    return s;
  }
  if (isColHead(s)) {
    // Along the dates; Down goes back into the column's top square.
    if (dir === "left") return { r: -1, c: clamp(s.c - 1, 0, cols - 1) };
    if (dir === "right") return { r: -1, c: clamp(s.c + 1, 0, cols - 1) };
    if (dir === "down") return { r: 0, c: s.c };
    if (dir === "home") return { r: -1, c: 0 };
    if (dir === "end") return { r: -1, c: cols - 1 };
    return s;
  }
  if (dir === "left" && s.c === 0) return { r: s.r, c: -1 };
  if (dir === "up" && s.r === 0) return { r: -1, c: s.c };
  return moveFocus(s, dir, rows, cols); // Home stays the row's first square, as in a spreadsheet
}

/** The element for a spot, inside the grid's scroller: the square, or the topic name or date button. */
export function spotSelector(s: Spot): string {
  if (isRowHead(s)) return `[data-head="row"][data-r="${s.r}"]`;
  if (isColHead(s)) return `[data-head="col"][data-c="${s.c}"]`;
  return `[data-cell="${s.r}:${s.c}"]`;
}

/**
 * What Space or Enter selects at `s`. On a topic name or a date both take the whole row or column afresh, as a click
 * does, with Shift and Cmd/Ctrl as with a click. Space used to add the line to the selection instead, so with a row
 * taken, Space on a date left 27 squares where Enter and a click leave 13, and the panel described a selection the
 * reader had not made (QA 2026-09-26). On a square, Space adds or removes it (a spreadsheet's Space), Enter starts
 * afresh.
 */
export function selectOnKey(
  sel: Selection,
  s: Spot,
  key: " " | "Enter",
  keys: { shift: boolean; toggle: boolean },
  rows: number,
  cols: number,
): Selection {
  if (isRowHead(s)) return selectRow(sel, s.r, cols, keys);
  if (isColHead(s)) return selectColumn(sel, s.c, rows, keys);
  return key === " " ? toggleCell(sel, s) : pointerDown(sel, s, keys);
}
