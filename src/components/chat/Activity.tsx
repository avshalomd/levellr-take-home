"use client";

import { useState } from "react";
import { BarChart3, BookOpen, Check, ChevronDown, CircleSlash, Compass, Search } from "lucide-react";
import type { ChatMessage } from "@/lib/agent/ui-types";
import { cn } from "@/lib/utils";
import { activitySummary, barFill, barFull, pickChart, rowLabel, seriesCallouts, stepLines, stepsToggleLabel, valueLabel, withoutRefused, type Chart, type StepLine } from "./activity-words";
import { MiniBars } from "./MiniBars";

// What the agent did before answering. One line by default ("Read 840 conversations, searched twice and counted 3
// times"), the steps one click away, and at most one chart: the count the answer most likely rests on, with its
// numbers on it, and never a read's tally (activity-words.ts pickChart). A mood or a share is drawn against its whole
// scale, a count against its largest value (barFull). A turn makes six or seven tool calls; a card per call buried the answer under its own bookkeeping
// (his review, 2026-09-25, DECISIONS D21). Never the raw call, its arguments or its ids.

type Part = ChatMessage["parts"][number];
type ToolPart = Extract<Part, { type: `tool-${string}` }>;
type Progress = { done: number; total: number; relevant: number };

const ICON = { look: Compass, read: BookOpen, search: Search, count: BarChart3 } as const;
const n = (x: number) => x.toLocaleString("en-GB");

export function Activity({
  steps,
  progress,
  topicNames,
  open,
  onOpenChange,
  id,
  settled = true,
  told = "",
}: {
  steps: Part[];
  progress: Map<string, Progress>;
  topicNames: Map<string, string>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  id: string;
  /** False while more steps may still come (the answer's text has not begun after the last one): no chart yet. */
  settled?: boolean;
  /** What the reader was told the answer covers (the question and the answer's first sentence): a count narrowed to a
   *  kind of conversation they were not told about is not drawn (activity-words.ts pickChart). */
  told?: string;
}) {
  // A call the tools refused read nothing and was made again without the flag: it is not one of the steps.
  const parts = withoutRefused(steps as ToolPart[]);
  if (!parts.length) return null;
  const summary = activitySummary(parts, topicNames);
  const live = summary.running ? parts.findLast((p) => p.type === "tool-scan" && p.state !== "output-available") : undefined;
  const liveProgress = live ? progress.get(live.toolCallId) : undefined;
  // The chart waits for the last step: drawn between two steps, it was swapped for a later count while the reader
  // was looking at it.
  const chart = summary.running || !settled ? null : pickChart(parts, topicNames, told);
  // The list, and the count on the button, are the lines shown: a step run three times over is one line.
  const lines = stepLines(parts, topicNames);

  return (
    <section className="mb-6" aria-label="How this was answered">
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        aria-expanded={open}
        aria-controls={id}
        aria-label={stepsToggleLabel(open, summary.text, lines.length)}
        className="group flex max-w-full items-center gap-2.5 rounded-full py-1 pr-2 text-left text-[14px] text-foreground/75 transition-colors hover:text-foreground"
      >
        <span
          className={cn("grid size-6 shrink-0 place-items-center rounded-full", summary.running ? "bg-pulse-soft" : "bg-foreground/[0.05] text-muted-foreground")}
          aria-hidden
        >
          {summary.running ? <span className="breathe size-1.5 rounded-full bg-pulse" /> : <Check className="size-3.5" />}
        </span>
        {/* Two lines on a phone, where one cut "Counted conversations by topic tw…" (QA 2026-09-26); one from sm up. */}
        <span className="line-clamp-2 min-w-0 sm:line-clamp-1" data-steps-headline>
          {summary.text}
        </span>
        <span className="shrink-0 text-[12px] text-muted-foreground">
          {lines.length} {lines.length === 1 ? "step" : "steps"}
        </span>
        <ChevronDown className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform duration-200", open && "rotate-180")} aria-hidden />
      </button>

      {liveProgress && liveProgress.total > 0 && (
        <div className="mt-1.5 ml-[34px] flex items-center gap-3 text-[12px] text-muted-foreground" aria-live="polite">
          <div className="h-1 w-32 overflow-hidden rounded-full bg-foreground/[0.07]">
            <div className="h-full rounded-full bg-pulse transition-[width] duration-300 ease-out" style={{ width: `${(liveProgress.done / liveProgress.total) * 100}%` }} />
          </div>
          <span>
            {n(liveProgress.done)} of {n(liveProgress.total)} read, {n(liveProgress.relevant)} {liveProgress.relevant === 1 ? "bears" : "bear"} on the question so far
          </span>
        </div>
      )}

      {open && (
        <ol id={id} className="mt-2 ml-3 space-y-2 border-l border-foreground/[0.07] pl-[22px]">
          {lines.map((l) => (
            <Step key={l.id} line={l} />
          ))}
        </ol>
      )}

      {chart && <ChartCard chart={chart} topicNames={topicNames} />}
    </section>
  );
}

