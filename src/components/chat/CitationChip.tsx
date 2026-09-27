"use client";

import { useRef } from "react";
import { cn } from "@/lib/utils";
import { plainMessage } from "@/components/evidence/message-text";
import { shortDate, type Ref } from "./evidence";

// A numbered citation: a small soft chip that opens the message in its thread. It knows its message before the answer
// finishes (the tool result streamed first), so the preview works while the text is still arriving. A citation the
// check found only partly backs its sentence is drawn quieter - dashed, grey - with one plain line in its preview.
// Nothing here is ever red or struck through; a citation to a message that does not exist is never rendered at all.

export type ChipLevel = "backed" | "weak" | "pending";

/** A hit area of 24px around an 18px mark, without changing what is drawn: a transparent layer 3px past each edge
 *  (QA 2026-09-26: the chips were 18px targets 4px apart, under the 24px minimum). The chips in the answer, its number
 *  glyphs and its "+N more" all take it. The layer is placed from inside the border, so a bordered mark (the "+N more"
 *  pill, a weak chip) reaches 1px further: at 3px the pill's area was 22px (QA 2026-09-26). */
export const HIT_AREA = "relative before:absolute before:-inset-[3px] [&.border]:before:-inset-[4px] before:rounded-full";

// The chip's number is 11px. The accent on its soft ground read 4.41:1 in the light theme (QA 2026-09-26), so the
// light theme darkens it, as the grid does its release numbers; the dark theme's lighter accent already reads above
// 4.5:1 on its dark ground. Selected, the dark theme takes the solid accent, as white on its light accent is ~2.7:1.
export const CHIP_TEXT = "text-[color:color-mix(in_oklch,var(--pulse)_80%,black)] dark:text-pulse";
const CHIP_ACTIVE = "bg-pulse text-white dark:bg-pulse-solid";

export function chipClass(level: ChipLevel, active = false) {
  return cn(
    "cite-chip inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-[5px] text-[11px] leading-none font-semibold transition-[background-color,color,box-shadow] duration-150",
    level === "weak"
      ? cn("border border-dashed border-muted-foreground/50", active ? "border-solid border-pulse/60 text-pulse" : "text-muted-foreground")
      : active
        ? CHIP_ACTIVE
        : cn("bg-pulse-soft", CHIP_TEXT),
  );
}

type Rect = { left: number; right: number; top: number; bottom: number };

/**
 * Where a chip's preview card goes: centred over the chip, slid sideways to stay inside the box that clips it (the
 * chat's scroller, itself within the window) with `margin` to spare, and dropped below the chip when there is no room
 * above. At 1440px with the evidence column open, a chip near the column's left edge had its card start at x246 while
 * the chat is cut at x264 (QA 2026-09-26). `shift` is how far from centred, in px.
 */
export function cardPlacement(chip: Rect, clip: Rect, card: { width: number; height: number }, gap = 8, margin = 8) {
  const centre = (chip.left + chip.right) / 2;
  const left = centre - card.width / 2;
  const lo = clip.left + margin;
  const hi = clip.right - margin - card.width;
  const placed = hi < lo ? lo : Math.min(Math.max(left, lo), hi); // a column narrower than the card keeps its start
  const below = chip.top - gap - card.height < clip.top + margin && clip.bottom - chip.bottom > chip.top - clip.top;
  return { shift: Math.round(placed - left), below };
}

/** The box that would cut the card off: its nearest ancestor that clips sideways, never wider than the window, and
 *  sideways never wider than the chat's text column (QA 2026-09-26: at 768px the scroller is the whole window, so the
 *  card's right edge reached x760, 23px past the column's 737, while its left edge kept inside the column). */
function clipRect(from: HTMLElement): Rect {
  let el = from.parentElement;
  while (el && getComputedStyle(el).overflowX === "visible") el = el.parentElement;
  const r = el?.getBoundingClientRect();
  const col = from.closest(".chat-column")?.getBoundingClientRect();
  const w = document.documentElement.clientWidth;
  return {
    left: Math.max(0, r?.left ?? 0, col?.left ?? 0),
    right: Math.min(w, r?.right ?? w, col?.right ?? w),
    top: Math.max(0, r?.top ?? 0),
    bottom: Math.min(window.innerHeight, r?.bottom ?? window.innerHeight),
  };
}

