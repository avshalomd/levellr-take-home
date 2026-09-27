"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  EMPTY_AGG,
  METRIC_NAMES,
  MOOD_DEFINITION,
  addAgg,
  dayRange,
  divergingColor,
  humanizeKey,
  moodBaseline,
  volumeColor,
  type Agg,
  type GridData,
  type Metric,
  type Resolution,
} from "@/lib/data/insights-model";
import { EMPTY_SELECTION, blocks, rowRuns, selectedCells, selectionId, selectionTotals, type CellId, type Selection } from "@/lib/data/insights-selection";
import { askHref, describe, suggestions, type Described, type SelectedCell } from "@/lib/data/insights-question";
import type { SelectionDetail } from "@/lib/data/insights";
import { edgeNote, legendEnds, unbrokenDates } from "./explore-words";
import { Grid } from "./Grid";
import { sheetInsets } from "./placement";
import { Segmented, type Option } from "./Segmented";
import { BottomSheet, SelectionBody, SelectionPeek, SideColumn, type Detail, type Draft } from "./SelectionPanel";
import { TopicsPanel } from "./TopicsPanel";
import { useTaxonomy } from "./use-taxonomy";

const RES_OPTIONS: Option<Resolution>[] = [
  { value: "day", label: "Days" },
  { value: "week", label: "Weeks" },
  { value: "month", label: "Months" },
];

const UNITS: Record<Resolution, string> = { day: "days", week: "weeks", month: "months" };

const METRIC_OPTIONS: Option<Metric>[] = [
  { value: "activity", label: METRIC_NAMES.activity, hint: "How many conversations" },
  { value: "mood", label: METRIC_NAMES.mood, hint: "How positive they sound" },
];

/** A grid's topic keys, top row first. */
const topicKeys = (g: GridData) => g.topics.map((t) => t.key);

const WIDE = 1040; // content width (padding excluded); below this the detail moves from a side column into a bottom sheet
const NARROW = 640; // below this the topic column slims down

const reduceMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

async function fetchGrid(res: Resolution, fresh = false): Promise<GridData> {
  const r = await fetch(`/api/insights?res=${res}`, fresh ? { cache: "no-store" } : undefined);
  if (!r.ok) throw new Error(`The ${res} view did not load (${r.status}).`);
  return r.json();
}

/** The page's content width, and where its column sits on the screen (the phone sheet is anchored to it). */
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [box, setBox] = useState({ width: 0, left: 0, right: 0, viewport: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      const b = el.getBoundingClientRect();
      setBox({ width: e.contentRect.width, left: b.left, right: b.right, viewport: document.documentElement.clientWidth });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, box] as const;
}

