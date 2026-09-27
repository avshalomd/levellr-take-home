import { APP_NAME } from "@/lib/app";
import type { ChatMessage } from "@/lib/agent/ui-types";

// What the chat page says about its last turn when nothing is running, and the tab title of a saved chat. Kept free
// of React so it is unit-tested (chat-state.test.ts).

/** Under the last turn: "stopped" (the reader pressed Stop), "unfinished" (a question with no answer, and nothing on
 *  the way), or nothing. Both carry an "Ask again", so a question is never left on the page with no way forward. */
export type TurnEnd = "stopped" | "stopped-checks" | "unfinished" | null;

const hasText = (m: ChatMessage) => m.parts.some((p) => p.type === "text" && p.text.trim() !== "");

/**
 * A Stop is written on the last message (`metadata.stopped`), because a Stop after the answer began leaves an
 * assistant message with no words, and a chat reopened from the sidebar then showed the question and nothing else: no
 * note, no answer, no way to ask again (QA 2026-09-26). `stopping` covers the moment between the press and that write.
 * An answer with no words is unfinished whatever ended it; `waiting` is a reopened chat whose answer the server is
 * still writing, which says so itself.
 */
export function turnEnd(messages: ChatMessage[], s: { busy: boolean; waiting: boolean; failed: boolean }): TurnEnd {
  const last = messages.at(-1);
  if (!last || s.busy || s.failed) return null;
  if (last.metadata?.stopped === "checks") return "stopped-checks";
  if (last.metadata?.stopped) return "stopped";
  if (last.role === "user") return s.waiting ? null : "unfinished";
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

/** A saved chat's tab title, as the server renders it: the chat's own title (data/chats.ts titleOf) through the
 *  layout's template, "%s · Community Pulse" (app/layout.tsx). */
export const pageTitle = (chatTitle: string) => `${chatTitle} · ${APP_NAME}`;

/** What a dropped connection leaves on the page. The server finishes and saves an answer whether or not the reader is
 *  still connected (api/chat), so "Try again" asked - and paid for - a question whose answer was already saved and
 *  appeared on a reload (QA 2026-09-26). So the page reads the saved chat first: the saved answer to the question on
 *  screen is shown; one still being written is waited for; only when the server has neither is asking again offered.
 *  `onScreen` is the chat as the page shows it; its last question's id is the id the server saved it under. */
export type DropRecovery = { show: "saved" | "wait"; messages: ChatMessage[] } | { show: "retry" };

export function afterDrop(saved: { messages: ChatMessage[]; answering: boolean } | null, onScreen: ChatMessage[]): DropRecovery {
  const q = onScreen.findLastIndex((m) => m.role === "user");
  const question = onScreen[q]?.id;
  if (!saved || !question) return { show: "retry" };
  const i = saved.messages.findLastIndex((m) => m.role === "user");
  if (saved.messages[i]?.id !== question) return { show: "retry" }; // the server never got this question
  const answer = saved.messages[i + 1];
  if (answer?.role === "assistant" && hasText(answer)) return { show: "saved", messages: saved.messages };
  if (!saved.answering) return { show: "retry" };
  // Still being written: the words already streamed stay on screen until the whole answer lands. The saved chat holds
  // only the question by then, and showing it took away the text the reader was reading (review 2026-09-26).
  const partial = onScreen[q + 1];
  const keep = q === onScreen.length - 2 && partial.role === "assistant" && hasText(partial);
  return { show: "wait", messages: keep ? onScreen : saved.messages };
}

type Box = { getBoundingClientRect(): { top: number; height: number } };

/** The scrollTop that centres `el` in `scroller`, for scrolling that one box with scrollTo. scrollIntoView moves every
 *  scrollable box around the element as well, the page's own <main> among them (QA 2026-09-26). Never above the top. */
export function centredTop(el: Box, scroller: Box & { scrollTop: number; clientHeight: number }): number {
  const e = el.getBoundingClientRect();
  const s = scroller.getBoundingClientRect();
  return Math.max(0, Math.round(scroller.scrollTop + e.top - s.top - (scroller.clientHeight - e.height) / 2));
}
