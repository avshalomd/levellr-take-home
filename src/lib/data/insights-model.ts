// The Explore grid's pure logic: periods, metrics, colour scales and plain-language formatting. No I/O, so it runs on
// the server (to shape the query result) and in the browser (to colour cells when the metric changes), and every rule
// here is pinned by insights-model.test.ts. Nothing here knows which community or which topics it is looking at.

export const RESOLUTIONS = ["day", "week", "month"] as const;
export type Resolution = (typeof RESOLUTIONS)[number];
export const isResolution = (x: unknown): x is Resolution => RESOLUTIONS.includes(x as Resolution);

/** Raw sums for one cell (a topic in a period), one period across all topics, one topic, or the whole dataset.
 * Sums rather than averages so any set of cells can be combined exactly; only `people` cannot be summed (one person
 * talks in many cells), which is why a selection's people count comes from the server. */
export type Agg = {
  n: number; // conversations
  engagement: number; // the conversations' engagement scores summed (authors + replies + reactions, D5)
  messages: number;
  moodSum: number; // sum of mood (0..1) over conversations that have one
  moodN: number;
  people: number; // distinct people who wrote in those conversations
};

export const EMPTY_AGG: Agg = { n: 0, engagement: 0, messages: 0, moodSum: 0, moodN: 0, people: 0 };

export function addAgg(a: Agg, b: Agg): Agg {
  return {
    n: a.n + b.n,
    engagement: a.engagement + b.engagement,
    messages: a.messages + b.messages,
    moodSum: a.moodSum + b.moodSum,
    moodN: a.moodN + b.moodN,
    people: a.people + b.people, // an upper bound only; see Agg
  };
}

export type Period = {
  key: string; // YYYY-MM-DD, the period's first day (UTC); weeks start on Monday
  start: string; // = key
  end: string; // first day AFTER the period (exclusive)
  partial: boolean; // the data covers only part of it (the first and last week or month)
};

export type GridCell = Agg & { topic: string; p: string };

/** What /api/insights returns for one resolution. */
export type GridData = {
  resolution: Resolution;
  window: { from: string; to: string }; // first and last day with data, YYYY-MM-DD
  periods: Period[];
  topics: { key: string; total: Agg }[]; // ordered by conversations, most first; "other" last
  cells: GridCell[];
  periodTotals: Record<string, Agg>; // all topics, per period key
  norm: Agg; // the whole dataset
};

// ---------- dates (all UTC, all YYYY-MM-DD strings) ----------

