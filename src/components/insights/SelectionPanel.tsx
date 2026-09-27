"use client";

import { AnimatePresence, motion, useReducedMotion, type PanInfo } from "motion/react";
import { ArrowUp, ArrowUpRight, X } from "lucide-react";
import { useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { dayMonth, fmtInt, moodOf, plural, type Agg } from "@/lib/data/insights-model";
import type { Described, Suggestion } from "@/lib/data/insights-question";
import type { Session } from "@/lib/data/insights";
import type { Voice } from "@/lib/data/voices";
import { modifierKey, moodGap } from "./explore-words";
import { SPRING } from "./Segmented";

export type Detail =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "error" }
  | { state: "ready"; totals: Agg; people: number; sessions: Session[]; voices: Voice[] };

/** The question being prepared for the chat: prefilled from the selection, editable, rewritten by the chips. */
export type Draft = {
  question: string;
  setQuestion: (q: string) => void;
  suggestions: Suggestion[];
  ask: (q: string) => void;
};

type Props = {
  described: Described;
  // Distinct conversations (insights-selection.ts selectionTotals): summed from the grid while the squares are all in
  // one topic's row, else the server's count; null until that arrives.
  combined: Agg | null;
  population: Agg; // every conversation in the dataset
  inPeriods: number; // all conversations in the selected periods, every topic
  detail: Detail;
  draft: Draft;
  onClear: () => void;
  onRetry: () => void;
};

/** What a selection holds, and the way into the chat. Rendered inside the side column or the bottom sheet. */
export function SelectionBody({
  described,
  combined,
  population,
  inPeriods,
  detail,
  draft,
  onClear,
  onRetry,
}: Props) {
  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-[19px] leading-snug font-semibold tracking-[-0.01em] text-foreground">
            {described.title}
          </h2>
          {/* The dates only: a count of squares means nothing to a reader; the conversations are counted below. */}
          <p className="mt-0.5 text-[14px] text-muted-foreground">{described.when}</p>
        </div>
        <button
          type="button"
          onClick={onClear}
          aria-label="Clear the selection"
          className="pressable -mt-1 -mr-1 grid size-8 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </header>

      <AskBox draft={draft} chips />

      <Counts combined={combined} inPeriods={inPeriods} detail={detail} />
      <Mood combined={combined} population={population} />
      <Sessions detail={detail} onRetry={onRetry} onAsk={draft.ask} />
      <Voices detail={detail} onAsk={draft.ask} />
    </div>
  );
}

// ---------- the question ----------

/** The question as an editable field, with Ask beside it and, under it, one-tap rewrites of the whole question. Enter
 * asks; Shift+Enter starts a new line. */
