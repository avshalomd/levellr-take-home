import type { ChatMessage } from "@/lib/agent/ui-types";

// What the chat page says about its last turn when nothing is running, and how a Stop is marked. Kept free
// of React so it is unit-tested (chat-state.test.ts).

/** Under the last turn: "stopped" (the reader pressed Stop), "unfinished" (a question with no answer, and nothing on
 *  the way), or nothing. Both carry an "Ask again", so a question is never left on the page with no way forward. */
export type TurnEnd = "stopped" | "stopped-checks" | "unfinished" | null;

const hasText = (m: ChatMessage) => m.parts.some((p) => p.type === "text" && p.text.trim() !== "");

/**
 * A Stop is written on the last message (`metadata.stopped`), because a Stop after the answer began leaves an
 * assistant message with no words, and a chat reopened from the sidebar then showed the question and nothing else: no
 * note, no answer, no way to ask again (reference QA). An answer with no words is unfinished whatever ended it.
 */
export function turnEnd(messages: ChatMessage[], s: { busy: boolean; failed: boolean }): TurnEnd {
  const last = messages.at(-1);
  if (!last || s.busy || s.failed) return null;
  if (last.metadata?.stopped === "checks") return "stopped-checks";
  if (last.metadata?.stopped) return "stopped";
  if (last.role === "user") return "unfinished";
  return hasText(last) ? null : "unfinished";
}

const CHECKS = new Set(["data-verification", "data-corroboration"]);
const running = (p: ChatMessage["parts"][number]) => CHECKS.has(p.type) && (p as { data?: { status?: string } }).data?.status === "running";

/** The chat as kept after a Stop: its last message marked, so the note survives a reload. A check that was still
 *  running is dropped, or the reopened chat said "Checking each claim…" for ever; and a Stop that only cut the checks
 *  short (the answer's words were all written, which is when checking starts) is marked as such. */
export function markStopped(messages: ChatMessage[]): ChatMessage[] {
  const last = messages.at(-1);
  if (!last) return messages;
  const checking = last.role === "assistant" && last.parts.some((p) => CHECKS.has(p.type));
  const parts = last.parts.filter((p) => !running(p));
  return [...messages.slice(0, -1), { ...last, parts, metadata: { ...last.metadata, stopped: checking ? "checks" : true } }];
}

/** The chat as it is asked again: the Stop mark comes off, or a failed retry would still say "Stopped". */
export function clearStopped(messages: ChatMessage[]): ChatMessage[] {
  const last = messages.at(-1);
  if (!last?.metadata?.stopped) return messages;
  return [...messages.slice(0, -1), { ...last, metadata: { ...last.metadata, stopped: undefined } }];
}

type Box = { getBoundingClientRect(): { top: number; height: number } };

/** The scrollTop that centres `el` in `scroller`, for scrolling that one box with scrollTo. scrollIntoView moves every
 *  scrollable box around the element as well, the page's own <main> among them (QA 2026-09-26). Never above the top. */
export function centredTop(el: Box, scroller: Box & { scrollTop: number; clientHeight: number }): number {
  const e = el.getBoundingClientRect();
  const s = scroller.getBoundingClientRect();
  return Math.max(0, Math.round(scroller.scrollTop + e.top - s.top - (scroller.clientHeight - e.height) / 2));
}
