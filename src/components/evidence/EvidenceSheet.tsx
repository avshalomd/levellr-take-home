"use client";

import { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import { AnimatePresence, motion, useDragControls } from "motion/react";
import { useMediaQuery } from "@/components/shell/use-media-query";
import { focusablesIn, openerOf, returnTarget, wrapTarget, precedesInPage } from "./panel-focus";

// Where the evidence panel lives, by width, always entering and leaving along the same path:
//  - wide (>= 1280px): a column that opens beside the answer, so hovering a claim and watching the tree go together;
//  - medium: a sheet over the right of the page, the answer still visible to its left;
//  - narrow (< 768px): a bottom sheet, dragged down or tapped outside to close.
// Springs are critically damped (no bounce): the panel is an answer to a tap, not a throw. A drag-to-close hands its
// velocity to the exit, which starts from where the finger let go.
// Focus: opening moves it onto the panel (named "Where this comes from" for a screen reader) and closing puts it back
// on the chip that opened it (panel-focus.ts). The two sheets cover the page behind a scrim, so Tab cycles inside
// them. The wide column does not trap Tab: it sits beside the answer by design - the reader hovers claims, asks the
// next question and walks citations with j / k while it stays open - so Tab moves on to the rest of the page.

const spring = { type: "spring", bounce: 0, duration: 0.45 } as const;

// Explore opens a conversation here too (`overlay`): its page has no column for the panel to open beside, so it always
// takes a sheet, and `label` names it for what it holds there (a conversation, not the source of an answer).
export function EvidenceSheet({
  open,
  onClose,
  children,
  overlay = false,
  label = "Where this comes from",
}: {
  open: boolean;
  onClose: () => void;
  children: (handle: ReactNode) => ReactNode;
  overlay?: boolean;
  label?: string;
}) {
  const wide = useMediaQuery("(min-width: 1280px)") && !overlay;
  const narrow = !useMediaQuery("(min-width: 768px)");
  const drag = useDragControls();
  const box = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return;
    const from = openerOf(document.activeElement);
    const panel = box.current;
    panel?.focus({ preventScroll: true });
    return () => {
      const back = from && returnTarget(from);
      const now = document.activeElement;
      // Only focus left in the closing panel, or dropped to the page, is taken back: a click elsewhere keeps its own.
      if (back && (!now || now === document.body || panel?.contains(now))) back.focus({ preventScroll: true });
    };
  }, [open]);

  const trapTab = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== "Tab") return;
    const to = wrapTarget(focusablesIn(e.currentTarget), document.activeElement as HTMLElement | null, e.shiftKey, precedesInPage, e.currentTarget);
    if (to) {
      e.preventDefault();
      to.focus();
    }
  };

  if (wide)
    return (
      <AnimatePresence initial={false}>
        {open && (
          <motion.aside
            key="column"
            ref={box}
            tabIndex={-1}
            aria-label={label}
            data-evidence-panel
            className="h-full shrink-0 overflow-hidden outline-none"
            initial={{ width: 0 }}
            animate={{ width: 480 }}
            exit={{ width: 0 }}
            transition={spring}
          >
            <motion.div
              className="h-full w-[480px] border-l border-foreground/[0.06] bg-background"
              initial={{ x: 40, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: 40, opacity: 0 }}
              transition={spring}
            >
              {children(null)}
            </motion.div>
          </motion.aside>
        )}
      </AnimatePresence>
    );

  const handle = narrow ? (
    <div
      className="flex h-6 shrink-0 cursor-grab touch-none items-center justify-center active:cursor-grabbing"
      onPointerDown={(e) => drag.start(e)}
      aria-hidden
    >
      <span className="h-1 w-9 rounded-full bg-foreground/20" />
    </div>
  ) : null;

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="scrim"
            className="fixed inset-0 z-40 bg-black/20"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            onClick={onClose}
          />
          {narrow ? (
            <motion.aside
              key="bottom"
              ref={box}
              tabIndex={-1}
              onKeyDown={trapTab}
              role="dialog"
              aria-modal="true"
              aria-label={label}
              data-evidence-panel
              className="outline-none fixed inset-x-0 bottom-0 z-50 flex h-[88dvh] flex-col overflow-hidden rounded-t-[22px] bg-background shadow-[0_-12px_40px_-12px_rgb(0_0_0/0.25)]"
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={spring}
              drag="y"
              dragListener={false}
              dragControls={drag}
              dragConstraints={{ top: 0, bottom: 0 }}
              dragElastic={{ top: 0, bottom: 0.7 }}
              onDragEnd={(_, info) => (info.offset.y > 120 || info.velocity.y > 500) && onClose()}
            >
              {children(handle)}
            </motion.aside>
          ) : (
            <motion.aside
              key="side"
              ref={box}
              tabIndex={-1}
              onKeyDown={trapTab}
              role="dialog"
              aria-modal="true"
              aria-label={label}
              data-evidence-panel
              className="outline-none fixed top-2 right-2 bottom-2 z-50 flex w-[min(460px,calc(100vw-1rem))] flex-col overflow-hidden rounded-[20px] bg-background shadow-[0_20px_60px_-20px_rgb(0_0_0/0.35)]"
              initial={{ x: "calc(100% + 1rem)" }}
              animate={{ x: 0 }}
              exit={{ x: "calc(100% + 1rem)" }}
              transition={spring}
            >
              {children(null)}
            </motion.aside>
          )}
        </>
      )}
    </AnimatePresence>
  );
}
