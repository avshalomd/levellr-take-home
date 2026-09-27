"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { ArrowBigUp, ChevronDown, ChevronRight, MessageSquare, SmilePlus, ThumbsUp } from "lucide-react";
import type { ThreadNode } from "@/lib/data/read";
import { cn } from "@/lib/utils";
import { chipClass, type ChipLevel } from "@/components/chat/CitationChip";
import { shortDate } from "@/components/chat/evidence";
import { plainMessage } from "./message-text";
import { MessageText } from "./MessageText";
import { engagement, type Source } from "./source-words";

// One message as its platform would let you judge it - not a copy of Reddit or Discord, but their signals: who wrote
// it, when, and above all how much engagement it drew, because a reply with a thousand upvotes and one with
// none read differently. The engagement badge leads every row so a column of them scans at a glance.
// Two forms: a full card (the open message and what it answers) and a one-line row (everything around it).
// A Discord export has no permalinks, so nothing links out. A message from an earlier session that a reply here answers
// is context (`context`): it can be read, dimmed and labelled, but it is not part of the conversation that was counted.

export type MessageProps = {
  node: ThreadNode;
  source?: Source;
  num: number; // its citation number in the answer, 0 if not cited
  level: ChipLevel;
  replies: number;
  top: boolean; // the most engaged reply in the conversation
  lit?: boolean; // a hovered claim cites it
  context?: boolean; // from an earlier session, attached because a reply in this one answers it
};

/** What the context label says on a card. */
const CONTEXT_WORDS = "Context · earlier session";

const ICONS = { votes: ArrowBigUp, reactions: SmilePlus, score: ThumbsUp };

/** The engagement badge: the platform's own measure, loud when the message was loud. */
export function Engagement({ node, source, size = "md", top }: { node: Pick<ThreadNode, "score">; source?: Source; size?: "sm" | "md"; top?: boolean }) {
  const e = engagement(source, node.score);
  // No reactions is not news: a "0" badge on most Discord messages was noise. Net votes of 0 still say something.
  if (e.kind !== "votes" && node.score <= 0) return null;
  const Icon = ICONS[e.kind];
  return (
    <span
      title={e.long}
      className={cn(
        "tnum inline-flex shrink-0 items-center gap-0.5 rounded-full font-semibold",
        size === "md" ? "h-7 px-2.5 text-[13px]" : "h-[22px] min-w-[3.25rem] px-1.5 text-[12px]",
        top ? "bg-pulse text-white" : node.score > 0 ? "bg-foreground/[0.06] text-foreground" : "bg-foreground/[0.03] text-muted-foreground",
      )}
    >
      <Icon className={size === "md" ? "size-4" : "size-3.5"} strokeWidth={2} aria-hidden />
      {e.short}
      <span className="sr-only"> {e.unit}</span>
    </span>
  );
}

// A stable soft colour per author, so the same person is recognisable across the thread without a photo.
const hueOf = (name: string) => [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);

function Avatar({ name }: { name: string }) {
  const h = hueOf(name);
  return (
    <span
      aria-hidden
      className="grid size-8 shrink-0 place-items-center rounded-full bg-[oklch(0.93_0.04_var(--h))] text-[13px] font-semibold text-[oklch(0.42_0.09_var(--h))] uppercase dark:bg-[oklch(0.32_0.05_var(--h))] dark:text-[oklch(0.86_0.07_var(--h))]"
      style={{ "--h": h } as React.CSSProperties}
    >
      {name.replace(/^user-/, "").slice(0, 1) || "?"}
    </span>
  );
}

const Mark = ({ children }: { children: React.ReactNode }) => (
  <span className="shrink-0 rounded-full bg-foreground/[0.06] px-2 py-px text-[12px] font-medium text-foreground/75">{children}</span>
);

// A removed message's text is "" (the platform left "[removed]" or "[deleted]" in its place).
const removedText = (n: ThreadNode, text: string) => (n.removed || /^\s*\[(removed|deleted)\]\s*$/i.test(text) ? "" : text);

/** The full card: the open message, or the one it answers. `clamp`: a message shown only as context (what the open
 *  one answers, or an earlier one opened from its line) is cut to a few lines, with a way to read it all. */
