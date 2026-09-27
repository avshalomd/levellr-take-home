"use client";

import { ArrowUpRight } from "lucide-react";
import type { Overview } from "@/lib/data/read";
import { starterQuestions, topicQuestion } from "@/lib/starters";
import { cn } from "@/lib/utils";
import { shortDate } from "./evidence";

// The empty chat: what the data is (whose community, which weeks, how much of it), then ways in - questions written
// from the data itself and the topics people talk about. Everything here asks a
// question when tapped. It replaces the old dataset column: the reader sees what the bot can know before asking.

type Meta = {
  source?: { community?: string };
  window?: { from: string; to: string };
  counts?: { messages?: number; conversations?: number; authors?: number };
};

const n = (x?: number) => (x ?? 0).toLocaleString("en-GB");

export function Welcome({ overview, onAsk }: { overview: Overview | null; onAsk: (q: string) => void }) {
  if (!overview) return <WelcomeSkeleton />;
  const meta = overview.meta as Meta;
  const c = meta.counts ?? {};
  const topics = overview.topics.filter((t) => t.key !== "other" && t.key !== "unlabelled").sort((a, b) => b.n - a.n);
  const questions = starterQuestions(overview.topics);

  return (
    <div className="pt-4 pb-8 sm:pt-14">
      <h1 className="text-[30px] leading-[1.1] font-semibold tracking-[-0.025em] text-balance sm:text-[38px]">
        What is {meta.source?.community ?? "the community"} talking about?
      </h1>
      <p className="mt-4 max-w-[36rem] text-[16px] leading-relaxed text-foreground/70">
        {n(c.messages)} messages in {n(c.conversations)} conversations from {n(c.authors)} people
        {meta.window && `, ${shortDate(meta.window.from)} – ${shortDate(meta.window.to, true)}`}. Every answer points to the
        messages it rests on, and each claim is checked against them.
      </p>

      <section className="mt-10" aria-labelledby="try-asking">
        <h2 id="try-asking" className="text-[13px] font-medium text-muted-foreground">
          Try asking
        </h2>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {questions.map((q) => (
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

      {topics.length > 0 && (
        <section className="mt-10" aria-labelledby="topics">
          <h2 id="topics" className="text-[13px] font-medium text-muted-foreground">
            {/* A conversation keeps every topic it discusses (D46), so the counts overlap and the heading says what
                they count rather than implying a split of the whole. */}
            What people talk about, by conversations touching each topic
          </h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {topics.map((t) => (
              <button
                type="button"
                key={t.key}
                onClick={() => onAsk(topicQuestion(t.name))}
                // What a tap asks. The topic's description is written for the labeller ("...excluding esports news
                // or requests for advice") and read as internal notes (QA 2026-09-26).
                title={topicQuestion(t.name)}
                // The spoken name starts with the words on the chip, so "click Cheating and Bans" finds it by voice
                // (QA 2026-09-26: it was the question alone, which the chip never shows).
                aria-label={`${t.name}, ${n(t.n)} conversations touch it: ask what people are saying`}
                className="pressable inline-flex items-baseline gap-2 rounded-full border border-foreground/[0.09] px-3.5 py-1.5 text-[14px] hover:border-pulse/35 hover:bg-pulse-soft/40"
              >
                {t.name}
                <span className="text-[12px] text-muted-foreground">{n(t.n)}</span>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

// The page's own shape while the overview loads: the title, the sentence under it, six question cards and the topic
// chips, at the heights they render at (measured 26 Sep: a two-line card 67px, a chip 35px). Two bars and four pills in its place made the whole page jump when the data landed (QA 2026-09-26).
// The phone gets the extra title and sentence line it wraps to.
const TITLE_LINES = [{ width: "w-full" }, { width: "w-4/5" }, { width: "w-1/2", phoneOnly: true }];
const TEXT_LINES = [{ width: "w-full" }, { width: "w-11/12" }, { width: "w-3/5" }, { width: "w-2/5", phoneOnly: true }];
const CHIP_WIDTHS = [200, 170, 185, 190, 155, 200, 160, 205, 150, 195, 175, 165];
const Bar = ({ className }: { className: string }) => <div className={cn("animate-pulse rounded bg-foreground/[0.06]", className)} />;
const Heading = () => (
  <div className="flex h-[19.5px] items-center">
    <Bar className="h-2.5 w-28" />
  </div>
);

function WelcomeSkeleton() {
  return (
    <div className="pt-4 pb-8 sm:pt-14" aria-busy="true" aria-label="Loading" data-skeleton>
      {TITLE_LINES.map(({ width, phoneOnly }) => (
        <div key={width} className={cn("flex h-[33px] items-center sm:h-[42px]", phoneOnly && "sm:hidden")}>
          <Bar className={cn("h-6 rounded-lg sm:h-[30px]", width)} />
        </div>
      ))}
      <div className="mt-4 max-w-[36rem]">
        {TEXT_LINES.map(({ width, phoneOnly }) => (
          <div key={width} className={cn("flex h-[26px] items-center", phoneOnly && "sm:hidden")}>
            <Bar className={cn("h-3.5", width)} />
          </div>
        ))}
      </div>

      <div className="mt-10">
        <Heading />
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} data-skeleton-card className="h-[67px] animate-pulse rounded-2xl border border-foreground/[0.08] bg-foreground/[0.03]" />
          ))}
        </div>
      </div>

      <div className="mt-10">
        <Heading />
        <div className="mt-3 flex flex-wrap gap-2">
          {CHIP_WIDTHS.map((w, i) => (
            <div key={i} data-skeleton-chip className="h-[35px] max-w-full animate-pulse rounded-full border border-foreground/[0.09] bg-foreground/[0.03]" style={{ width: w }} />
          ))}
        </div>
      </div>
    </div>
  );
}
