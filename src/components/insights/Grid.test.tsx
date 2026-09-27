import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EMPTY_AGG, buildPeriods, type GridData, type Resolution } from "@/lib/data/insights-model";
import { EMPTY_SELECTION } from "@/lib/data/insights-selection";
import { selectRow } from "@/lib/data/insights-selection";
import { Grid, MONTH_COL, totalsLabel } from "./Grid";

const W = { from: "2026-06-18", to: "2026-09-24" };
const data = (resolution: Resolution): GridData => ({
  resolution,
  window: W,
  periods: buildPeriods(resolution, W.from, W.to),
  topics: [{ key: "perf", total: { ...EMPTY_AGG, n: 5 } }],
  cells: [],
  periodTotals: {},
  norm: EMPTY_AGG,
});
const grid = (res: Resolution) =>
  renderToStaticMarkup(
    <Grid data={data(res)} names={new Map([["perf", "Performance"]])} metric="activity" selection={EMPTY_SELECTION} onSelect={() => {}} narrow />,
  );

describe("Grid", () => {
  it("names each month once, over all its columns, pinned beside the topic column (QA 2026-09-26)", () => {
    const html = grid("day");
    const months = [...html.matchAll(/style="grid-column:([^"]+)"><span class="sticky[^"]*" style="left:var\(--label-w\)">(\w+)<\/span>/g)];
    expect(months.map((m) => [m[2], m[1]])).toEqual([
      ["June", "2 / 15"],
      ["July", "15 / 46"],
      ["August", "46 / 77"],
      ["September", "77 / 101"],
    ]);
  });

  it("month view names its months in the column headers, not twice", () => {
    expect(grid("month")).not.toMatch(/class="sticky z-20/);
  });

  it("keeps its layers to itself, so a pinned name cannot paint over the phone's sheet", () => {
    expect(grid("week")).toMatch(/^<div class="relative isolate /);
  });

  it("puts the topic column above the pinned month names, so a month scrolled away goes behind it", () => {
    const html = grid("day");
    const z = (re: RegExp) => Number(html.match(re)?.[1]);
    expect(z(/class="sticky left-0 z-(\d+) bg-background/)).toBeGreaterThan(z(/<span class="sticky z-(\d+) inline-block/));
  });

  it("leaves a square's focus ring to the page's own (only its colour and layer are the grid's)", () => {
    const cell = grid("week").match(/<div role="gridcell"[^>]*>/)?.[0] ?? "";
    expect(cell).not.toMatch(/outline-none|focus-visible:ring/);
    expect(cell).toMatch(/focus-visible:z-10/);
  });

  it("draws every topic row from one height, taller for days on a phone, so two-line names have room (QA 2026-09-26)", () => {
    const html = grid("day");
    expect(html).toMatch(/^<div class="[^"]*\[--row-h:26px\] @max-\[640px\]:\[--row-h:30px\]/);
    const row = html.match(/<div role="row"[^]*?<\/div><div role="gridcell"[^>]*>/)?.[0] ?? "";
    expect(row).toMatch(/role="rowheader"[^>]*style="height:var\(--row-h\)/);
    expect(row).toMatch(/role="gridcell"[^>]*style="[^"]*height:var\(--row-h\)/);
    expect(grid("week")).toMatch(/^<div class="[^"]*\[--row-h:32px\]/);
  });

  it("says what a topic name or a date does in words that suit a tap as well as a click", () => {
    const html = grid("week");
    expect(html).toContain('title="Performance: 5 conversations touch it. Select the whole row."');
    expect(html).toMatch(/title="[^"]+\. Select the whole column\."/);
    expect(html).not.toMatch(/Click to/);
  });

  it("puts the topic names and dates in the roving tab order, one tab stop in all (QA 2026-09-26)", () => {
    const html = grid("week");
    expect(html).toMatch(/<button[^>]*tabindex="-1"[^>]*data-head="row"[^>]*data-r="0"/);
    expect(html).toMatch(/<button[^>]*tabindex="-1"[^>]*data-head="col"[^>]*data-c="0"/);
    expect(html.match(/tabindex="0"/g)).toHaveLength(1); // the newest square, until the arrows move
    expect(html).toMatch(/aria-label="[^"]*Left from the first square reaches the topic and up from the top row the date/);
  });

  it("gives every square the gaps around it, so a tap between two day squares picks one (QA 2026-09-26)", () => {
    const html = grid("day");
    expect(html).toMatch(/role="grid"[^>]*style="[^"]*--hit:-1px/);
    expect(html.match(/<div role="gridcell"[^>]*>/)?.[0]).toMatch(/after:absolute after:inset-\(--hit\)/);
  });

  it("names every Days totals bar by its date and count, empty days too (QA 2026-09-26)", () => {
    const html = grid("day");
    const bars = html.match(/role="img" aria-label="All topics, [^"]+" title="All topics, [^"]+"/g) ?? [];
    expect(bars).toHaveLength(data("day").periods.length);
    expect(bars[0]).toContain('aria-label="All topics, 18 Jun: no conversations"');
    expect(totalsLabel("3 Aug", "activity", { ...EMPTY_AGG, n: 41 })).toBe("All topics, 3 Aug: 41 conversations");
  });

  // D48: no release markers on the axis; they were one game subreddit's patch notes, not the app's.
  it("draws no release markers, and marks a dashed date by its dashes alone", () => {
    const html = grid("week");
    expect(html).not.toMatch(/data-release|bg-drop/);
    expect(html).not.toMatch(/opacity-70/); // a dashed date is marked by its dashes, not faded too
  });

  it("names a topic's button for what it does, as the dates are (QA 2026-09-26)", () => {
    expect(grid("week")).toMatch(/<button[^>]*data-head="row"[^>]*aria-label="Select Performance"/);
    expect(grid("week")).toMatch(/<button[^>]*aria-label="Select [^"]+"[^>]*data-head="col"|<button[^>]*data-head="col"[^>]*aria-label="Select /);
  });

  it("narrows Months squares on a phone and keeps their numbers there, with short month names (QA 2026-09-26)", () => {
    expect(MONTH_COL).toBe("[--col-min:120px] @max-[640px]:[--col-min:44px]");
    const html = grid("month");
    expect(html).toMatch(/^<div class="[^"]*\[--col-min:120px\] @max-\[640px\]:\[--col-min:44px\]/);
    expect(html).toContain("minmax(var(--col-min), 1fr)");
    expect(html).toContain('<span class="@max-[640px]:hidden">June</span><span class="hidden @max-[640px]:inline">Jun</span>');
    expect(grid("week")).toContain("--col-min:30px");
  });

  it("fades only the fill of a square outside the selection, and gives its number the ink for the faded colour (QA 2026-09-26)", () => {
    const d = { ...data("month"), cells: [0, 1, 2, 3].map((i) => ({ topic: "perf", p: data("month").periods[i].key, ...EMPTY_AGG, n: 100 * (i + 1) })) };
    const html = renderToStaticMarkup(
      <Grid data={d} names={new Map([["perf", "Performance"]])} metric="activity" selection={selectRow(EMPTY_SELECTION, 0, 1, { shift: false, toggle: false })} onSelect={() => {}} narrow />,
    );
    const cells = html.match(/<div role="gridcell"[^>]*>/g) ?? [];
    expect(cells).toHaveLength(4);
    const dimmed = cells.filter((c) => c.includes('aria-selected="false"'));
    expect(dimmed).toHaveLength(3);
    for (const c of dimmed) {
      expect(c).toMatch(/background:color-mix\(in srgb, color-mix\(in oklch, var\(--pulse\) \d+%, var\(--cell\)\) 42%, transparent\)/);
      expect(c).toMatch(/opacity:1/);
      expect(c).not.toMatch(/saturate/);
    }
    expect(html.match(/--ink:/g)).toHaveLength(4); // every square keeps its number, dimmed or not
  });
});
