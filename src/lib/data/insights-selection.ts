import type { Agg } from "./insights-model";

// Selection geometry for the Explore grid, as pure functions over (row, column) indices so every gesture is testable
// without a browser. The model is a spreadsheet's: a selection is a set of cells, an anchor where the current gesture
// began, and a base - what was selected before that gesture - so a drag can grow and shrink its rectangle freely
// without eating cells chosen earlier with Cmd/Ctrl.

export type CellId = { r: number; c: number };
export type Mods = { shift?: boolean; toggle?: boolean }; // toggle = Cmd on a Mac, Ctrl elsewhere

export type Selection = {
  cells: ReadonlySet<string>;
  anchor: CellId | null;
  base: ReadonlySet<string>;
  mode: "add" | "subtract"; // a Cmd-drag that began on a selected cell removes instead of adds
};

export const EMPTY_SELECTION: Selection = { cells: new Set(), anchor: null, base: new Set(), mode: "add" };

export const cellKey = (r: number, c: number) => `${r}:${c}`;
export const parseKey = (k: string): CellId => {
  const [r, c] = k.split(":").map(Number);
  return { r, c };
};

/** Every cell in the rectangle spanned by two corners, inclusive, in either order. */
export function rect(a: CellId, b: CellId): Set<string> {
  const out = new Set<string>();
  for (let r = Math.min(a.r, b.r); r <= Math.max(a.r, b.r); r++)
    for (let c = Math.min(a.c, b.c); c <= Math.max(a.c, b.c); c++) out.add(cellKey(r, c));
  return out;
}

const union = (a: ReadonlySet<string>, b: ReadonlySet<string>) => new Set([...a, ...b]);
const minus = (a: ReadonlySet<string>, b: ReadonlySet<string>) => new Set([...a].filter((k) => !b.has(k)));

function compose(base: ReadonlySet<string>, span: Set<string>, mode: Selection["mode"]) {
  return mode === "add" ? union(base, span) : minus(base, span);
}

/** Pointer down on a cell. Plain: that cell alone. Shift: the rectangle from the anchor. Cmd/Ctrl: add or remove it. */
export function pointerDown(sel: Selection, cell: CellId, mods: Mods = {}): Selection {
  if (mods.shift && sel.anchor) {
    return { ...sel, cells: compose(sel.base, rect(sel.anchor, cell), sel.mode) };
  }
  if (mods.toggle) {
    const mode = sel.cells.has(cellKey(cell.r, cell.c)) ? "subtract" : "add";
    return { cells: compose(sel.cells, rect(cell, cell), mode), anchor: cell, base: sel.cells, mode };
  }
  const only = rect(cell, cell);
  return { cells: only, anchor: cell, base: new Set(), mode: "add" };
}

/** A cell kept inside a grid of rows x cols (the grid can shrink under it when the resolution changes). */
export function clampCell(cell: CellId, rows: number, cols: number): CellId {
  const r = Math.max(0, Math.min(cell.r, rows - 1));
  const c = Math.max(0, Math.min(cell.c, cols - 1));
  return r === cell.r && c === cell.c ? cell : { r, c };
}

/** A finger tap. Touch has no Cmd key, so "Add squares" on the phone sheet plays its part: a tap then adds or removes one
 *  square and keeps the rest, which is how a phone reaches the comparison. Without it a tap starts a new selection. */
export function tap(sel: Selection, cell: CellId, adding: boolean): Selection {
  return pointerDown(sel, cell, { toggle: adding });
}

/** The pointer moved onto another cell while pressed: the gesture's rectangle now runs from the anchor to here. */
export function pointerMove(sel: Selection, cell: CellId): Selection {
  if (!sel.anchor) return sel;
  return { ...sel, cells: compose(sel.base, rect(sel.anchor, cell), sel.mode) };
}

/** A whole row (a topic across every period). Shift extends over the rows from the anchor; Cmd/Ctrl adds or removes. */
export function selectRow(sel: Selection, r: number, cols: number, mods: Mods = {}): Selection {
  return selectLine(sel, rect({ r, c: 0 }, { r, c: cols - 1 }), { r, c: 0 }, mods, (a) => rect({ r: a.r, c: 0 }, { r, c: cols - 1 }));
}

/** A whole column (every topic in one period). Shift extends over the columns from the anchor. */
export function selectColumn(sel: Selection, c: number, rows: number, mods: Mods = {}): Selection {
  return selectLine(sel, rect({ r: 0, c }, { r: rows - 1, c }), { r: 0, c }, mods, (a) => rect({ r: 0, c: a.c }, { r: rows - 1, c }));
}

function selectLine(
  sel: Selection,
  line: Set<string>,
  anchor: CellId,
  mods: Mods,
  spanFromAnchor: (a: CellId) => Set<string>,
): Selection {
  if (mods.shift && sel.anchor) return { ...sel, cells: compose(sel.base, spanFromAnchor(sel.anchor), sel.mode) };
  if (mods.toggle) {
    const mode = [...line].every((k) => sel.cells.has(k)) ? "subtract" : "add";
    return { cells: compose(sel.cells, line, mode), anchor, base: sel.cells, mode };
  }
  return { cells: line, anchor, base: new Set(), mode: "add" };
}

export type Dir = "up" | "down" | "left" | "right" | "home" | "end";

