"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import {
  activityIntensity,
  axisLabels,
  divergingColor,
  divergingSpread,
  divergingT,
  formatShort,
  formatValue,
  fmtInt,
  inkPair,
  metricValue,
  monthName,
  MIN_RELIABLE,
  moodOf,
  monthSpans,
  moodVersus,
  periodLabel,
  reliability,
  volumeColor,
  type Agg,
  type GridCell,
  type GridData,
  type Metric,
} from "@/lib/data/insights-model";
import {
  cellKey,
  extendTo,
  pointerDown,
  pointerMove,
  selectAll,
  selectColumn,
  selectedCells,
  selectionBoxes,
  selectRow,
  tap,
  EMPTY_SELECTION,
  type CellId,
  type Dir,
  type Selection,
} from "@/lib/data/insights-selection";
import { columnTitle, periodWords, rowTitle } from "./explore-words";
import { clampSpot, isCell, isColHead, isRowHead, keyMods, moveSpot, selectOnKey, spotSelector, type Spot } from "./grid-keys";
import { placeTip } from "./placement";

type Props = {
  data: GridData;
  names: Map<string, string>;
  metric: Metric;
  selection: Selection;
  onSelect: (s: Selection) => void;
  narrow: boolean;
  /** Phone "Add squares" mode: a tap adds to the selection instead of replacing it (the touch stand-in for Cmd). */
  adding?: boolean;
};

// Geometry per resolution: the day view is 99 narrow columns (it scrolls), weeks and months fill the width.
// A day square is 13px wide, under the 24px minimum target (QA 2026-09-26, at 375). Decided: its width stays. 99 days at
// 15px a day cannot give each a 24px target without covering the next day, and 24px days would make the phone's strip
// 2,400px long. Instead the height carries the minimum (26px, 30px on a phone), the gaps belong to the squares (the
// `--hit` pseudo-element below) so no tap lands on nothing, a date takes its whole column in one tap, and the keyboard
// reaches every square, name and date. Pinned by e2e/explore.spec.ts.
const GEOM = {
  day: { col: 13, gap: 2, row: 26, radius: 3 },
  week: { col: 30, gap: 4, row: 32, radius: 6 },
  month: { col: 120, gap: 6, row: 36, radius: 8 },
} as const;

/** A month's narrowest square on a phone. At 120px, four months made the grid 636px in a 343px scroller, so it scrolled
 * and opened on the last month, with the numbers hidden (QA 2026-09-26). At 44px four months fit beside the slim topic
 * column and still hold a number like "1,234" at 12px. Set in CSS (the grid's container query), so the first paint has
 * it, and written out whole so Tailwind finds the classes: GEOM.month.col, else 44px in a phone-wide grid column. */
export const MONTH_COL = "[--col-min:120px] @max-[640px]:[--col-min:44px]";

/** How far a square's fill fades while a selection is active and the square is not in it. Only the fill: the number on
 * it takes its own ink for the faded colour (QA 2026-09-26: the element's opacity faded the numbers to 2.0-3.3:1). */
const DIM = 0.42;

/** A topic row's height, as the CSS variable every square and name in the row reads. Days on a phone take 30px, not 26:
 * that is where a long name wraps onto two 13px lines, and two such names in rows one above the other nearly touched
 * (QA 2026-09-26). A class, not a measurement, so the first paint already has it. Pinned by Grid.test.tsx. */
export const ROW_HEIGHT = {
  day: "[--row-h:26px] @max-[640px]:[--row-h:30px]",
  week: "[--row-h:32px]",
  month: "[--row-h:36px]",
} as const;

const EDGE = 4; // px kept free at the grid's right edge; see `squares` in Grid

// `ink`: the number's colour on this square in each theme (insights-model.ts inkPair). A square resting on too few
// conversations is faded through its colour's alpha, not the element's opacity, which faded its number too. `dim`: the
// same square while a selection it is not in is active, faded the same way, with the ink for that fainter colour.
type Ink = { light: string; dark: string };
type Paint = { background: string; intensity: number; reliable: boolean; ink: Ink; dim: { background: string; ink: Ink } };

/** A CSS colour faded to `alpha` over whatever is behind it (composited in sRGB, as insights-model's ink picker models). */
const fade = (colour: string, alpha: number) => `color-mix(in srgb, ${colour} ${Math.round(alpha * 100)}%, transparent)`;

/** Colour every square for what the grid shows: the only thing that changes when the switch does. Activity is one scale
 * across the whole grid; mood diverges around the average of every conversation in the dataset. */