export function CitationChip({
  n,
  id,
  info,
  level,
  active,
  hug = false,
  onOpen,
}: {
  n: number;
  id: string;
  info?: Ref;
  level: ChipLevel;
  active?: boolean;
  /** Punctuation follows: the chip gives up its right margin, which before a "." read as a space (QA 2026-09-26). */
  hug?: boolean;
  onOpen: (id: string) => void;
}) {
  const who = info ? `${info.author}, ${shortDate(info.ts)}` : "a message";
  const card = useRef<HTMLSpanElement>(null);
  // Placed as the pointer arrives: the card is shown by :hover, which already holds when pointerenter fires, so it is
  // measured and moved before it paints.
  const place = (e: React.PointerEvent<HTMLElement>) => {
    const el = card.current;
    if (!el || e.pointerType !== "mouse") return;
    const size = { width: el.offsetWidth || 288, height: el.offsetHeight || 160 };
    const { shift, below } = cardPlacement(e.currentTarget.getBoundingClientRect(), clipRect(e.currentTarget), size);
    el.style.marginLeft = `${shift}px`;
    el.dataset.below = String(below);
  };
  return (
    // 3px each side: two chips side by side sit 6px apart, so their 24px hit areas (3px past each edge) meet and never
    // overlap; at 2px they overlapped by 2px (QA 2026-09-26).
    <span className={cn("group/chip relative inline-block -translate-y-[1px] align-middle", hug ? "ml-[3px]" : "mx-[3px]")} onPointerEnter={place}>
      <button
        type="button"
        data-cite={id}
        onClick={(e) => {
          e.stopPropagation(); // the claim around the chip would open the panel at its first citation instead
          // Safari and Firefox on a Mac do not focus a button on click; the panel returns focus to whatever had it
          // when it opened (evidence/panel-focus.ts), and that should be this chip however it was pressed.
          e.currentTarget.focus({ preventScroll: true });
          onOpen(id);
        }}
        aria-label={`Source ${n}: ${who}${level === "weak" ? ", only partly backs this sentence" : ""}. Show it in its conversation.`}
        className={cn("pressable focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pulse", chipClass(level, active), HIT_AREA)}
      >
        {n}
      </button>
      {info && (
        <span
          ref={card}
          role="tooltip"
          className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-2 hidden w-72 whitespace-normal data-[below=true]:top-full data-[below=true]:bottom-auto data-[below=true]:mt-2 data-[below=true]:mb-0 -translate-x-1/2 rounded-xl border border-foreground/[0.08] bg-popover p-3 text-left text-[13px] leading-relaxed text-popover-foreground shadow-[0_12px_32px_-12px_rgb(0_0_0/0.3)] animate-in fade-in-0 zoom-in-95 group-hover/chip:block [@media(hover:none)]:!hidden"
        >
          <span className="flex items-baseline gap-1.5 text-[12px] text-muted-foreground">
            <span className="truncate font-medium text-foreground">{info.author}</span>
            <span className="shrink-0">{shortDate(info.ts)}</span>
          </span>
          {info.threadTitle && <span className="mt-0.5 block truncate text-[12px] text-muted-foreground">in {info.threadTitle}</span>}
          {/* No `block` here: it would override line-clamp's -webkit-box, and the card sits inside the answer's
              no-wrap span, hence whitespace-normal on the card (QA 2026-09-26: the quote showed one line, cut
              mid-sentence with no ellipsis). */}
          <span data-quote className="mt-1.5 line-clamp-4">{plainMessage(info.text) || "This message was removed."}</span>
          {level === "weak" && <span className="mt-2 block text-[12px] text-muted-foreground">This message only partly backs the sentence.</span>}
        </span>
      )}
    </span>
  );
}