const DAY = 86_400_000;
const toDate = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`);
const toIso = (d: Date) => d.toISOString().slice(0, 10);
export const addDays = (iso: string, n: number) => toIso(new Date(toDate(iso).getTime() + n * DAY));
export const daysBetween = (a: string, b: string) => Math.round((toDate(b).getTime() - toDate(a).getTime()) / DAY);

export function periodStart(iso: string, res: Resolution): string {
  const d = toDate(iso);
  if (res === "week") d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  if (res === "month") d.setUTCDate(1);
  return toIso(d);
}

export function periodEnd(start: string, res: Resolution): string {
  if (res === "day") return addDays(start, 1);
  if (res === "week") return addDays(start, 7);
  const d = toDate(start);
  d.setUTCMonth(d.getUTCMonth() + 1);
  return toIso(d);
}

/** Every period between the first and the last day with data, inclusive, with the edge ones marked partial. */
export function buildPeriods(res: Resolution, from: string, to: string): Period[] {
  const out: Period[] = [];
  const stop = addDays(to, 1);
  for (let s = periodStart(from, res); s < stop; s = periodEnd(s, res)) {
    const e = periodEnd(s, res);
    out.push({ key: s, start: s, end: e, partial: s < from || e > stop });
  }
  return out;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]; // the chat's style (evidence.ts), so a date reads the same everywhere
export const monthName = (iso: string, short = false) => (short ? MONTHS_SHORT : MONTHS)[toDate(iso).getUTCMonth()];
export const dayOf = (iso: string) => toDate(iso).getUTCDate();
/** "7 Sep" / "7 September". */
export const dayMonth = (iso: string, short = true) => `${dayOf(iso)} ${monthName(iso, short)}`;

/** Two days as a range the way people write it: "7–20 Sep", "25 Aug – 7 Sep", or one day, "7 Sep". */
export function dayRange(a: string, b: string, short = true): string {
  if (a === b) return dayMonth(a, short);
  if (a.slice(0, 7) === b.slice(0, 7)) return `${dayOf(a)}–${dayOf(b)} ${monthName(b, short)}`;
  return `${dayMonth(a, short)} – ${dayMonth(b, short)}`;
}

/** The days a period actually holds data for: its own span, clipped to the data window. */
export function periodSpan(p: Period, window: { from: string; to: string }): { first: string; last: string } {
  const last = addDays(p.end, -1);
  return { first: p.start < window.from ? window.from : p.start, last: last > window.to ? window.to : last };
}

/** The label a period gets in the tooltip and the detail panel: "7 Sep", "Week of 7 Sep", "July". */
export function periodLabel(p: Period, res: Resolution, window: { from: string; to: string }): string {
  if (res === "day") return dayMonth(p.start);
  if (res === "month") return monthName(p.start);
  const { first, last } = periodSpan(p, window);
  return dayRange(first, last);
}

/** Header labels: month names where a month begins, day numbers where the resolution wants them. Day view labels only
 * Mondays (sparse, so 99 columns stay readable); week view labels every week; month view has no day tier. */
export function axisLabels(periods: Period[], res: Resolution): { month: string | null; day: string | null }[] {
  return periods.map((p, i) => {
    const prev = periods[i - 1];
    const newMonth = !prev || prev.start.slice(0, 7) !== p.start.slice(0, 7);
    if (res === "month") return { month: monthName(p.start), day: null };
    const month = newMonth ? monthName(p.start) : null;
    if (res === "week") return { month, day: String(dayOf(p.start)) };
    const monday = toDate(p.start).getUTCDay() === 1;
    return { month, day: monday ? String(dayOf(p.start)) : null };
  });
}

/**
 * The month tier over the day and week columns: each month named once, over every column it holds (`from`..`to`, both
 * inclusive). The grid pins the name to the left edge while its month is in view, so on a phone the current month
 * stays named when its first column has scrolled away behind the topic column (QA 2026-09-26).
 */
export function monthSpans(periods: Period[], res: Resolution): { name: string; from: number; to: number }[] {
  const spans: { name: string; from: number; to: number }[] = [];
  axisLabels(periods, res).forEach((l, i) => {
    if (l.month) spans.push({ name: l.month, from: i, to: i });
    else if (spans.length) spans[spans.length - 1].to = i;
  });
  return spans;
}

// ---------- what the grid shows ----------

/** The grid shows one of two things: how much was said (activity) or how it sounded (mood). */
export const METRICS = ["activity", "mood"] as const;
export type Metric = (typeof METRICS)[number];
export const isMetric = (x: unknown): x is Metric => METRICS.includes(x as Metric);

export const METRIC_NAMES: Record<Metric, string> = { activity: "Activity", mood: "Mood" };

/**
 * What mood measures, in the words of the question the enrichment asks of every conversation (ingest/enrich.py): the
 * overall feeling of the people in it towards what the community is about, on five steps from very negative to very
 * positive, read by a language model. So it is the tone of the talk, not a rating of any one thing.
 */
export const MOOD_DEFINITION =
  "Mood is how positive people sound in a conversation, from 0 (very negative) to 100 (very positive), read from their words. It is not a rating of any one thing.";

/** A mood on the 0-100 scale people read, or NaN when nothing in the aggregate has one. */
export const moodOf = (a: Agg) => (a.moodN ? (a.moodSum / a.moodN) * 100 : NaN);

/** The value a cell is coloured by: its conversation count, or its mood (0-100). */
export function metricValue(m: Metric, a: Agg): number {
  return m === "activity" ? a.n : moodOf(a);
}

const int = new Intl.NumberFormat("en-GB");
export const fmtInt = (x: number) => int.format(Math.round(x));
export const plural = (n: number, one: string, many: string) => `${fmtInt(n)} ${Math.round(n) === 1 ? one : many}`;

/** The value as a phrase: "412 conversations", "Mood 38 out of 100". */
export function formatValue(m: Metric, a: Agg): string {
  if (m === "activity") return a.n ? plural(a.n, "conversation", "conversations") : "No conversations";
  const v = moodOf(a);
  return Number.isNaN(v) ? "No mood reading" : `Mood ${Math.round(v)} out of 100`;
}

/** A short value for a table cell: "412", "38". */
export function formatShort(m: Metric, a: Agg): string {
  const v = metricValue(m, a);
  if (Number.isNaN(v)) return "";
  if (m === "mood") return String(Math.round(v));
  return v >= 10_000 ? `${(v / 1000).toFixed(0)}k` : fmtInt(v);
}

/**
 * How a mood compares with the population it is drawn against - every conversation in the dataset - in words that
 * name that population: "7 below the average of 54", "about the average of 54".
 */
export function moodVersus(a: Agg, population: Agg): string {
  const v = moodOf(a), base = moodOf(population);
  if (Number.isNaN(v) || Number.isNaN(base)) return "";
  const d = Math.round(v) - Math.round(base);
  const avg = `the average of ${Math.round(base)}`;
  if (d === 0) return `about ${avg}`;
  return `${Math.abs(d)} ${d > 0 ? "above" : "below"} ${avg}`;
}

/** The legend's line for mood: what the colours are measured against, said as a population. */
export function moodBaseline(population: Agg): string {
  const base = moodOf(population);
  if (Number.isNaN(base)) return "";
  const who = population.moodN === 1 ? "the one conversation" : `all ${fmtInt(population.moodN)} conversations`;
  return `Compared with the average mood of ${who}, which is ${Math.round(base)}.`;
}

// ---------- colour ----------

/** Squares resting on fewer conversations than this are drawn faded: their average mood is too noisy to read. */
export const MIN_RELIABLE = 10;

/** 0..1 intensity for activity: ONE scale across the whole grid, square-rooted because one topic can be ten times
 * another and the small ones should still show. */
export function activityIntensity(v: number, max: number): number {
  if (!(v > 0) || !(max > 0)) return 0;
  return Math.min(1, Math.sqrt(v / max));
}

/** The spread mood is drawn against: the 90th percentile of |mood - average| over the reliable squares, so one freak
 * square cannot wash out the rest. Never zero. */
export function divergingSpread(values: number[], norm: number): number {
  const d = values.filter((x) => !Number.isNaN(x)).map((x) => Math.abs(x - norm)).sort((a, b) => a - b);
  if (!d.length) return 1;
  const p90 = d[Math.min(d.length - 1, Math.floor(d.length * 0.9))];
  return p90 > 0 ? p90 : 1;
}

/** -1..1 for mood: negative is gloomier than the average, positive happier. */
export function divergingT(v: number, norm: number, spread: number): number {
  if (Number.isNaN(v) || Number.isNaN(norm)) return 0;
  return Math.max(-1, Math.min(1, (v - norm) / spread));
}

/** Faded when the square rests on too few conversations to trust an average. */
export function reliability(n: number): number {
  if (n >= MIN_RELIABLE) return 1;
  if (n >= 5) return 0.55;
  return 0.3;
}

// How much accent a square takes: its share of the colour mix, in whole percent (null: the neutral ground itself). One
// rule for the CSS below and for the ink model after it, so the two cannot drift apart.
const volumeShare = (intensity: number) => (intensity <= 0 ? null : Math.round(10 + 85 * intensity));
const divergingShare = (t: number) => (Math.abs(t) < 0.04 ? null : Math.round(12 + 80 * Math.abs(t)));

/** The CSS colour of a square. `--cell` is the neutral ground, set by the page. */
export function volumeColor(intensity: number): string {
  const p = volumeShare(intensity);
  return p === null ? "var(--cell)" : `color-mix(in oklch, var(--pulse) ${p}%, var(--cell))`;
}

export function divergingColor(t: number): string {
  const p = divergingShare(t);
  return p === null ? "var(--cell-mid)" : `color-mix(in oklch, var(--${t < 0 ? "neg" : "pos"}) ${p}%, var(--cell-mid))`;
}

// ---------- the number on a square ----------
//
// Months squares carry their number, 12px, on every shade of the scale. One rule by intensity (light ink past 0.55)
// left numbers at 2.5-4.5:1 in the light theme and 3.0-4.7:1 in the dark (QA 2026-09-26). The ink is now chosen per
// square from the colour it actually sits on, in each theme: the page's dark ink or white, whichever reads better, and
// pure black where neither reaches 4.5:1 (a mid-tone square: black on it is 4.58:1 at worst). So the tokens behind
// the squares are repeated here; insights-model.test.ts checks them against globals.css and Explore.tsx.

type Oklch = readonly [l: number, c: number, h: number];
export type Theme = "light" | "dark";

export const SQUARE_TOKENS: Record<Theme, { pulse: Oklch; cell: Oklch; cellMid: Oklch; neg: Oklch; pos: Oklch; page: Oklch }> = {
  light: { pulse: [0.55, 0.21, 265], cell: [0.955, 0.006, 255], cellMid: [0.955, 0.004, 250], neg: [0.6, 0.17, 35], pos: [0.62, 0.11, 185], page: [1, 0, 0] },
  dark: { pulse: [0.7, 0.16, 265], cell: [0.25, 0.01, 260], cellMid: [0.27, 0.008, 260], neg: [0.72, 0.2, 35], pos: [0.78, 0.15, 185], page: [0.145, 0, 0] },
};

/** The inks a number can take: the light theme's own ink (--foreground), white, and black as the last resort. */
export const INKS = { dark: "oklch(0.2 0.012 260)", light: "white", black: "black" } as const;
const INK_OKLCH: Record<keyof typeof INKS, Oklch> = { dark: [0.2, 0.012, 260], light: [1, 0, 0], black: [0, 0, 0] };

/** CSS color-mix(in oklch, a p%, b): lightness and chroma straight, hue the shorter way round. */
function mixOklch(a: Oklch, b: Oklch, p: number): Oklch {
  const w = p / 100;
  let dh = a[2] - b[2];
  if (dh > 180) dh -= 360;
  if (dh < -180) dh += 360;
  return [a[0] * w + b[0] * (1 - w), a[1] * w + b[1] * (1 - w), (b[2] + dh * w + 360) % 360];
}

/** Gamma-encoded sRGB, 0..1 per channel, clipped to the gamut as the browser draws it. */
function oklchToSrgb([l, c, h]: Oklch): [number, number, number] {
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  const L = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const M = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const S = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [
    4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S,
    -1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S,
    -0.0041960863 * L - 0.7034186147 * M + 1.707614701 * S,
  ];
  const enc = (v: number) => {
    const x = Math.min(1, Math.max(0, v));
    return x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
  };
  return [enc(lin[0]), enc(lin[1]), enc(lin[2])];
}

/** WCAG relative luminance of a gamma-encoded sRGB colour. */
function luminance(rgb: readonly number[]): number {
  const [r, g, b] = rgb.map((s) => (s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export const contrastRatio = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

/** What a square is painted with: activity by its intensity (0..1), mood by its signed distance from the average
 *  (-1..1), faded to `alpha` over the page when it rests on too few conversations. */
export type SquarePaint = { metric: Metric; value: number; alpha: number };

/** The square's colour as seen on the page in one theme, as a luminance. */
export function squareLuminance(theme: Theme, { metric, value, alpha }: SquarePaint): number {
  const t = SQUARE_TOKENS[theme];
  let colour: Oklch;
  if (metric === "activity") {
    const p = volumeShare(value);
    colour = p === null ? t.cell : mixOklch(t.pulse, t.cell, p);
  } else {
    const p = divergingShare(value);
    colour = p === null ? t.cellMid : mixOklch(value < 0 ? t.neg : t.pos, t.cellMid, p);
  }
  const sq = oklchToSrgb(colour);
  const page = oklchToSrgb(t.page);
  return luminance(sq.map((v, i) => v * alpha + page[i] * (1 - alpha))); // composited as the browser does, in sRGB
}

const MIN_CONTRAST = 4.5;

/** The ink for a square's number in one theme, and the contrast it gets. */
export function inkOn(theme: Theme, paint: SquarePaint): { ink: keyof typeof INKS; ratio: number } {
  const bg = squareLuminance(theme, paint);
  const ratioOf = (k: keyof typeof INKS) => contrastRatio(luminance(oklchToSrgb(INK_OKLCH[k])), bg);
  const best = (["dark", "light"] as const).map((ink) => ({ ink, ratio: ratioOf(ink) })).sort((a, b) => b.ratio - a.ratio)[0];
  if (best.ratio >= MIN_CONTRAST + 0.05) return best; // a little to spare over the browser's own rounding
  const black = ratioOf("black");
  return black > best.ratio ? { ink: "black", ratio: black } : best;
}

/** The number's colour on a square in each theme, as CSS colours. */
export function inkPair(paint: SquarePaint): { light: string; dark: string } {
  return { light: INKS[inkOn("light", paint).ink], dark: INKS[inkOn("dark", paint).ink] };
}

// ---------- topic names ----------

/** A readable name for a topic key when the taxonomy has not named it: "servers-matchmaking" -> "Servers matchmaking". */
export function humanizeKey(key: string): string {
  const s = key.replace(/[-_]+/g, " ").trim();
  return s ? s[0].toUpperCase() + s.slice(1) : key;
}

/** Catch-all labels sort last in the grid, whatever the taxonomy calls them. */
export const isCatchAll = (key: string) => /^(other|misc|miscellaneous|unlabel+ed|none)$/i.test(key);