function usePaint(data: GridData, metric: Metric) {
  return useMemo(() => {
    const paint = new Map<string, Paint>();
    if (metric === "activity") {
      const max = Math.max(0, ...data.cells.map((c) => c.n));
      for (const c of data.cells) {
        const i = activityIntensity(c.n, max);
        paint.set(`${c.topic}|${c.p}`, {
          background: volumeColor(i),
          intensity: i,
          reliable: true,
          ink: inkPair({ metric, value: i, alpha: 1 }),
          dim: { background: fade(volumeColor(i), DIM), ink: inkPair({ metric, value: i, alpha: DIM }) },
        });
      }
    } else {
      const norm = moodOf(data.norm);
      const spread = divergingSpread(data.cells.filter((c) => c.n >= MIN_RELIABLE).map(moodOf), norm);
      for (const c of data.cells) {
        const t = divergingT(moodOf(c), norm, spread);
        const alpha = reliability(c.n);
        paint.set(`${c.topic}|${c.p}`, {
          background: alpha < 1 ? fade(divergingColor(t), alpha) : divergingColor(t),
          intensity: Math.abs(t),
          reliable: c.n >= MIN_RELIABLE,
          ink: inkPair({ metric, value: t, alpha }),
          dim: { background: fade(divergingColor(t), alpha * DIM), ink: inkPair({ metric, value: t, alpha: alpha * DIM }) },
        });
      }
    }
    return paint;
  }, [data, metric]);
}

const noop = () => () => {};

// A button clicks itself when Space comes back up, in some browsers even after its keydown was handled: the grid's
// keydown has already selected, so the key-up does nothing more (QA 2026-09-26).
const spaceUp = (e: KeyboardEvent) => e.key === " " && e.preventDefault();

// x: the square's centre; ceiling: the top of the squares, which the tooltip keeps below when it can (see placeTip)
type Hover = { r: number; c: number; x: number; top: number; bottom: number; ceiling: number } | null;

// Hover means a mouse or a trackpad. A phone has none: there a tap opens the sheet, and a tooltip left behind by the
// tap lingered over the grid (QA 2026-09-25). "any-hover", not "hover": an iPad with a trackpad is touch-first but
// its trackpad still hovers.
const canHover = () => typeof window !== "undefined" && window.matchMedia("(any-hover: hover)").matches;

