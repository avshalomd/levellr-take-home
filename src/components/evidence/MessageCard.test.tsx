import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ThreadNode } from "@/lib/data/read";
import { Engagement, MessageCard } from "./MessageCard";

// A message card as the panel draws it. QA 2026-09-26: cards said "2 wk ago" and "8 days ago" beside chips saying
// "17 Sep", so the reader had to do the sum to match them.
const node: ThreadNode = {
  id: "m1",
  ref: 12,
  kind: "message",
  n_reactions: 4,
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

// QA 2026-09-27: a "0" reactions badge sat on most Discord messages.
describe("Engagement", () => {
  const discord = { platform: "discord", community: "Server" } as never;
  it("shows reactions only when there are some", () => {
    expect(renderToStaticMarkup(<Engagement node={{ score: 0 }} source={discord} />)).toBe("");
    expect(renderToStaticMarkup(<Engagement node={{ score: 2 }} source={discord} />)).toContain("reactions");
  });
});

describe("MessageCard as context", () => {
  it("labels a parent from an earlier session as context, and links nowhere", () => {
    const html = renderToStaticMarkup(<MessageCard node={node} num={0} level="backed" replies={0} top={false} context />);
    expect(html).toContain("Context · earlier session");
    expect(html).toContain("border-dashed");
    expect(html).not.toContain("<a ");
  });
  it("leaves a message of the open conversation unlabelled", () => {
    const html = renderToStaticMarkup(<MessageCard node={node} num={1} level="backed" replies={0} top={false} />);
    expect(html).not.toContain("earlier session");
  });
});