/** Arrow keys move the focus cell, clamped to the grid. Home/End jump to the row's first and last period. */
export function moveFocus(focus: CellId, dir: Dir, rows: number, cols: number): CellId {
  const clamp = (x: number, n: number) => Math.max(0, Math.min(n - 1, x));
  switch (dir) {
    case "up":
      return { r: clamp(focus.r - 1, rows), c: focus.c };
    case "down":
      return { r: clamp(focus.r + 1, rows), c: focus.c };
    case "left":
      return { r: focus.r, c: clamp(focus.c - 1, cols) };
    case "right":
      return { r: focus.r, c: clamp(focus.c + 1, cols) };
    case "home":
      return { r: focus.r, c: 0 };
    case "end":
      return { r: focus.r, c: cols - 1 };
  }
}

/** Shift+arrow: extend from the anchor (set to the old focus if the gesture is new) to the new focus. */
export function extendTo(sel: Selection, from: CellId, to: CellId): Selection {
  if (!sel.anchor || !sel.cells.size) return { cells: rect(from, to), anchor: from, base: new Set(), mode: "add" };
  return pointerMove(sel, to);
}

/** Space: toggle one cell in or out without touching the rest. */
export function toggleCell(sel: Selection, cell: CellId): Selection {
  return pointerDown(sel, cell, { toggle: true });
}

export const selectAll = (rows: number, cols: number): Selection =>
  rows && cols
    ? { cells: rect({ r: 0, c: 0 }, { r: rows - 1, c: cols - 1 }), anchor: { r: 0, c: 0 }, base: new Set(), mode: "add" }
    : EMPTY_SELECTION;

/** The selected cells as (row, column) pairs, row-major. */
export function selectedCells(sel: Selection): CellId[] {
  return [...sel.cells].map(parseKey).sort((a, b) => a.r - b.r || a.c - b.c);
}

/** A stable string for a selection, for caching the detail fetch. */
export const selectionId = (sel: Selection) => selectedCells(sel).map((x) => cellKey(x.r, x.c)).join(",");

/** Cells collapsed to one date range per row: consecutive columns merge. What the detail query takes. */
export function rowRuns(cells: CellId[]): { r: number; from: number; to: number }[] {
  const byRow = new Map<number, number[]>();
  for (const { r, c } of cells) byRow.set(r, [...(byRow.get(r) ?? []), c]);
  const out: { r: number; from: number; to: number }[] = [];
  for (const [r, cs] of [...byRow.entries()].sort((a, b) => a[0] - b[0])) {
    const sorted = [...new Set(cs)].sort((a, b) => a - b);
    let from = sorted[0], prev = sorted[0];
    for (const c of sorted.slice(1)) {
      if (c === prev + 1) { prev = c; continue; }
      out.push({ r, from, to: prev });
      from = prev = c;
    }
    out.push({ r, from, to: prev });
  }
  return out;
}

/** The outlines the grid draws around a selection: each row's runs, stacked into one box where consecutive rows share
 * the same span - so a dragged rectangle gets a single outline, and a scattered selection one per piece. */
export function selectionBoxes(cells: CellId[]): { r0: number; r1: number; c0: number; c1: number }[] {
  const boxes: { r0: number; r1: number; c0: number; c1: number }[] = [];
  for (const run of rowRuns(cells)) {
    const open = boxes.find((b) => b.r1 === run.r - 1 && b.c0 === run.from && b.c1 === run.to);
    if (open) open.r1 = run.r;
    else boxes.push({ r0: run.r, r1: run.r, c0: run.from, c1: run.to });
  }
  return boxes;
}

/**
 * The selection split into separate blocks: groups of cells that touch side by side (not corner to corner). A drag
 * makes one block; Cmd/Ctrl-clicking a second region makes two, which the panel reads as "compare this with that".
 * Ordered by where they start in time, then down the grid, so the earlier block is the one compared.
 */
export function blocks(cells: CellId[]): CellId[][] {
  const left = new Set(cells.map((x) => cellKey(x.r, x.c)));
  const out: CellId[][] = [];
  for (const start of cells) {
    if (!left.delete(cellKey(start.r, start.c))) continue;
    const group: CellId[] = [start];
    for (let i = 0; i < group.length; i++) {
      const { r, c } = group[i];
      for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const k = cellKey(r + dr, c + dc);
        if (left.delete(k)) group.push({ r: r + dr, c: c + dc });
      }
    }
    out.push(group.sort((a, b) => a.r - b.r || a.c - b.c));
  }
  const minC = (g: CellId[]) => Math.min(...g.map((x) => x.c));
  const minR = (g: CellId[]) => Math.min(...g.map((x) => x.r));
  return out.sort((a, b) => minC(a) - minC(b) || minR(a) - minR(b));
}

/**
 * The selection's totals as the panel shows them (D46). A conversation touching two topics sits in both topics' rows,
 * so summing cells from two rows counts it twice. Cells in ONE row never share a conversation (each starts in one
 * period), so their sum is exact and shows at once. Across rows only the server's count of distinct conversations is
 * right, so the panel shows a placeholder (null) until it arrives. The server's totals win whenever they are in.
 */
export function selectionTotals(cellSum: Agg, cells: CellId[], server: Agg | null): Agg | null {
  if (server) return server;
  return new Set(cells.map((x) => x.r)).size <= 1 ? cellSum : null;
}