export function Explore({ initial, initialNames }: { initial: GridData; initialNames: Record<string, string> }) {
  const router = useRouter();
  const [res, setRes] = useState<Resolution>(initial.resolution);
  const [metric, setMetric] = useState<Metric>("activity");
  const [grids, setGrids] = useState<Partial<Record<Resolution, GridData>>>({ [initial.resolution]: initial });
  const [gridError, setGridError] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection>(EMPTY_SELECTION);
  const [expanded, setExpanded] = useState(false);
  // Phones have no Cmd key: "Add squares" on the sheet makes a tap add to the selection. It ends with the selection.
  const [addingOn, setAdding] = useState(false);
  const [sheetHeight, setSheetHeight] = useState(0);
  const gridBox = useRef<HTMLDivElement>(null);
  const [rootRef, box] = useWidth<HTMLDivElement>();
  const width = box.width;
  const wide = width >= WIDE;
  const narrow = width > 0 && width < NARROW;
  const data = grids[res] ?? null;
  const shown = data ?? grids.week ?? initial; // keep the last grid on screen while another resolution loads

  // ---------- the grids ----------

  const load = useCallback(async (r: Resolution, fresh = false): Promise<GridData | null> => {
    try {
      const g = await fetchGrid(r, fresh);
      setGrids((gs) => ({ ...gs, [r]: g }));
      setGridError(null);
      return g;
    } catch (e) {
      setGridError(e instanceof Error ? e.message : String(e));
      return null;
    }
  }, []);

  // Fetch the other two resolutions once the page is idle, so switching is instant.
  useEffect(() => {
    const t = setTimeout(() => {
      for (const r of ["day", "month", "week"] as const) if (r !== initial.resolution) void load(r);
    }, 600);
    return () => clearTimeout(t);
  }, [initial.resolution, load]);

  // A switch drops the selection, since a square means another period at another resolution. It used to drop it
  // without a word (QA 2026-09-26), so a switch that had one says so, in a live region beside the switch, until the
  // next selection. Carrying it across was the other way; this one is simpler and never guesses what a day was meant
  // to become as a week.
  const [cleared, setCleared] = useState("");
  const chooseRes = (r: Resolution) => {
    if (r === res) return;
    setCleared(selection.cells.size > 0 ? `Selection cleared: the squares now show ${UNITS[r]}, not ${UNITS[res]}.` : "");
    setRes(r);
    setSelection(EMPTY_SELECTION);
    if (!grids[r]) void load(r);
  };
  const select = useCallback((s: Selection) => {
    setSelection(s);
    setCleared("");
  }, []);

  // The order the topics editor lists topics in: the grid's rows as the page opened with them. It is taken again only
  // when the labels change underneath (below), never on a resolution switch or a background load, so the list does not
  // re-order under someone reading or editing it. A new array on every render also re-sorted the list each time.
  const [editorOrder, setEditorOrder] = useState(() => topicKeys(initial));

  /** After the labels changed underneath (a combine, a finished relabel): drop every grid held here and re-read. The
   * server needs no telling: every label change writes a new taxonomy version, which is part of its cache key. */
  const refreshGrids = useCallback(async () => {
    setSelection(EMPTY_SELECTION);
    setGrids({});
    const g = await load(res, true);
    if (g) setEditorOrder(topicKeys(g));
  }, [load, res]);

  const taxonomy = useTaxonomy({ onLabelsChanged: refreshGrids });

  // The live labels once loaded (they follow renames); until then the names the page was rendered with; a name made
  // from the key only for a topic neither has.
  const names = useMemo(() => {
    const m = new Map<string, string>();
    for (const l of taxonomy.tax?.active.labels ?? []) m.set(l.key, l.name);
    for (const [key, name] of Object.entries(initialNames)) if (!m.has(key)) m.set(key, name);
    for (const t of shown.topics) if (!m.has(t.key)) m.set(t.key, humanizeKey(t.key));
    return m;
  }, [taxonomy.tax, initialNames, shown.topics]);

  // ---------- the selection ----------

  const cells = useMemo(() => (data ? selectedCells(selection) : []), [data, selection]);
  const selId = useMemo(() => selectionId(selection), [selection]);
  const hasSel = cells.length > 0 && data !== null;
  const adding = addingOn && hasSel;

  const at = useMemo(() => new Map((data?.cells ?? []).map((c) => [`${c.topic}|${c.p}`, c])), [data]);

  const summary = useMemo(() => {
    if (!data || cells.length === 0) return null;
    let combined: Agg = EMPTY_AGG;
    const periodKeys = new Set<string>();
    const toSel = (ids: CellId[]): SelectedCell[] =>
      ids.flatMap(({ r, c }) => {
        const topic = data.topics[r]?.key;
        const period = data.periods[c];
        return topic && period ? [{ topic, period }] : [];
      });
    const sel = toSel(cells);
    // The cells' sum. Exact within one topic's row; across rows it counts a conversation touching two selected topics
    // twice (D46), so the panel shows it only through selectionTotals below. The suggestion chips read its mood, where
    // that double weight is harmless.
    for (const { topic, period } of sel) {
      combined = addAgg(combined, at.get(`${topic}|${period.key}`) ?? EMPTY_AGG);
      periodKeys.add(period.key);
    }
    const inPeriods = [...periodKeys].reduce((s, k) => s + (data.periodTotals[k]?.n ?? 0), 0);
    const topics = data.topics.map((t) => ({ key: t.key, name: names.get(t.key) ?? humanizeKey(t.key) }));
    const described: Described = describe(sel, topics, data.periods, data.resolution, data.window);
    return {
      combined,
      described,
      inPeriods,
      suggestions: suggestions({
        cells: sel,
        blocks: blocks(cells).map(toSel),
        topics,
        all: data.periods,
        res: data.resolution,
        w: data.window,
        sel: combined,
        population: data.norm,
      }),
      ranges: rowRuns(cells).map((run) => ({
        topic: data.topics[run.r].key,
        from: data.periods[run.from].start,
        to: data.periods[run.to].end,
      })),
    };
  }, [data, cells, at, names]);

  // The exact numbers (people counted once across cells) and the top threads come from the server, 200 ms after the
  // selection settles, so a drag across the grid asks once rather than on every cell it passes.
  const [loaded, setLoaded] = useState<{ id: string; detail: Detail }>({ id: "", detail: { state: "idle" } });
  const [retry, setRetry] = useState(0);
  const detailKey = `${res}/${selId}/${retry}`;
  const request = summary?.ranges.length ? JSON.stringify({ ranges: summary.ranges }) : null; // stable across re-renders
  useEffect(() => {
    if (!request) return;
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const r = await fetch("/api/insights/selection", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: request,
          signal: ctl.signal,
        });
        if (!r.ok) throw new Error(String(r.status));
        const d: SelectionDetail = await r.json();
        setLoaded({ id: detailKey, detail: { state: "ready", totals: d.totals, people: d.totals.people, sessions: d.sessions, voices: d.voices ?? [] } });
      } catch {
        if (!ctl.signal.aborted) setLoaded({ id: detailKey, detail: { state: "error" } });
      }
    }, 200);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [detailKey, request]);
  const detail: Detail = loaded.id === detailKey ? loaded.detail : { state: "loading" };
  // Distinct conversations: the grid's sum while the squares are in one topic's row, else the server's count (D46).
  const totals = summary ? selectionTotals(summary.combined, cells, detail.state === "ready" ? detail.totals : null) : null;

  // "Add squares" asks the reader to tap more squares, so none of them may be under the sheet: while it is on, the grid
  // is scrolled up clear of the sheet (its scroll margin is the sheet's height), as little as it takes. It runs once the
  // sheet has its new height, since turning it on adds a line to the sheet. At 1024px the sheet covered the lower topic
  // names at that very moment (QA 2026-09-26).
  useEffect(() => {
    if (adding) gridBox.current?.scrollIntoView({ block: "nearest", behavior: reduceMotion() ? "auto" : "smooth" });
  }, [adding, sheetHeight]);

  const clear = useCallback(() => {
    setSelection(EMPTY_SELECTION);
    setExpanded(false);
    setAdding(false);
  }, []);

  // Closing the selection from inside its sheet or column takes the focused control away with it, and the keyboard
  // was left on the page's body, back at the top of the Tab order (QA 2026-09-26, at 375 and 1024). So the focus goes
  // back to the square the selection came from: the grid's one tab stop, which a click, a tap or the arrows put on the
  // last square chosen. It stays where it is if it is somewhere that survives the close.
  const selectedNow = useRef(false);
  useEffect(() => {
    selectedNow.current = hasSel;
  }, [hasSel]);
  const focusLeaves = useCallback(() => {
    const a = document.activeElement;
    if (a?.closest("[data-selection-panel]")) return true;
    return (!a || a === document.body) && selectedNow.current; // Details swaps the sheet's content, and its button with it
  }, []);
  const backToGrid = useCallback(
    // The grid's tab stop is a square, or the topic name or date the arrows reached (Grid, grid-keys.ts).
    () => requestAnimationFrame(() => gridBox.current?.querySelector<HTMLElement>("[data-cell][tabindex='0'], [data-head][tabindex='0']")?.focus()),
    [],
  );

  /** The sheet's and the column's own close button. After a mouse click the focus is not put anywhere (a square
   * focused by a click shows its tooltip); after Tab and Enter it goes back to the grid, as for Esc. */
  const closeFromPanel = () => {
    const keyboard = document.activeElement?.matches(":focus-visible") ?? false;
    clear();
    if (keyboard) backToGrid();
  };

  // Esc clears from anywhere on the page, unless it belongs to a field being edited.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.closest("input, textarea, [contenteditable=true], [role=dialog]") || t.closest("[role=grid]"))) return;
      const back = focusLeaves();
      clear();
      if (back) backToGrid();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [clear, focusLeaves, backToGrid]);

  // ---------- the question ----------

  // Prefilled from the selection; once edited it stays as typed until the selection (or the resolution) changes.
  const questionKey = `${res}/${selId}`;
  const [edited, setEdited] = useState<{ key: string; text: string } | null>(null);
  const draft: Draft | null = summary
    ? {
        question: edited?.key === questionKey ? edited.text : summary.suggestions[0].question,
        setQuestion: (text) => setEdited({ key: questionKey, text }),
        suggestions: summary.suggestions,
        ask: (q) => router.push(askHref(q)),
      }
    : null;

  // ---------- render ----------

  const body =
    hasSel && summary && draft ? (
      <SelectionBody
        described={summary.described}
        combined={totals}
        population={data.norm}
        inPeriods={summary.inPeriods}
        detail={detail}
        draft={draft}
        onClear={closeFromPanel}
        onRetry={() => setRetry((x) => x + 1)}
      />
    ) : null;

  // The root is a size container (@container): the controls and the grid's topic column size themselves to the page
  // width in CSS, so the first paint already has the phone layout rather than switching to it after a measurement.
  return (
    <div
      ref={rootRef}
      className="@container mx-auto flex w-full max-w-[1480px] min-w-0 flex-col gap-8 px-4 py-6 sm:px-8 sm:py-8 [--cell-mid:oklch(0.955_0.004_250)] [--cell:oklch(0.955_0.006_255)] dark:[--cell-mid:oklch(0.27_0.008_260)] dark:[--cell:oklch(0.25_0.01_260)]"
    >
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-2xl">
          <h1 className="text-[28px] leading-tight font-semibold tracking-[-0.02em] text-foreground sm:text-[32px]">Explore</h1>
          <p className="mt-1.5 text-[15px] leading-relaxed text-muted-foreground">
            What people in the Veil of Ages Discord talked about, topic by topic,{" "}
            {unbrokenDates(dayRange(shown.window.from, shown.window.to))}. Pick any squares to see
            what was said there and ask about it.
          </p>
        </div>
        <a
          href="#topics"
          className="pressable shrink-0 self-start rounded-full border border-foreground/10 px-3.5 py-1.5 text-[14px] font-medium whitespace-nowrap text-foreground hover:bg-foreground/[0.04] sm:self-auto"
        >
          Edit topics
        </a>
      </header>

      <section aria-label="Topics over time" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-3">
          <Segmented id="metric" label="Show" groups={[METRIC_OPTIONS]} value={metric} onChange={setMetric} size="fit" />
          <Segmented id="res" label="Group by" groups={[RES_OPTIONS]} value={res} onChange={chooseRes} size="fit" />
          <p role="status" className="text-[13px] text-muted-foreground">
            {cleared}
          </p>
        </div>

        <Legend metric={metric} data={shown} />

        <div className="flex items-start gap-6">
          {/* A size container of its own: the grid fits its topic column to the room beside an open side column. */}
          <div ref={gridBox} className="@container min-w-0 flex-1" style={{ scrollMarginBottom: sheetHeight + 12 }}>
            {gridError && !data ? (
              <div className="rounded-2xl border border-foreground/[0.07] bg-card p-6 text-[14px] text-muted-foreground">
                {gridError}{" "}
                <button type="button" className="font-medium text-pulse hover:underline" onClick={() => void load(res, true)}>
                  Try again
                </button>
              </div>
            ) : (
              <div className={cn("transition-opacity duration-200", data ? "opacity-100" : "pointer-events-none opacity-50")}>
                <Grid
                  data={shown}
                  names={names}
                  metric={metric}
                  selection={data ? selection : EMPTY_SELECTION}
                  onSelect={select}
                  narrow={narrow}
                  adding={!wide && adding}
                />
              </div>
            )}
          </div>
          {wide && <SideColumn open={hasSel}>{body}</SideColumn>}
        </div>

        {!wide && width > 0 && summary && draft && (
          <BottomSheet
            open={hasSel}
            insets={sheetInsets(box, box.viewport)}
            expanded={expanded}
            setExpanded={setExpanded}
            onClose={clear}
            onHeight={setSheetHeight}
            peek={
              <SelectionPeek
                described={summary.described}
                combined={totals}
                draft={draft}
                onMore={() => setExpanded(true)}
                onClear={closeFromPanel}
                adding={adding}
                onAdding={setAdding}
              />
            }
          >
            {body}
          </BottomSheet>
        )}
      </section>

      <TopicsPanel
        taxonomy={taxonomy}
        onError={(m) => toast.error(m)}
        onDone={(m) => toast.success(m)}
        totalConversations={shown.norm.n}
        gridOrder={editorOrder}
      />
    </div>
  );
}

