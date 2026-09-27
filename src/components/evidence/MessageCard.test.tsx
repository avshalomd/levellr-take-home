import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ThreadNode } from "@/lib/data/read";
import { MessageCard } from "./MessageCard";

// A message card as the panel draws it. QA 2026-09-26: cards said "2 wk ago" and "8 days ago" beside chips saying
// "17 Sep", so the reader had to do the sum to match them.
const node: ThreadNode = {
  id: "m1",
  ref: 12,
  kind: "comment",
  channel: "Discussion",
  thread_id: "t1",
  reply_to: null,
  conversation_id: "c1",
  in_window: true,
  author: "alwaysHK",
  ts: "2026-09-17T21:30:00Z",
  text: "Queues are long again.",
  score: 4,
  removed: false,
  is_bot: false,
  topic: null,
  topics: [],
};

describe("MessageCard", () => {
  it("dates a message the way its chip does, with the year on hover, never as time ago", () => {
    const html = renderToStaticMarkup(<MessageCard node={node} num={1} level="backed" replies={0} top={false} />);
    expect(html).toContain('title="17 Sep 2026">17 Sep</p>');
    expect(html).not.toMatch(/\bago\b/);
  });
});