export function AskBox({
  draft,
  chips = false,
  compact = false,
}: {
  draft: Draft;
  chips?: boolean;
  compact?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const text = draft.question.trim();
  // Grow with the text (the field is prefilled, so it has to fit the question without a scrollbar).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [draft.question]);
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-col rounded-2xl border border-foreground/[0.12] bg-background p-1.5 pl-3 transition-colors focus-within:border-pulse/60 focus-within:ring-3 focus-within:ring-pulse/15">
        <label className="min-w-0">
          <span className="sr-only">Question to ask</span>
          <textarea
            ref={ref}
            rows={2}
            value={draft.question}
            onChange={(e) => draft.setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                if (text) draft.ask(text);
              }
            }}
            className="block max-h-48 w-full resize-none bg-transparent py-1.5 text-[14.5px] leading-snug text-foreground outline-none placeholder:text-muted-foreground"
            placeholder="Ask anything about this selection"
          />
        </label>
        <div className="flex items-center justify-between gap-2 pt-1">
          <span className="text-[12px] text-muted-foreground">{compact ? "" : "Edit it if you like"}</span>
          <button
            type="button"
            disabled={!text}
            onClick={() => draft.ask(text)}
            // bg-pulse-solid, not bg-pulse: white on the dark theme's light-blue accent is 2.8:1 (globals.css --pulse-solid;
            // QA 2026-09-26). Pinned by e2e/explore.spec.ts.
            className="pressable flex h-9 shrink-0 items-center gap-1.5 rounded-xl bg-pulse-solid px-3.5 text-[14px] font-semibold text-white shadow-[0_1px_2px_rgb(0_0_0/0.12)] hover:brightness-110 disabled:opacity-40"
          >
            Ask
            <ArrowUp className="size-4" />
          </button>
        </div>
      </div>
      {chips && draft.suggestions.length > 1 && (
        <div role="group" aria-label="Other ways to ask" className="flex flex-wrap gap-1.5">
          {draft.suggestions.map((s) => {
            const on = s.question === draft.question;
            return (
              <button
                key={s.id}
                type="button"
                aria-pressed={on}
                title={s.question}
                onClick={() => draft.setQuestion(s.question)}
                className={cn(
                  "pressable rounded-full border px-3 py-1 text-[13px] transition-colors",
                  on
                    ? "border-pulse/50 bg-pulse/[0.09] font-medium text-foreground"
                    : "border-foreground/[0.1] text-foreground/80 hover:border-foreground/25 hover:text-foreground",
                )}
              >
                {s.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------- the numbers ----------

const placeholder = <span className="inline-block h-6 w-12 animate-pulse rounded-md bg-foreground/[0.07] align-middle" />;

function Counts({ combined, inPeriods, detail }: { combined: Agg | null; inPeriods: number; detail: Detail }) {
  const big = (value: ReactNode, label: string) => (
    <div className="min-w-0">
      <div className="text-[22px] leading-tight font-semibold tracking-[-0.02em] text-foreground">
        {value}
      </div>
      <div className="text-[12.5px] leading-snug text-muted-foreground">{label}</div>
    </div>
  );
  return (
    <section aria-label="Counts for the selection" className="flex flex-col gap-3">
      <div className="grid grid-cols-3 gap-3">
        {big(combined ? fmtInt(combined.n) : placeholder, combined?.n === 1 ? "conversation" : "conversations")}
        {big(detail.state === "ready" ? fmtInt(detail.people) : placeholder, detail.state === "ready" && detail.people === 1 ? "person" : "people")}
        {big(combined ? fmtInt(combined.engagement) : placeholder, "engagement score")}
      </div>
      <p className="text-[13px] text-muted-foreground">{combined ? shareWords(combined, inPeriods) : "Counting the conversations…"}</p>
    </section>
  );
}

/** The selection as a share of every conversation in its periods. The selection's conversations are distinct (one
 *  touching two selected topics counts once), so the share is of conversations touching the selected topics. */
export function shareWords(combined: Agg, inPeriods: number): string {
  const share = inPeriods ? combined.n / inPeriods : 0;
  const messages = plural(combined.messages, "message", "messages");
  return share >= 0.995
    ? `Every conversation in that time, ${messages} in all.`
    : `${Math.max(1, Math.round(share * 100))}% of the ${fmtInt(inPeriods)} conversations in that time touch this, ${messages} in all.`;
}

/** The selection's mood beside the average of every conversation, as two numbers and one 0-100 track. */
function Mood({ combined, population }: { combined: Agg | null; population: Agg }) {
  const reduce = useReducedMotion();
  if (!combined) return <div aria-hidden className="h-[92px] animate-pulse rounded-xl bg-foreground/[0.04]" />;
  const v = moodOf(combined),
    base = moodOf(population);
  if (Number.isNaN(v) || Number.isNaN(base)) return null;
  const d = Math.round(v) - Math.round(base);
  const tint = d === 0 ? "var(--muted-foreground)" : d < 0 ? "var(--neg)" : "var(--pos)";
  const lo = Math.min(v, base),
    hi = Math.max(v, base);
  return (
    <section aria-label="Mood">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-[13px] font-semibold text-foreground">Mood</h3>
        <span className="text-[12.5px] text-muted-foreground">
          {moodGap(d)}
        </span>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-3">
        <div>
          {/* Bold, so the tinted number is large text (WCAG: 18.66px bold, 3:1): semibold, the light theme's tint read
              3.45:1 against the 4.5:1 that smaller or lighter text needs (QA 2026-09-26). */}
          <div
            className="text-[22px] leading-tight font-bold tracking-[-0.02em]"
            style={{ color: d === 0 ? undefined : tint }}
          >
            {Math.round(v)}
          </div>
          <div className="text-[12.5px] text-muted-foreground">this selection</div>
        </div>
        <div>
          <div className="text-[22px] leading-tight font-bold tracking-[-0.02em] text-foreground/70">
            {Math.round(base)}
          </div>
          <div className="text-[12.5px] text-muted-foreground">
            all {fmtInt(population.moodN)} conversations
          </div>
        </div>
      </div>
      <div className="relative mt-2.5 h-1.5 rounded-full bg-foreground/[0.07]" aria-hidden>
        <motion.div
          className="absolute inset-y-0 rounded-full"
          style={{ background: tint }}
          initial={false}
          animate={{ left: `${lo}%`, width: `${Math.max(0.8, hi - lo)}%` }}
          transition={reduce ? { duration: 0 } : SPRING}
        />
        <div
          className="absolute -top-[3px] h-3 w-[2px] -translate-x-1/2 rounded-full bg-foreground/55"
          style={{ left: `${base}%` }}
        />
      </div>
      <div className="mt-1 flex justify-between text-[11.5px] text-muted-foreground" aria-hidden>
        <span>0, very negative</span>
        <span>100, very positive</span>
      </div>
    </section>
  );
}

// ---------- the sessions ----------

// Discord has no threads or titles here: the busiest sessions (D3) stand in for the busiest threads, named by
// their channel and first message. Asking about one names its convN handle, which the chat's read_conversation takes.
function Sessions({ detail, onRetry, onAsk }: { detail: Detail; onRetry: () => void; onAsk: (q: string) => void }) {
  return (
    <section>
      <h3 className="mb-2 text-[13px] font-semibold text-foreground">Busiest conversations</h3>
      {detail.state === "error" ? (
        <div className="rounded-lg bg-foreground/[0.04] px-3 py-2.5 text-[13px] text-muted-foreground">
          The conversations did not load.{" "}
          <button type="button" onClick={onRetry} className="font-medium text-pulse hover:underline">
            Try again
          </button>
        </div>
      ) : detail.state !== "ready" ? (
        <ul className="flex flex-col gap-2" aria-busy>
          {[0, 1, 2].map((i) => (
            <li key={i} className="h-12 animate-pulse rounded-lg bg-foreground/[0.05]" />
          ))}
        </ul>
      ) : detail.sessions.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">No conversations here.</p>
      ) : (
        <ol className="-mx-2 flex flex-col">
          {detail.sessions.map((t) => (
            <li key={t.sessionId}>
              <button
                type="button"
                onClick={() => onAsk(`What did people say in conv${t.ref} in #${t.channel}?`)}
                title="Ask about this conversation"
                className="group flex w-full items-start gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-foreground/[0.04]"
              >
                <span className="min-w-0 flex-1">
                  <span className="line-clamp-2 text-[13.5px] leading-snug text-foreground">
                    <span className="text-muted-foreground">#{t.channel}</span> {t.opening}
                  </span>
                  <span className="mt-0.5 block text-[12px] text-muted-foreground">
                    {dayMonth(t.started)}, {plural(t.messages, "message", "messages")},{" "}
                    engagement score {fmtInt(t.engagement)}
                  </span>
                </span>
                <ArrowUpRight className="mt-0.5 size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

// ---------- the people ----------

/** Who wrote most here: the regulars and loud voices behind the numbers above. A name asks the chat about that person. */
function Voices({ detail, onAsk }: { detail: Detail; onAsk: (q: string) => void }) {
  if (detail.state !== "ready" || detail.voices.length === 0) return null;
  const top = detail.voices[0].messages || 1;
  return (
    <section>
      <h3 className="mb-2 text-[13px] font-semibold text-foreground">Most active people</h3>
      <ol className="-mx-2 flex flex-col">
        {detail.voices.map((v) => (
          <li key={v.author}>
            <button
              type="button"
              onClick={() => onAsk(`What does ${v.author} talk about, and how do people respond to them?`)}
              title={`Ask about ${v.author}`}
              className="group flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-foreground/[0.04]"
            >
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-[13.5px] text-foreground">{v.author}</span>
                  <span className="shrink-0 text-[12px] text-muted-foreground tabular-nums">{plural(v.messages, "message", "messages")}</span>
                </span>
                <span className="mt-1 block h-1 overflow-hidden rounded-full bg-foreground/[0.05]">
                  <span className="block h-full rounded-full bg-pulse/60" style={{ width: `${(v.messages / top) * 100}%` }} />
                </span>
                <span className="mt-1 block text-[12px] text-muted-foreground" title="Reactions to all their messages in these conversations">
                  {plural(v.conversations, "conversation", "conversations")}
                  {v.started > 0 && `, started ${fmtInt(v.started)}`}, {plural(v.reactions, "reaction", "reactions")}
                </span>
              </span>
              <ArrowUpRight className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}

// ---------- the containers ----------

/**
 * How the side column's content arrives when it changes: drawn whole on its first frame, sliding only the last few
 * pixels in, with nothing to wait for on the way out. It used to wait for the old content to fade out and then fade in
 * from nothing, so a busy moment (Weeks -> Days draws some 1,300 squares) left an empty card for a second or two before
 * the help appeared (QA 2026-09-26). Never an opacity here: pinned by SelectionPanel.test.tsx.
 */
export const sideEnter = (reduce: boolean) => ({ initial: reduce ? (false as const) : { x: 8 }, animate: { x: 0 }, transition: SPRING });

/** Wide screens: a column beside the grid that is always there, quietly explaining itself until something is chosen. */
export function SideColumn({ open, children }: { open: boolean; children: ReactNode }) {
  const reduce = useReducedMotion() ?? false;
  return (
    <aside data-selection-panel className="sticky top-6 max-h-[calc(100dvh-3rem)] w-[340px] shrink-0 overflow-y-auto overscroll-contain rounded-2xl border border-foreground/[0.07] bg-card p-5 [scrollbar-width:thin]">
      <motion.div key={open ? "sel" : "empty"} {...sideEnter(reduce)}>
        {open ? children : <EmptyHint />}
      </motion.div>
    </aside>
  );
}

const noop = () => () => {};

export function EmptyHint() {
  // Read in the browser after hydration: the server cannot know the reader's keyboard, so its HTML says Ctrl and a Mac
  // swaps in ⌘ without a hydration mismatch.
  const mod = useSyncExternalStore(noop, () => modifierKey(navigator), () => "Ctrl");
  const keys = (k: string) => (
    <kbd className="rounded-[5px] border border-foreground/10 bg-foreground/[0.04] px-1.5 py-px font-sans text-[12px] text-foreground/80">
      {k}
    </kbd>
  );
  return (
    <div className="flex flex-col gap-4 text-[14px] leading-relaxed text-muted-foreground">
      <h2 className="text-[19px] leading-snug font-semibold tracking-[-0.01em] text-foreground">
        Choose a topic and a time
      </h2>
      <p>Select a square to see one topic in one period, or drag across several to combine them.</p>
      <ul className="flex flex-col gap-2 text-[13.5px]">
        <li>{keys(mod)} click somewhere else to compare the two</li>
        <li>{keys("Shift")} click to stretch the selection</li>
        {/* Device-neutral: a click, a tap or the keyboard all reach a topic or a date (QA 2026-09-26, grid-keys.ts). */}
        {/* Plain words for the keyboard route (QA 2026-09-26: "arrow left or up past the first square" read awkwardly). */}
        <li>
          Select a topic or a date to take its whole row or column. Use the arrow keys to move; go left or up from the
          first square to reach the topic names and dates.
        </li>
        <li>{keys("Esc")} to start again</li>
      </ul>
      <p className="text-[13.5px]">
        You will see the numbers behind it, the busiest conversations, and a question you can edit before you ask
        it.
      </p>
    </div>
  );
}

/** Narrow screens: a translucent sheet that rises from the bottom. Drag it down to close, up to see everything. */
export function BottomSheet({
  open,
  insets,
  expanded,
  setExpanded,
  onClose,
  onHeight,
  peek,
  children,
}: {
  open: boolean;
  insets: { left: number; right: number }; // px from the screen's edges: the page column, clear of the sidebar
  expanded: boolean;
  setExpanded: (x: boolean) => void;
  onClose: () => void;
  onHeight?: (px: number) => void; // the sheet's height, so the grid can be scrolled clear of it
  peek: ReactNode;
  children: ReactNode;
}) {
  const reduce = useReducedMotion();
  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.y > 60 || info.velocity.y > 500) {
      if (expanded) setExpanded(false);
      else onClose();
    } else if (info.offset.y < -40 || info.velocity.y < -500) setExpanded(true);
  };
  // The sheet's own height, measured: the spacer below the grid is exactly that tall, so the grid's last rows can
  // always be scrolled up out from under it. A fixed 320px spacer was shorter than the sheet at some widths, and at
  // 1024px the sheet hid the lower topic names while "Add squares" asked the reader to pick more (QA 2026-09-26).
  const sheet = useRef<HTMLDivElement>(null);
  // What the grid clears is the sheet as it rests, not as it is while pulled up to show everything: a spacer as tall
  // as the expanded sheet left a gap below the grid once it came down. Closed, it takes no room at all (review
  // 2026-09-26: the height was never set back to 0).
  const [resting, setResting] = useState(0);
  const expandedNow = useRef(expanded);
  useLayoutEffect(() => {
    expandedNow.current = expanded;
  }, [expanded]);
  useLayoutEffect(() => {
    const el = sheet.current;
    if (!open || !el) return;
    const ro = new ResizeObserver(() => {
      if (!expandedNow.current) setResting(el.offsetHeight);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [open]);
  useLayoutEffect(() => onHeight?.(open ? resting : 0), [open, resting, onHeight]);
  // Fixed to the screen, not sticky: a sticky sheet cannot rise above the top of its section, so on a short page the
  // expanded sheet ran 84px past the bottom of a phone (QA 2026-09-25). It sits flush on the screen's bottom edge, as
  // a sheet does: 12px above it, a strip of squares showed underneath (QA 2026-09-26). It stays non-modal (no scrim,
  // nothing dimmed), because the reader keeps picking squares with it open.
  return (
    <>
      {open && <div aria-hidden style={{ height: resting || 320 }} />}
      <div className="pointer-events-none fixed bottom-0 z-30" style={insets}>
        <AnimatePresence>
          {open && (
            <motion.div
              key="sheet"
              ref={sheet}
              role="region"
              aria-label="Selection"
              data-selection-panel
              initial={reduce ? { opacity: 0 } : { y: "110%" }}
              animate={reduce ? { opacity: 1 } : { y: 0 }}
              exit={reduce ? { opacity: 0 } : { y: "110%" }}
              transition={reduce ? { duration: 0.15 } : { type: "spring", bounce: 0, duration: 0.4 }}
              drag={reduce ? false : "y"}
              dragConstraints={{ top: 0, bottom: 0 }}
              dragElastic={{ top: 0.08, bottom: 0.5 }}
              onDragEnd={onDragEnd}
              className="pointer-events-auto mx-auto w-full max-w-xl rounded-t-[22px] border border-b-0 border-foreground/[0.08] bg-background/[0.94] pb-[env(safe-area-inset-bottom)] shadow-[0_-8px_40px_-12px_rgb(0_0_0/0.35)] backdrop-blur-xl"
            >
              <button
                type="button"
                onClick={() => setExpanded(!expanded)}
                aria-label={expanded ? "Show less" : "Show everything"}
                aria-expanded={expanded}
                className="flex w-full justify-center pt-2 pb-1"
              >
                <span className="h-1 w-9 rounded-full bg-foreground/20" />
              </button>
              <div
                className={cn(
                  "overflow-y-auto overscroll-contain px-4 pb-4",
                  expanded ? "max-h-[min(70dvh,calc(100dvh-6rem))]" : "max-h-[45dvh]",
                )}
              >
                {expanded ? children : peek}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </>
  );
}

/** The collapsed sheet: what is selected, the question, and Ask. */
export function SelectionPeek({
  described,
  combined,
  draft,
  onMore,
  onClear,
  adding,
  onAdding,
}: {
  described: Described;
  combined: Agg | null;
  draft: Draft;
  onMore: () => void;
  onClear: () => void;
  adding: boolean;
  onAdding: (on: boolean) => void;
}) {
  return (
    <div className="flex flex-col gap-3 pt-1">
      {/* Title and close share the top line, the dates and count get the next one whole, and the two actions sit under
          them: side by side on one line, a phone cut the title to "Highlight…" and wrapped the count over three lines
          (QA 2026-09-25). */}
      <div className="flex items-start gap-3">
        <button type="button" onClick={onMore} className="min-w-0 flex-1 text-left">
          <div className="truncate text-[16px] font-semibold text-foreground">{described.title}</div>
          <div className="truncate text-[13px] text-muted-foreground">
            {described.when}
            {combined && `, ${plural(combined.n, "conversation", "conversations")}`}
          </div>
        </button>
        <button
          type="button"
          onClick={onClear}
          aria-label="Clear the selection"
          className="pressable -mt-1 -mr-1 grid size-8 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-foreground/[0.06]"
        >
          <X className="size-4" />
        </button>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          aria-pressed={adding}
          onClick={() => onAdding(!adding)}
          className={cn(
            "pressable shrink-0 rounded-full border px-3 py-1 text-[13px] font-medium",
            adding
              ? "border-pulse/40 bg-pulse/10 text-pulse"
              : "border-foreground/10 bg-background/60 text-foreground",
          )}
        >
          {adding ? "Done" : "Add squares"}
        </button>
        <button
          type="button"
          onClick={onMore}
          className="pressable shrink-0 rounded-full border border-foreground/10 bg-background/60 px-3 py-1 text-[13px] font-medium text-foreground"
        >
          Details
        </button>
      </div>
      {adding && (
        <p className="text-[13px] text-muted-foreground">
          Tap squares to add or remove them. Two separate groups are compared.
        </p>
      )}
      <AskBox draft={draft} compact />
    </div>
  );
}