export function Grid({ data, names, metric, selection, onSelect, narrow, adding = false }: Props) {
  const reduce = useReducedMotion();
  const g = GEOM[data.resolution];
  const rows = data.topics.length;
  const cols = data.periods.length;
  const paint = usePaint(data, metric);
  const at = useMemo(() => new Map(data.cells.map((c) => [`${c.topic}|${c.p}`, c])), [data.cells]);
  const labels = useMemo(() => axisLabels(data.periods, data.resolution), [data.periods, data.resolution]);
  const months = useMemo(() => monthSpans(data.periods, data.resolution), [data.periods, data.resolution]);
  const selected = useMemo(() => selectedCells(selection), [selection]);
  const boxes = useMemo(() => selectionBoxes(selected), [selected]);
  const hasSel = selection.cells.size > 0;

  const [rawFocus, setFocus] = useState<Spot>({ r: 0, c: Math.max(0, cols - 1) });
  // The grid's one tab stop: a square, or a topic name or date the arrows reached (grid-keys.ts). Weeks -> Months
  // drops the column count under a remembered focus, and a cell that no longer exists took the grid out of the tab
  // order (QA 2026-09-25), so the focus is always read clamped.
  const focus = clampSpot(rawFocus, rows, cols);
  const [hover, setHover] = useState<Hover>(null);
  const [scrolled, setScrolled] = useState({ left: false, right: false });
  const scroller = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; last: string; touch: boolean; moved: boolean; start: { x: number; y: number } } | null>(null);
  const lastPointer = useRef<string>("mouse"); // a finger has no hover: a tap shows the sheet, not a tooltip
  // A tap that selected: its touchend cancels the click the browser would fire next. The selection re-renders the
  // phone sheet taller before that click lands, so it hit the sheet's title and opened Details (QA 2026-09-25).
  const tapped = useRef(false);
  const selRef = useRef(selection);
  useEffect(() => {
    selRef.current = selection;
  }, [selection]);

  // The newest data is the most asked about: start scrolled to the end whenever the resolution changes. Months open at
  // the start: there are only a few, read left to right, and scrolled to the end a phone hid June and July and cut
  // "August" to "st" (QA 2026-09-26; they now fit a phone, so this matters only on a narrower screen).
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    el.scrollLeft = data.resolution === "month" ? 0 : el.scrollWidth;
    const onScroll = () => {
      setScrolled({ left: el.scrollLeft > 2, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 2 });
    };
    onScroll();
    el.addEventListener("scroll", onScroll, { passive: true });
    const ro = new ResizeObserver(onScroll);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", onScroll);
      ro.disconnect();
    };
  }, [data.resolution]);

  const cellFrom = (target: EventTarget | null): CellId | null => {
    const el = (target as HTMLElement | null)?.closest?.("[data-cell]") as HTMLElement | null;
    if (!el) return null;
    return { r: Number(el.dataset.r), c: Number(el.dataset.c) };
  };

  // The top of the squares is the tooltip's ceiling: above a square in the top rows it covered the month names while the arrows moved along them (QA 2026-09-26), so there it goes below the square instead.
  const hoverOn = (el: HTMLElement): Hover => {
    const b = el.getBoundingClientRect();
    const ceiling = body.current?.getBoundingClientRect().top ?? 0;
    return { r: Number(el.dataset.r), c: Number(el.dataset.c), x: b.left + b.width / 2, top: b.top, bottom: b.bottom, ceiling };
  };

  const showHover = (cell: CellId | null) => {
    if (!cell) return setHover(null);
    const el = body.current?.querySelector<HTMLElement>(`[data-cell="${cellKey(cell.r, cell.c)}"]`);
    setHover(el ? hoverOn(el) : null);
  };

  // The tooltip is fixed to the screen, so any scroll (the grid sideways, the page up or down) would leave it pointing
  // at the wrong square. Under a mouse it goes, and the next pointer move brings it back in the right place. Under the
  // keyboard it follows the focused square: moving the focus is itself what scrolls the grid, and a keyboard makes no
  // pointer move to bring the tooltip back.
  const tipShown = hover !== null;
  useEffect(() => {
    if (!tipShown) return;
    const follow = () => {
      const focused = document.activeElement as HTMLElement | null;
      if (lastPointer.current !== "keyboard" || !focused?.dataset.cell || !body.current?.contains(focused)) return setHover(null);
      setHover(hoverOn(focused));
    };
    window.addEventListener("scroll", follow, { capture: true, passive: true });
    return () => window.removeEventListener("scroll", follow, { capture: true });
  }, [tipShown]);

  const focusSpot = useCallback((spot: Spot) => {
    setFocus(spot);
    requestAnimationFrame(() => {
      scroller.current?.querySelector<HTMLElement>(spotSelector(spot))?.focus({ preventScroll: false });
    });
  }, []);

  /** A topic name or a date took the focus (by the arrows, or a click): it is now the grid's tab stop. */
  const onFocusHead = useCallback((spot: Spot) => {
    setFocus(spot);
    setHover(null);
  }, [setHover]);

  // ---- pointer: press selects at once, a drag grows a rectangle, touch taps (the grid scrolls under a finger) ----

  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    const cell = cellFrom(e.target);
    if (!cell) return;
    const touch = e.pointerType === "touch";
    lastPointer.current = e.pointerType;
    drag.current = { id: e.pointerId, last: cellKey(cell.r, cell.c), touch, moved: false, start: { x: e.clientX, y: e.clientY } };
    setFocus(cell);
    if (touch) {
      setHover(null);
      return; // decided on release, so a swipe can still scroll the grid
    }
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    (e.target as HTMLElement).closest<HTMLElement>("[data-cell]")?.focus({ preventScroll: true });
    onSelect(pointerDown(selRef.current, cell, { shift: e.shiftKey, toggle: e.metaKey || e.ctrlKey }));
  };

  const onPointerMove = (e: PointerEvent) => {
    const d = drag.current;
    if (!d) {
      if (e.pointerType === "mouse" && canHover()) showHover(cellFrom(e.target));
      return;
    }
    if (d.touch) {
      if (Math.hypot(e.clientX - d.start.x, e.clientY - d.start.y) > 8) d.moved = true;
      return;
    }
    // With the pointer captured, the target is the grid: find the cell under the pointer instead.
    const cell = cellFrom(document.elementFromPoint(e.clientX, e.clientY));
    const el = scroller.current;
    if (el) {
      const b = el.getBoundingClientRect();
      const edge = 36;
      if (e.clientX > b.right - edge) el.scrollLeft += Math.min(24, (e.clientX - (b.right - edge)) / 1.5);
      else if (e.clientX < b.left + (narrow ? 136 : 190) + edge) el.scrollLeft -= 12;
    }
    if (!cell) return;
    const k = cellKey(cell.r, cell.c);
    if (k === d.last) return;
    d.last = k;
    d.moved = true;
    setFocus(cell);
    onSelect(pointerMove(selRef.current, cell));
    if (canHover()) showHover(cell);
  };

  const onPointerUp = (e: PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.touch && !d.moved) {
      const cell = cellFrom(e.target);
      if (cell) {
        tapped.current = true;
        onSelect(tap(selRef.current, cell, adding));
      }
    }
  };

  // ---- keyboard: arrows move a focus spot (a square, or past the edge a topic name or a date, grid-keys.ts); Space
  // and Enter select it, the whole row or column on a name or a date; Shift+arrows extend; Esc clears ----

  const onKeyDown = (e: KeyboardEvent) => {
    lastPointer.current = "keyboard";
    const dirs: Record<string, Dir> = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right", Home: "home", End: "end" };
    const dir = dirs[e.key];
    if (dir) {
      e.preventDefault();
      const next = moveSpot(focus, dir, rows, cols);
      if (e.shiftKey && isCell(focus) && isCell(next)) onSelect(extendTo(selection, focus, next));
      focusSpot(next);
      return;
    }
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault(); // a name or a date is a button: without this it would also fire its click
      if (e.repeat) return; // a held key selects once
      onSelect(selectOnKey(selection, focus, e.key, keyMods(e, adding), rows, cols));
    } else if (e.key === "Escape") {
      e.preventDefault(); // cleared here: the page's own Esc handler (Explore) need not clear it again
      onSelect(EMPTY_SELECTION);
    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "a") {
      e.preventDefault();
      onSelect(selectAll(rows, cols));
    }
  };

  // The topic column's width (--label-w) is set in CSS against the grid's own column (see the outer div), so the first
  // paint on a phone already has the slim column rather than switching to it after a measurement.
  // Every period's narrowest square and the gap before it, and EDGE: room at the right for what the last column draws
  // past its edge, its squares' hit areas (half a gap) and a selection's outline (3px). Without it Months was 3px
  // wider than its scroller, so it scrolled, and the left fade came up over the first month (QA 2026-09-26).
  // The narrowest square is --col-min, which Months narrows on a phone (MONTH_COL).
  const squares = `calc(${cols} * (var(--col-min) + ${g.gap}px) + ${EDGE}px)`;
  const template: CSSProperties = {
    gridTemplateColumns: `var(--label-w) repeat(${cols}, minmax(var(--col-min), 1fr))`,
    columnGap: g.gap,
  };
  const minWidth = `calc(var(--label-w) + var(--squares))`;

  const hovered = hover ? { topic: data.topics[hover.r]?.key, period: data.periods[hover.c] } : null;
  const hoverCell = hovered?.topic && hovered.period ? at.get(`${hovered.topic}|${hovered.period.key}`) : undefined;

  // The sticky topic column is painted in the page's own colour: in dark mode the card colour is lighter than the
  // page, and the column read as a stack of grey bars beside the squares. Its edge shade, once the grid scrolls under
  // it, is one strip drawn over the whole column (below), not a shadow per cell: the rows' own shadow replaced it, so
  // only the header cells kept theirs and the edge read as a dashed line (QA 2026-09-25).
  // Layers, bottom up: squares, the edge fades (z-10), the pinned month names (z-20), the topic column (z-30), so a
  // month whose columns have all scrolled behind the topic column goes behind it too.
  const sticky = "sticky left-0 z-30 bg-background";

  // Weeks and months are meant to fit without scrolling. Their squares already stop at a minimum, so when the room is
  // a little short the topic column gives way instead, down to the phone's width: at 1024px with a classic scrollbar
  // the grid was 15px too wide and the last week sat behind a scrollbar (QA 2026-09-26). 100cqw is the grid's own
  // column (a size container in Explore), so an open side column is counted too. Days scroll anyway and keep the
  // full column; on a phone the column is the slim one throughout.
  const fits = data.resolution !== "day";
  // `isolate` keeps the grid's own layers (the pinned topic column and month names, the edge fades) inside the grid, so
  // none of them can paint over the phone's selection sheet or the app's header.
  return (
    <div
      className={cn(
        "relative isolate @max-[640px]:[--label-w:128px]",
        ROW_HEIGHT[data.resolution],
        fits ? "[--label-w:clamp(128px,calc(100cqw_-_var(--squares)),176px)]" : "[--label-w:176px]",
        data.resolution === "month" && MONTH_COL,
      )}
      style={{ "--squares": squares, ...(data.resolution === "month" ? {} : { "--col-min": `${g.col}px` }) } as CSSProperties}
    >
      <div
        ref={scroller}
        className="overflow-x-auto overscroll-x-contain [scrollbar-width:thin]"
        onPointerLeave={() => !drag.current && setHover(null)}
      >
        <div className="grid pb-1" style={{ ...template, minWidth, paddingRight: EDGE }}>
          {/* Month tier: each month spans its own columns, and its name is pinned just right of the topic column while
              the month is in view. Placed only where the month began, the name scrolled away behind the topic column and
              a phone showed days with no month (QA 2026-09-26). Its own background covers the last letters of the month
              before, pushed out from under it. Month view names its months in the tier below. */}
          <div className={cn(sticky, "row-start-1")} style={{ gridColumn: 1 }} />
          {months.map((m) => (
            <div key={`m${m.from}`} className="row-start-1 pb-0.5" style={{ gridColumn: `${m.from + 2} / ${m.to + 3}` }}>
              {data.resolution !== "month" && (
                <span
                  className="sticky z-20 inline-block bg-background pr-2 text-[13px] font-semibold whitespace-nowrap text-foreground"
                  style={{ left: "var(--label-w)" }}
                >
                  {m.name}
                </span>
              )}
            </div>
          ))}

          {/* Day tier: the column headers. Each is a button that selects its column. */}
          <div className={cn(sticky, "row-start-2")} style={{ gridColumn: 1 }} />
          {data.periods.map((p, i) => {
            const label = data.resolution === "month" ? labels[i].month : labels[i].day;
            return (
              <button
                key={`d${p.key}`}
                type="button"
                // Reached with ArrowUp from the top row (grid-keys.ts); outside the role=grid, so it carries the keys.
                tabIndex={isColHead(focus) && focus.c === i ? 0 : -1}
                data-head="col"
                data-c={i}
                onKeyDown={onKeyDown}
                onKeyUp={spaceUp}
                onFocus={() => onFocusHead({ r: -1, c: i })}
                onClick={(e) => onSelect(selectColumn(selection, i, rows, { shift: e.shiftKey, toggle: e.metaKey || e.ctrlKey || adding }))}
                title={columnTitle(periodWords(p, data.resolution, data.window))}
                aria-label={`Select ${periodLabel(p, data.resolution, data.window)}`}
                className={cn(
                  // The ring drawn inside: outside, the sticky topic column covered its left side on the first date.
                  "row-start-2 flex h-6 items-end rounded-sm pb-1 text-[12px] leading-none whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-offset-[-2px]",
                  data.resolution === "month" ? "text-[13px] font-semibold text-foreground" : "",
                  data.resolution === "day" ? "justify-start" : "justify-start pl-0.5",
                )}
                style={{ gridColumn: i + 2 }}
              >
                {/* The dashes alone mark a partial period: faded as well, the date read at 3.1:1 (QA 2026-09-26). */}
                <span className={cn(p.partial && "underline decoration-dashed decoration-foreground/35 underline-offset-[5px]")}>
                  {data.resolution === "month" ? (
                    // A phone's 44px month takes the short name: "September" would run into the next month.
                    <>
                      <span className="@max-[640px]:hidden">{label}</span>
                      <span className="hidden @max-[640px]:inline">{monthName(p.start, true)}</span>
                    </>
                  ) : (
                    (label ?? "")
                  )}
                </span>
              </button>
            );
          })}

          {/* Topic rows. The body is one focus stop (roving tabindex) and one pointer surface. */}
          <div
            ref={body}
            role="grid"
            aria-label="Topics by period. Arrow keys move, Space or Enter selects, Shift with arrows extends, Escape clears. Left from the first square reaches the topic and up from the top row the date, to select the whole row or column."
            aria-rowcount={rows}
            aria-colcount={cols}
            aria-multiselectable
            className="col-span-full grid outline-none select-none"
            style={{ ...template, gridTemplateColumns: "subgrid", touchAction: "pan-x pan-y", rowGap: g.gap, marginTop: 2, "--hit": `-${g.gap / 2}px` } as CSSProperties}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onTouchEnd={(e) => {
              if (tapped.current) e.preventDefault();
              tapped.current = false;
            }}
            onPointerCancel={() => (drag.current = null)}
            onContextMenu={(e) => e.ctrlKey && e.preventDefault()}
            onKeyDown={onKeyDown}
          >
            {data.topics.map((t, r) => (
              <Row
                key={t.key}
                r={r}
                topic={t.key}
                name={names.get(t.key) ?? t.key}
                total={t.total.n}
                data={data}
                at={at}
                paint={paint}
                selection={selection}
                hasSel={hasSel}
                focus={focus}
                onFocusHead={onFocusHead}
                height={g.row}
                radius={g.radius}
                showValues={data.resolution === "month"}
                metric={metric}
                stickyClass={sticky}
                onRow={(mods) => onSelect(selectRow(selection, r, cols, { ...mods, toggle: mods.toggle || adding }))}
                onFocusCell={(c) => {
                  setFocus(c);
                  // A keyboard focus always explains its square; a click's focus only where a pointer can hover.
                  if (lastPointer.current === "keyboard" || (lastPointer.current !== "touch" && canHover())) showHover(c);
                }}
                onBlurCell={() => setHover(null)}
              />
            ))}

            {/* One outline per selected block, drawn over the cells it wraps. */}
            {boxes.map((b) => (
              <motion.div
                key={`${b.r0}-${b.r1}-${b.c0}-${b.c1}`}
                aria-hidden
                initial={reduce ? false : { opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.12 }}
                className="pointer-events-none relative z-10"
                style={{
                  gridRow: `${b.r0 + 1} / ${b.r1 + 2}`,
                  gridColumn: `${b.c0 + 2} / ${b.c1 + 3}`,
                  margin: -3,
                  borderRadius: g.radius + 3,
                  boxShadow: "0 0 0 2px var(--pulse), 0 0 0 5px color-mix(in oklch, var(--pulse) 18%, transparent)",
                }}
              />
            ))}
          </div>

          {/* The quiet totals row. Its numbers are distinct conversations (D46): one touching two topics counts once, so a
              column's total can be less than the sum of its squares. */}
          <div
            className={cn(sticky, "flex items-center pt-3 pr-3 text-[12px] text-muted-foreground")}
            style={{ gridColumn: 1 }}
            title="Each conversation counted once, however many topics it touches"
          >
            All topics
          </div>
          <Totals data={data} metric={metric} height={g.row} />
        </div>
      </div>

      {/* Earlier columns fade out into the topic column, as later ones fade at the right edge. A thin shadow here left
          a sliver of square standing sharp against the column on a phone (QA 2026-09-26). */}
      {scrolled.left && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 z-10 w-6 bg-gradient-to-r from-background to-transparent"
          style={{ left: "var(--label-w)" }}
        />
      )}
      {scrolled.right && (
        <div aria-hidden className="pointer-events-none absolute inset-y-0 right-0 z-20 w-6 bg-gradient-to-l from-background to-transparent" />
      )}

      <Tooltip hover={hover} cell={hoverCell} data={data} names={names} metric={metric} />
    </div>
  );
}

