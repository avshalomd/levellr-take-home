import { describe, expect, it } from "vitest";
import type { ChatMessage } from "@/lib/agent/ui-types";
import { centredTop, clearStopped, markStopped, turnEnd } from "./chat-state";

const user = (id = "u1"): ChatMessage => ({ id, role: "user", parts: [{ type: "text", text: "How do players feel about the anti-cheat?" }] });
const answer = (text: string, metadata?: ChatMessage["metadata"]): ChatMessage => ({ id: "a1", role: "assistant", metadata, parts: text ? [{ type: "text", text }] : [] });
const idle = { busy: false, failed: false };

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

  it("says a stopped turn was stopped", () => {
    expect(turnEnd(markStopped([user(), answer("Mostly")]), idle)).toBe("stopped");
    expect(turnEnd(markStopped([user()]), idle)).toBe("stopped");
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