export function MessageCard({
  node,
  source,
  num,
  level,
  replies,
  top,
  lit,
  fullText,
  focused,
  label,
  clamp,
  context,
}: MessageProps & { fullText?: string; focused?: boolean; label?: string; clamp?: boolean }) {
  const text = removedText(node, fullText ?? node.text);
  return (
    <article
      data-tag-card={focused ? "focus" : label ? "context" : undefined}
      className={cn(
        "rounded-2xl border bg-background p-4 transition-[box-shadow,border-color] duration-300",
        focused ? "border-foreground/[0.14] shadow-[0_0_0_1.5px_var(--foreground),0_8px_24px_-16px_rgb(0_0_0/0.35)]" : "border-foreground/[0.08]",
        context && !focused && "border-dashed bg-foreground/[0.015] opacity-75",
        lit && "border-pulse/50 shadow-[0_0_0_3px_color-mix(in_oklch,var(--pulse)_22%,transparent)]",
      )}
    >
      {label && <p className="mb-2.5 text-[12px] font-medium text-muted-foreground">{label}</p>}
      <header className="flex items-start gap-2.5">
        <Avatar name={node.author} />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
            <span className="truncate text-[14px] font-semibold">{node.author}</span>
            {num > 0 && <span className={chipClass(level)}>{num}</span>}
            {context && <Mark>{CONTEXT_WORDS}</Mark>}
            {node.removed && <Mark>Removed</Mark>}
            {node.is_bot && <Mark>Bot</Mark>}
          </div>
          {/* A date, as the chips and their previews give it, never "8 days ago": beside a chip saying "17 Sep" the
              reader had to do the sum to see it was the same message, and "ago" counts from today, not from the data. */}
          <p className="text-[12px] text-muted-foreground" title={shortDate(node.ts, true)}>
            {shortDate(node.ts)}
          </p>
        </div>
        <Engagement node={node} source={source} top={top} />
      </header>
      {/* overflow-wrap:anywhere: a long address or an unbroken string wraps inside the card instead of running off it. */}
      {clamp && text ? (
        <Clamped text={text} whole="Show the whole message" />
      ) : (
        <div className={cn("mt-3 text-[14.5px] leading-[1.6] [overflow-wrap:anywhere]", focused ? "text-foreground" : "text-foreground/80")}>
          {text ? <MessageText text={text} /> : <em className="text-muted-foreground">This message was removed.</em>}
        </div>
      )}
      {(replies > 0 || top) && (
        <footer className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted-foreground">
          {replies > 0 && (
            <span className="inline-flex items-center gap-1">
              <MessageSquare className="size-3.5" aria-hidden /> {replies} {replies === 1 ? "reply" : "replies"}
            </span>
          )}
          {top && <span className="font-medium text-pulse">Most engaged reply here</span>}
        </footer>
      )}
    </article>
  );
}

// About four lines of a card's 14.5px text at 1.6 leading (QA 2026-09-26: a reply in the 43.1 patch-notes thread
// opened under a "Replying to" block holding all of the patch notes, 21,000-25,000px tall, with the cited reply far
// below it; the message it answers is context, and a few lines of it are enough to place the reply).
const CLAMP = "max-h-[6.4em]";

/** A context message's text, cut to a few lines with a fade, and a toggle when (and only when) there is more. */
function Clamped({ text, whole }: { text: string; whole: string }) {
  const [open, setOpen] = useState(false);
  const [more, setMore] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  // Measured, not guessed from the length: a short message with a heading can be taller than a long single line.
  // Re-measured when the full text replaces the preview or the panel changes width.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el || open) return;
    const measure = () => setMore(el.scrollHeight > el.clientHeight + 1);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [text, open]);
  return (
    <>
      <div
        ref={box}
        // Tabbing onto a link in the cut-off part opens the text, so keyboard focus never sits out of sight.
        onFocusCapture={(e) => !open && more && e.target.matches(":focus-visible") && setOpen(true)}
        className={cn(
          "mt-3 text-[14.5px] leading-[1.6] text-foreground/80 [overflow-wrap:anywhere]",
          // clip, not hidden: a hidden box still scrolls itself to show a focused link inside it.
          !open && [CLAMP, "overflow-clip"],
          !open && more && "[mask-image:linear-gradient(to_bottom,black_55%,transparent)]",
        )}
      >
        <MessageText text={text} />
      </div>
      {(more || open) && (
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          className="mt-1.5 inline-flex items-center gap-1 text-[13px] font-medium text-pulse hover:underline"
        >
          {open ? "Show less" : whole}
          <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} aria-hidden />
        </button>
      )}
    </>
  );
}

/** The one-line row: engagement first, then who, then the opening words. */
export function MessageLine({ node, source, num, level, replies, top, lit, context, onClick, hint, current }: MessageProps & { onClick: () => void; hint: string; current?: boolean }) {
  const text = plainMessage(removedText(node, node.text)).split("\n").find((l) => l.trim()) ?? "";
  return (
    <button
      type="button"
      onClick={onClick}
      title={hint}
      aria-current={current || undefined}
      className={cn(
        "pressable group flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors hover:bg-foreground/[0.04]",
        lit && "bg-pulse-soft shadow-[inset_0_0_0_1px_color-mix(in_oklch,var(--pulse)_40%,transparent)]",
        current && "shadow-[inset_0_0_0_1.5px_var(--foreground)]",
        context && !current && "opacity-60",
      )}
    >
      <Engagement node={node} source={source} size="sm" top={top} />
      {num > 0 && <span className={chipClass(level)}>{num}</span>}
      <span className="max-w-[38%] shrink-0 truncate text-[13px] font-medium">{node.author}</span>
      <span className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground">
        {context && <span className="mr-1.5 rounded-full bg-foreground/[0.06] px-1.5 py-px text-[11px] font-medium text-foreground/70">context</span>}
        {text || "This message was removed."}
      </span>
      {replies > 0 && (
        <span className="tnum inline-flex shrink-0 items-center gap-0.5 text-[12px] text-muted-foreground">
          <MessageSquare className="size-3" aria-hidden /> {replies}
        </span>
      )}
      <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/60 transition-transform group-hover:translate-x-0.5" aria-hidden />
    </button>
  );
}