// ---------- one topic row ----------

const Row = memo(function Row({
  r,
  topic,
  name,
  total,
  data,
  at,
  paint,
  selection,
  hasSel,
  focus,
  onFocusHead,
  height,
  radius,
  showValues,
  metric,
  stickyClass,
  onRow,
  onFocusCell,
  onBlurCell,
}: {
  r: number;
  topic: string;
  name: string;
  total: number;
  data: GridData;
  at: Map<string, GridCell>;
  paint: Map<string, Paint>;
  selection: Selection;
  hasSel: boolean;
  focus: Spot;
  onFocusHead: (s: Spot) => void;
  height: number; // the row's height at full width (it is drawn from --row-h); decides how the name fits
  radius: number;
  showValues: boolean;
  metric: Metric;
  stickyClass: string;
  onRow: (mods: { shift: boolean; toggle: boolean }) => void;
  onFocusCell: (c: CellId) => void;
  onBlurCell: () => void;
}) {
  const rowSelected = data.periods.every((_, c) => selection.cells.has(cellKey(r, c)));
  return (
    <div role="row" aria-rowindex={r + 1} className="contents">
      <div role="rowheader" className={cn(stickyClass, "flex items-center shadow-[0_6px_0_var(--background)]")} style={{ height: "var(--row-h)", gridRow: r + 1, gridColumn: 1 }}>
        <button
          type="button"
          // Reached with ArrowLeft from the row's first square (grid-keys.ts); its keys bubble to the grid's handler.
          tabIndex={isRowHead(focus) && focus.r === r ? 0 : -1}
          data-head="row"
          data-r={r}
          onKeyUp={spaceUp}
          onFocus={() => onFocusHead({ r, c: -1 })}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => onRow({ shift: e.shiftKey, toggle: e.metaKey || e.ctrlKey })}
          title={rowTitle(name, total, data.norm.n)}
          // Named for what it does, as the dates are ("Select 3 Aug"): read as the bare topic name, nothing said it
          // selects the row (QA 2026-09-26).
          aria-label={`Select ${name}`}
          className={cn(
            // The ring drawn inside, with room before the name: outside, the scroller's edge cut off its left side.
            "flex h-full w-full items-center rounded-sm pr-3 pl-1.5 text-left text-[13px] leading-tight transition-colors focus-visible:outline-offset-[-2px]",
            rowSelected ? "font-semibold text-pulse" : "text-foreground/85 hover:text-foreground",
          )}
        >
          {/* A long name wraps onto a second line rather than losing its end ("Performance & A…" on a phone, QA
              2026-09-26). Two lines of 15px fit the week and month rows; a day row (26px) takes two lines only on a
              phone, where its column is slim, in a size that fits. */}
          <span
            className={cn(
              "min-w-0 break-words",
              height >= 30
                ? "line-clamp-2 leading-[15px]"
                : "truncate @max-[640px]:line-clamp-2 @max-[640px]:text-[12px] @max-[640px]:leading-[13px] @max-[640px]:whitespace-normal",
            )}
          >
            {name}
          </span>
        </button>
      </div>
      {data.periods.map((p, c) => {
        const k = `${topic}|${p.key}`;
        const cell = at.get(k);
        const pt = paint.get(k);
        const on = selection.cells.has(cellKey(r, c));
        const dim = hasSel && !on;
        const ink = pt && (dim ? pt.dim.ink : pt.ink);
        const isFocus = focus.r === r && focus.c === c;
        return (
          <div
            key={p.key}
            role="gridcell"
            aria-selected={on}
            aria-label={`${name}, ${periodLabel(p, data.resolution, data.window)}: ${cell ? formatValue(metric, cell) : "no conversations"}`}
            tabIndex={isFocus ? 0 : -1}
            data-cell={cellKey(r, c)}
            data-r={r}
            data-c={c}
            onFocus={() => onFocusCell({ r, c })}
            onBlur={onBlurCell}
            className={cn(
              // The page's focus ring (globals.css), in the ink colour: the accent already means "selected" here, and an
              // accent ring round a selected square vanished into its outline. Raised, so the next square cannot cover it.
              "relative flex items-center justify-center text-[12px] font-medium focus-visible:z-10 focus-visible:outline-foreground/70",
              // The gaps around a square belong to it (half a gap each side, --hit on the grid), so a tap between two
              // 13px day squares picks one rather than nothing (QA 2026-09-26; see GEOM). Neighbours meet, never overlap.
              "after:absolute after:inset-(--hit)",
              "transition-[background-color,opacity,filter] duration-200 ease-out",
              "hover:brightness-[0.93] dark:hover:brightness-125",
            )}
            style={{
              gridRow: r + 1,
              gridColumn: c + 2,
              height: "var(--row-h)",
              borderRadius: radius,
              background: (dim ? pt?.dim.background : pt?.background) ?? "var(--cell)",
              // An empty square carries no number, so it may still fade whole.
              opacity: pt ? 1 : 0.6 * (dim ? DIM : 1),
            }}
          >
            {showValues && cell && ink ? (
              <span className="text-(color:--ink) dark:text-(color:--ink-dark)" style={{ "--ink": ink.light, "--ink-dark": ink.dark } as CSSProperties}>
                {formatShort(metric, cell)}
              </span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
});

// ---------- totals ----------

function Totals({ data, metric, height }: { data: GridData; metric: Metric; height: number }) {
  const volume = metric === "activity";
  const values = data.periods.map((p) => (data.periodTotals[p.key] ? metricValue(metric, data.periodTotals[p.key]) : NaN));
  const max = Math.max(1, ...values.filter((v) => !Number.isNaN(v)));
  const norm = metricValue(metric, data.norm);
  const asBars = data.resolution === "day";
  return (
    <>
      {data.periods.map((p, i) => {
        const a = data.periodTotals[p.key];
        const v = values[i];
        const title = a ? `All topics, ${periodLabel(p, data.resolution, data.window)}: ${formatValue(metric, a)}` : undefined;
        if (asBars) {
          const h = volume ? Math.max(2, (v / max) * (height - 8)) : Math.max(2, Math.min(1, Math.abs(v - norm) / 15) * (height - 8));
          // A bar carries no number of its own, so its date and value are its name and its tooltip, empty days too
          // (QA 2026-09-26: the Days totals were bars with nothing to read, by eye or by a screen reader).
          const label = totalsLabel(periodLabel(p, data.resolution, data.window), metric, a);
          return (
            <div
              key={p.key}
              role="img"
              aria-label={label}
              title={label}
              className="flex items-end justify-center pt-3"
              style={{ gridColumn: i + 2, height: height + 12 }}
            >
              <span
                className="block w-full rounded-[2px]"
                style={{
                  height: Number.isNaN(v) ? 0 : h,
                  background:
                    volume
                      ? "color-mix(in oklch, var(--foreground) 22%, transparent)"
                      : divergingColor(divergingT(v, norm, 10) * 0.8),
                }}
              />
            </div>
          );
        }
        return (
          <div
            key={p.key}
            title={title}
            className="flex items-center pt-3 pl-0.5 text-[12px] text-muted-foreground"
            style={{ gridColumn: i + 2 }}
          >
            {a ? formatShort(metric, a) : ""}
          </div>
        );
      })}
    </>
  );
}

/** A Days totals bar's spoken name and tooltip: "All topics, 3 Aug: 41 conversations", or "…: no conversations". */
export function totalsLabel(period: string, metric: Metric, a: Agg | undefined): string {
  return `All topics, ${period}: ${a && a.n > 0 ? formatValue(metric, a) : "no conversations"}`;
}

// ---------- the hover tooltip ----------

// Opaque, not the translucent material of the app's chrome: over the grid's headers the month name behind showed
// through the dates ("3-9 Aug" over "August", QA 2026-09-25).

function Tooltip({
  hover,
  cell,
  data,
  names,
  metric,
}: {
  hover: Hover;
  cell: Agg | undefined;
  data: GridData;
  names: Map<string, string>;
  metric: Metric;
}) {
  const reduce = useReducedMotion();
  const mounted = useSyncExternalStore(noop, () => true, () => false); // the portal needs document.body
  const tip = useRef<HTMLDivElement>(null);
  // Placed once its size is known, before the browser paints it: centred above the square, kept inside the window.
  // offsetWidth/Height ignore the entrance animation's transform, so the size is the settled one.
  useLayoutEffect(() => {
    const el = tip.current;
    if (!el || !hover) return;
    const { left, top } = placeTip(
      hover,
      { width: el.offsetWidth, height: el.offsetHeight },
      { width: document.documentElement.clientWidth, height: window.innerHeight },
    );
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  });
  if (!mounted) return null;
  const topic = hover ? data.topics[hover.r] : undefined;
  const period = hover ? data.periods[hover.c] : undefined;
  const mood = metric === "mood";
  return createPortal(
    <AnimatePresence>
      {hover && topic && period && (
        <motion.div
          key="tip"
          ref={tip}
          role="tooltip"
          initial={reduce ? false : { opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, transition: { duration: 0.08 } }}
          transition={{ duration: 0.14, ease: "easeOut" }}
          className="pointer-events-none fixed top-0 left-0 z-50 w-max max-w-64 rounded-xl border border-foreground/10 bg-popover px-3 py-2 text-[13px] text-popover-foreground shadow-[0_8px_24px_-8px_rgb(0_0_0/0.25)]"
        >
          <div className="font-semibold text-foreground">{names.get(topic.key) ?? topic.key}</div>
          <div className="text-[12px] text-muted-foreground">{periodWords(period, data.resolution, data.window)}</div>
          <div className="mt-1.5 font-medium text-foreground">{cell ? formatValue(metric, cell) : "No conversations"}</div>
          {/* A conversation touching two topics sits in both rows (D46): the count is of the ones touching this one. */}
          {cell && !mood && <div className="text-[12px] text-muted-foreground">touching {names.get(topic.key) ?? topic.key}</div>}
          {cell && mood && (
            <div className="text-[12px] text-muted-foreground">
              {moodVersus(cell, data.norm)}, from {fmtInt(cell.n)} {cell.n === 1 ? "conversation" : "conversations"}
            </div>
          )}
          {cell && mood && cell.n < MIN_RELIABLE && (
            <div className="mt-1 text-[12px] text-muted-foreground">Too few to read much into.</div>
          )}
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