function Step({ line: { words: w, tool, failed } }: { line: StepLine }) {
  // A step that did not finish gets its own icon, so it does not read as one more step that worked (QA 2026-09-26).
  const Icon = failed ? CircleSlash : ICON[w.kind];
  return (
    <li className="flex gap-2.5 text-[13px] leading-snug scroll-mt-24" data-tool={tool} data-failed={failed || undefined}>
      <Icon className={cn("mt-[3px] size-3.5 shrink-0", w.running ? "text-pulse" : "text-muted-foreground")} aria-hidden />
      <p className="min-w-0">
        <span className="text-foreground/80">{w.text}</span>
        {w.detail && <span className="text-muted-foreground">. {w.detail}</span>}
      </p>
    </li>
  );
}

// People and topics read as labelled bars with their values, the top dozen. A dated series of up to a dozen points
// does too; a longer one draws as columns, with its highest point and its last one said in words, because a column
// chart alone shows a shape and no number. "Latest" means nothing for a list of people, so only a series gets it.
// Periods side by side (July against September) keep their order in time, like a series.
const LIST_MAX = 12;
const isDated = (c: Chart) => c.groupBy === "week" || c.groupBy === "day";

function ChartCard({ chart, topicNames }: { chart: Chart; topicNames: Map<string, string> }) {
  const [all, setAll] = useState(false);
  const format = (v: number) => valueLabel(chart.metric, v);
  const label = (k: string) => rowLabel(k, chart.groupBy, topicNames, chart.span);
  const dated = isDated(chart);
  const inOrder = dated || chart.groupBy === "period"; // kept in time order, and never cut
  const sorted = inOrder ? chart : { ...chart, rows: [...chart.rows].sort((a, b) => b.value - a.value) };
  const hidden = inOrder ? 0 : sorted.rows.length - LIST_MAX;
  // The rows past the top dozen are one tap away: "and 1 more" was a sentence with nothing behind it (QA 2026-09-26).
  const list = all || hidden <= 0 ? sorted : { ...sorted, rows: sorted.rows.slice(0, LIST_MAX) };
  return (
    // Wider from sm up (QA 2026-09-26: at 1440px, 5 of 12 topic names were cut, "Performance & Ac…", in a 28rem card).
    <figure className="mt-3 w-full max-w-md rounded-2xl border border-foreground/[0.07] bg-background p-4 sm:max-w-xl" data-chart={chart.id}>
      <figcaption className="mb-3 text-[13px] leading-snug text-foreground/80">{chart.title}</figcaption>
      {!dated || chart.rows.length <= LIST_MAX ? (
        <>
          <BarList chart={list} format={format} label={label} />
          {hidden > 0 && (
            <button
              type="button"
              onClick={() => setAll(!all)}
              aria-expanded={all}
              // 18px of text: a transparent layer 3px above and below makes it a 24px target (QA 2026-09-26).
              className="relative mt-2 text-[12px] font-medium text-muted-foreground underline decoration-foreground/20 underline-offset-2 before:absolute before:inset-x-0 before:-inset-y-[3px] hover:text-foreground"
            >
              {all ? `Show the top ${LIST_MAX}` : `and ${hidden.toLocaleString("en-GB")} more`}
            </button>
          )}
        </>
      ) : (
        <>
          <MiniBars rows={chart.rows} full={barFull(chart.metric, chart.rows.map((r) => r.value))} format={format} label={label} />
          <Callouts chart={chart} topicNames={topicNames} />
        </>
      )}
    </figure>
  );
}

function BarList({ chart, format, label }: { chart: Chart; format: (v: number) => string; label: (k: string) => string }) {
  const full = barFull(chart.metric, chart.rows.map((r) => r.value));
  return (
    <>
      {/* One grid for all rows (each row a subgrid), so the label column is as wide as the longest label, up to 11rem
          (9rem on a phone, where the bars need the room), and every bar still starts at the same x. */}
      <ul className="grid grid-cols-[fit-content(9rem)_1fr_auto] gap-x-3 gap-y-1.5 sm:grid-cols-[fit-content(11rem)_1fr_auto]">
        {chart.rows.map((r) => {
          return (
            <li key={r.key} className="col-span-3 grid grid-cols-subgrid items-center text-[13px]">
              <span className="flex min-w-0 items-center gap-1.5 text-foreground/75" title={label(r.key)}>
                <span className="truncate">{label(r.key)}</span>
              </span>
              <span className="h-1.5 overflow-hidden rounded-full bg-foreground/[0.06]">
                <span className="block h-full rounded-full bg-pulse/75" style={{ width: `${Math.max(barFill(r.value, full) * 100, 1.5)}%` }} />
              </span>
              <span className="text-right font-medium tabular-nums">{format(r.value)}</span>
            </li>
          );
        })}
      </ul>
    </>
  );
}

function Callouts({ chart, topicNames }: { chart: Chart; topicNames: Map<string, string> }) {
  const c = seriesCallouts(chart, topicNames);
  return (
    <p className="mt-2 flex flex-wrap gap-x-4 gap-y-0.5 text-[12px] text-muted-foreground">
      <span>
        Highest <span className="font-medium text-foreground/85 tabular-nums">{c.peak}</span>
      </span>
      <span>
        Latest <span className="font-medium text-foreground/85 tabular-nums">{c.latest}</span>
      </span>
    </p>
  );
}