// ---------- the legend ----------

/** What the colours mean, in words: for activity the count at each end of one scale, for mood the population it is
 * measured against and what it measures. */
function Legend({ metric, data }: { metric: Metric; data: GridData }) {
  const unit = data.resolution === "day" ? "day" : data.resolution === "week" ? "week" : "month";
  const activity = metric === "activity";
  const max = Math.max(0, ...data.cells.map((c) => c.n));
  const ramp = activity
    ? `linear-gradient(90deg, ${[0, 0.25, 0.5, 0.75, 1].map((i) => volumeColor(i)).join(", ")})`
    : `linear-gradient(90deg, ${[-1, -0.5, 0, 0.5, 1].map((t) => divergingColor(t)).join(", ")})`;
  const [left, right] = legendEnds(metric, max, unit);
  return (
    <div className="flex flex-col gap-1.5 text-[13px] leading-snug text-muted-foreground">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5">
        <div className="flex items-center gap-2">
          <span className="whitespace-nowrap">{left}</span>
          <span aria-hidden className="h-2.5 w-28 rounded-full" style={{ background: ramp }} />
          <span className="whitespace-nowrap">{right}</span>
        </div>
        <p className="min-w-0">
          {activity
            ? `Each square is the number of conversations touching a topic in one ${unit}. A conversation is a stretch of chat in one channel with no pause over 15 minutes (40 messages at most); one that touches two topics sits in both rows, and the totals count it once.`
            : moodBaseline(data.norm)}
        </p>
      </div>
      {/* Full muted colour, no alpha: faded, the note on dashed dates read 3.8:1 (QA 2026-09-26). */}
      {!activity && <p className="max-w-3xl text-[12.5px] text-muted-foreground">{MOOD_DEFINITION}</p>}
      <div className="flex flex-wrap gap-x-5 gap-y-1 text-[12.5px] text-muted-foreground">
        {!activity && <span>Faded squares have fewer than 10 conversations, so read them loosely.</span>}
        {data.periods.some((p) => p.partial) && <span>{edgeNote(data.resolution)}</span>}
      </div>
    </div>
  );
}
