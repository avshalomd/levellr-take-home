import { describe, expect, it } from "vitest";
import type { ChatMessage } from "@/lib/agent/ui-types";
import { afterDrop, centredTop, clearStopped, markStopped, pageTitle, turnEnd } from "./chat-state";

const user = (id = "u1"): ChatMessage => ({ id, role: "user", parts: [{ type: "text", text: "How do players feel about the anti-cheat?" }] });
const answer = (text: string, metadata?: ChatMessage["metadata"]): ChatMessage => ({ id: "a1", role: "assistant", metadata, parts: text ? [{ type: "text", text }] : [] });
const idle = { busy: false, waiting: false, failed: false };

describe("turnEnd", () => {
  it("says nothing under an answered question, or while an answer is being written or has failed", () => {
    expect(turnEnd([user(), answer("Mostly angry.")], idle)).toBeNull();
    expect(turnEnd([user()], { ...idle, busy: true })).toBeNull();
    expect(turnEnd([user()], { ...idle, failed: true })).toBeNull();
    expect(turnEnd([], idle)).toBeNull();
  });

  // QA 2026-09-26: a chat stopped after its answer began, reopened from the sidebar, showed the question alone.
  it("calls a question with no answer, or an answer with no words, unfinished", () => {
    expect(turnEnd([user()], idle)).toBe("unfinished");
    expect(turnEnd([user(), answer("")], idle)).toBe("unfinished");
    expect(turnEnd([user(), answer("   ")], idle)).toBe("unfinished");
  });

  it("says a stopped turn was stopped, and after a reload", () => {
    expect(turnEnd(markStopped([user(), answer("Mostly")]), idle)).toBe("stopped");
    expect(turnEnd(markStopped([user()]), idle)).toBe("stopped");
  });

  it("leaves a reopened chat whose answer is still being written to its own note", () => {
    expect(turnEnd([user()], { ...idle, waiting: true })).toBeNull();
  });
});

describe("markStopped and clearStopped", () => {
  it("marks only the last message, keeping its metadata, and takes the mark off again", () => {
    const kept = markStopped([user(), answer("Mostly", { ms: 900 })]);
    expect(kept[0].metadata).toBeUndefined();
    expect(kept[1].metadata).toEqual({ ms: 900, stopped: true });
    const again = clearStopped(kept);
    expect(again[1].metadata?.stopped).toBeUndefined();
    expect(again[1].metadata?.ms).toBe(900);
    expect(turnEnd(clearStopped(markStopped([user()])), idle)).toBe("unfinished");
  });
  // Review 2026-09-26: a Stop during the claim checks kept a "running" check, and the reopened chat said "Checking each
  // claim…" for ever, under a note saying the answer was not finished when every word of it was there.
  it("drops a check still running and says only the checks were cut short", () => {
    const checking: ChatMessage = {
      ...answer("Mostly angry [msg1]."),
      parts: [
        { type: "text", text: "Mostly angry [msg1]." },
        { type: "data-verification", id: "verification", data: { status: "done", claims: [], summary: { total: 0, supported: 0 } } } as unknown as ChatMessage["parts"][number],
        { type: "data-corroboration", id: "corroboration", data: { status: "running" } },
      ],
    };
    const kept = markStopped([user(), checking]);
    expect(kept[1].parts.map((p) => p.type)).toEqual(["text", "data-verification"]);
    expect(turnEnd(kept, idle)).toBe("stopped-checks");
    const early = markStopped([user(), { ...answer(""), parts: [{ type: "data-verification", id: "verification", data: { status: "running" } }] }]);
    expect(early[1].parts).toEqual([]);
  });
  it("leaves an unmarked chat as it is", () => {
    const chat = [user()];
    expect(clearStopped(chat)).toBe(chat);
    expect(markStopped([])).toEqual([]);
  });
});

describe("pageTitle", () => {
  // A new chat's tab once showed only the app's name until a reload; it now reads as the server renders it.
  it("puts the chat's title through the layout's template", () => {
    expect(pageTitle("How do players feel about the anti-cheat?")).toBe("How do players feel about the anti-cheat? · Community Insights");
  });
});

// QA 2026-09-26: a dropped stream showed "network error" and a "Try again" that asked (and paid) again, though the
// server had finished and saved the answer, which a reload showed.
describe("afterDrop", () => {
  const saved = (messages: ChatMessage[], answering = false) => ({ messages, answering });
  it("shows the answer the server saved for the question on screen", () => {
    const chat = [user(), answer("Mostly angry.")];
    expect(afterDrop(saved(chat), [user()])).toEqual({ show: "saved", messages: chat });
    expect(afterDrop(saved(chat), [user(), answer("Most")])).toEqual({ show: "saved", messages: chat }); // replaces a partial one
  });
  it("waits for an answer the server is still writing", () => {
    expect(afterDrop(saved([user()], true), [user()])).toEqual({ show: "wait", messages: [user()] });
    expect(afterDrop(saved([user(), answer("")], true), [user()])).toMatchObject({ show: "wait" });
  });
  // Review 2026-09-26: the wait showed the saved question-only chat, so the answer the reader was reading vanished.
  it("keeps the words already on screen while it waits", () => {
    const onScreen = [user(), answer("Mostly angry about the")];
    expect(afterDrop(saved([user()], true), onScreen)).toEqual({ show: "wait", messages: onScreen });
  });
  it("waits on the saved chat when the screen has no words of the answer yet", () => {
    expect(afterDrop(saved([user()], true), [user(), answer("")])).toEqual({ show: "wait", messages: [user()] });
    expect(afterDrop(saved([user()], true), [user(), answer("   ")])).toEqual({ show: "wait", messages: [user()] });
  });
  it("offers to ask again only when nothing was saved for this question", () => {
    expect(afterDrop(null, [user()])).toEqual({ show: "retry" }); // no chat at all
    expect(afterDrop(saved([user()]), [user()])).toEqual({ show: "retry" }); // the server gave up on it
    expect(afterDrop(saved([user()]), [user(), answer("Most")])).toEqual({ show: "retry" }); // gave up, even mid-answer
    expect(afterDrop(saved([user(), answer("")]), [user()])).toEqual({ show: "retry" }); // an answer with no words
    // the saved chat ends on an earlier question: this one never reached the server
    expect(afterDrop(saved([user("u0"), answer("Earlier.")]), [user()])).toEqual({ show: "retry" });
    expect(afterDrop(saved([user(), answer("Mostly angry.")]), [])).toEqual({ show: "retry" }); // no question on screen
  });
});

// QA 2026-09-26: the step a number's glyph opens was brought into view with scrollIntoView, which scrolls the page too.
describe("centredTop", () => {
  const box = (top: number, height: number) => ({ getBoundingClientRect: () => ({ top, height }) });
  it("centres the element in the scroller it is scrolled in", () => {
    // scroller at y=100, 800 tall, already scrolled 300; the step is 1,000px below the scroller's top and 40 tall
    const scroller = { ...box(100, 800), scrollTop: 300, clientHeight: 800 };
    expect(centredTop(box(1100, 40), scroller)).toBe(300 + 1000 - 380);
  });
  it("never asks for a position above the top", () => {
    expect(centredTop(box(120, 40), { ...box(100, 800), scrollTop: 0, clientHeight: 800 })).toBe(0);
  });
});
