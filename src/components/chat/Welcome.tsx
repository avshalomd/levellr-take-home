"use client";

import { ArrowUpRight } from "lucide-react";
import type { Overview } from "@/lib/data/read";
import { communityInProse } from "@/lib/community";
import { BRIEF_QUESTIONS, topicQuestion } from "@/lib/starters";
import { cn } from "@/lib/utils";
import { shortDate } from "./evidence";

// The empty chat: what the data is (whose community, which weeks, how much of it), then ways in - the brief's own three
// questions and the topics people talk about. Everything here asks a question when tapped. The questions do not wait
// for the overview, so the page is usable even before (or without) it; the counts and topics fill in when it lands.

type Meta = {
  source?: { community?: string };
  window?: { from: string; to: string };
  counts?: { messages?: number; conversations?: number; authors?: number };
};


const n = (x?: number) => (x ?? 0).toLocaleString("en-GB");

export function Welcome({ overview, onAsk }: { overview: Overview | null; onAsk: (q: string) => void }) {
  const meta = (overview?.meta ?? {}) as Meta;
  const c = meta.counts ?? {};
  const topics = (overview?.topics ?? []).filter((t) => t.key !== "other" && t.key !== "unlabelled").sort((a, b) => b.n - a.n);

  return (
    <div className="pt-4 pb-8 sm:pt-14">
      <h1 className="text-[30px] leading-[1.1] font-semibold tracking-[-0.025em] text-balance sm:text-[38px]">
        What is {communityInProse(meta.source?.community, "the Veil of Ages Discord")} talking about?
      </h1>
      {overview ? (
        <p className="mt-4 max-w-[36rem] text-[16px] leading-relaxed text-foreground/70">
          {n(c.messages)} messages in {n(c.conversations)} conversations from {n(c.authors)} people
          {meta.window && `, ${shortDate(meta.window.from)} – ${shortDate(meta.window.to, true)}`}. Every answer points to the
          messages it rests on, and each claim is checked against them.
        </p>
      ) : (
        <div className="mt-4 max-w-[36rem]" aria-busy="true" aria-label="Loading" data-skeleton>
          {TEXT_LINES.map(({ width, phoneOnly }) => (
            <div key={width} className={cn("flex h-[26px] items-center", phoneOnly && "sm:hidden")}>
              <Bar className={cn("h-3.5", width)} />
            </div>
          ))}
        </div>
      )}

      <section className="mt-10" aria-labelledby="try-asking">
        <h2 id="try-asking" className="text-[13px] font-medium text-muted-foreground">
          Try asking
        </h2>
        <div className="mt-3 grid gap-2">
          {BRIEF_QUESTIONS.map((q) => (
            <button
              type="button"
              key={q}
              onClick={() => onAsk(q)}
              className="pressable group flex items-start justify-between gap-3 rounded-2xl border border-foreground/[0.08] bg-background px-4 py-3 text-left text-[15px] leading-snug hover:border-pulse/35 hover:bg-pulse-soft/40"
            >
              {q}
              <ArrowUpRight className="mt-0.5 size-4 shrink-0 text-muted-foreground/60 transition-colors group-hover:text-pulse" aria-hidden />
            </button>
          ))}
        </div>
      </section>

      {!overview ? (
        <div className="mt-10" aria-hidden>
          <div className="flex h-[19.5px] items-center">
            <Bar className="h-2.5 w-28" />
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {CHIP_WIDTHS.map((w, i) => (
              <div key={i} data-skeleton-chip className="h-[35px] max-w-full animate-pulse rounded-full border border-foreground/[0.09] bg-foreground/[0.03]" style={{ width: w }} />
            ))}
          </div>
        </div>
      ) : (
        topics.length > 0 && (
          <section className="mt-10" aria-labelledby="topics">
            <h2 id="topics" className="text-[13px] font-medium text-muted-foreground">
              {/* A conversation keeps every topic it discusses, so the counts overlap and the heading says what they
                  count rather than implying a split of the whole. */}
              What people talk about, by conversations touching each topic
            </h2>
            <div className="mt-3 flex flex-wrap gap-2">
              {topics.map((t) => (
                <button
                  type="button"
                  key={t.key}
                  onClick={() => onAsk(topicQuestion(t.name))}
                  // What a tap asks; the topic's description is written for the labeller, not the reader.
                  title={topicQuestion(t.name)}
                  // The spoken name starts with the words on the chip, so voice control finds it (WCAG 2.5.3).
                  aria-label={`${t.name}, ${n(t.n)} conversations touch it: ask what people are saying`}
                  className="pressable inline-flex items-baseline gap-2 rounded-full border border-foreground/[0.09] px-3.5 py-1.5 text-[14px] hover:border-pulse/35 hover:bg-pulse-soft/40"
                >
                  {t.name}
                  <span className="text-[12px] text-muted-foreground">{n(t.n)}</span>
                </button>
              ))}
            </div>
          </section>
        )
      )}
    </div>
  );
}

// The sentence and the topic chips while the overview loads, at the heights they render at, so nothing jumps when the
// data lands. The phone gets the extra line it wraps to.
const TEXT_LINES = [{ width: "w-full" }, { width: "w-11/12" }, { width: "w-3/5", phoneOnly: true }];
const CHIP_WIDTHS = [200, 170, 185, 190, 155, 200, 160, 205, 150, 195];
const Bar = ({ className }: { className: string }) => <div className={cn("animate-pulse rounded bg-foreground/[0.06]", className)} />;
