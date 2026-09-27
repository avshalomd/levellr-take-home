import { addDays, dayRange, fmtInt, periodLabel, periodSpan, type Metric, type Period, type Resolution } from "@/lib/data/insights-model";

// Explore's words for the periods at the edges of the data. The first and last week (or month) hold only some of their
// days, and "September, partly covered" left a reader asking covered by what (QA 2026-09-25). So the words name the
// days the data actually holds and where it begins or ends. Pinned by explore-words.test.ts.

type Window = { from: string; to: string };

/** A period as the tooltip and the column header name it: "7–13 Sept", or at an edge "1–24 Sept, where the data ends". */
export function periodWords(p: Period, res: Resolution, window: Window): string {
  if (!p.partial) return periodLabel(p, res, window);
  const { first, last } = periodSpan(p, window);
  const begins = p.start < window.from;
  const ends = addDays(p.end, -1) > window.to; // `end` is the first day after the period
  const edge = begins && ends ? "all the data there is" : begins ? "where the data begins" : "where the data ends";
  return `${dayRange(first, last)}, ${edge}`;
}

/** The legend's line about the dashed dates. */
export function edgeNote(res: Resolution): string {
  const unit = res === "month" ? "month" : "week";
  return `A dashed date is a ${unit} at the start or end of the data, so it holds only some of its days.`;
}

/** The words at the two ends of the legend's colour ramp. Activity's ends are both counts, "0" and "164 in a week";
 * the low end read "None", which is not the opposite of a number (QA 2026-09-26). */
export function legendEnds(metric: Metric, max: number, unit: string): [string, string] {
  return metric === "activity" ? ["0", `${fmtInt(max)} in a ${unit}`] : ["Gloomier", "Happier"];
}

/** How far a selection's mood is from the average, on the 0-100 scale: "25 points above average". A bare "25 above
 * average" left the unit to guess (QA 2026-09-26). */
export function moodGap(d: number): string {
  if (d === 0) return "about average";
  return `${Math.abs(d)} ${Math.abs(d) === 1 ? "point" : "points"} ${d < 0 ? "below" : "above"} average`;
}

/** The tooltips of a topic name and a date on the grid's edges. They are tapped on a phone as often as clicked, so
 * they say what happens, not "Click to" (QA 2026-09-26). */
// A topic's row counts the conversations touching it (D46), so its share is of all conversations, and the rows' shares
// can add up to more than 100%: the words say "touch", never "are about".
export function rowTitle(name: string, total: number, all = 0): string {
  const n = `${fmtInt(total)} ${total === 1 ? "conversation touches" : "conversations touch"} it`;
  const share = all > 0 && total > 0 ? `, ${Math.round((total / all) * 100) || "<1"}% of all ${fmtInt(all)}` : "";
  return `${name}: ${n}${share}. Select the whole row.`;
}
export function columnTitle(period: string): string {
  return `${period}. Select the whole column.`;
}

type Nav = { platform?: string; userAgent?: string; userAgentData?: { platform?: string } };

/**
 * The key that adds a square to a selection, as the reader's own keyboard labels it: ⌘ on a Mac, iPhone or iPad,
 * Ctrl everywhere else. The browser's current platform report comes first; the older `navigator.platform` is frozen or
 * empty in some browsers, and the user agent is the last resort. With nothing to go on it says Ctrl.
 */
export function modifierKey(nav: Nav | undefined): "⌘" | "Ctrl" {
  const p = nav?.userAgentData?.platform || nav?.platform || nav?.userAgent || "";
  return /mac|iphone|ipad|ipod/i.test(p) ? "⌘" : "Ctrl";
}

/** A date range for running text, each date kept whole: "18\u00a0Jun – 24\u00a0Sep". At 768px the Explore header broke
 * between "24" and "Sep" (QA 2026-09-26); a line may still break at the dash. Display only: a question's text keeps
 * plain spaces. */
export function unbrokenDates(range: string): string {
  return range.replace(/(\d) (?=[A-Z])/g, "$1\u00a0");
}
