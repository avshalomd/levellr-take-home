import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Overview } from "@/lib/data/read";
import { BRIEF_QUESTIONS, Welcome } from "./Welcome";

// The home page as the browser first paints it: while the overview loads, and once it has.
const overview = {
  meta: { source: { community: "Veil of Ages" }, window: { from: "2026-09-13", to: "2026-09-27" }, counts: { messages: 10, conversations: 5, authors: 3 } },
  topics: [
    { key: "combat", name: "Combat & Parkour", n: 212, description: "Combat feel, parkour and stealth, excluding bug reports" },
    { key: "performance", name: "Performance & Bugs", n: 180, description: "Crashes, frame drops and broken quests" },
  ],
} as unknown as Overview;

describe("Welcome", () => {
  it("offers the brief's three questions before the overview has loaded", () => {
    const html = renderToStaticMarkup(<Welcome overview={null} onAsk={() => {}} />);
    for (const q of BRIEF_QUESTIONS) expect(html).toContain(q);
    expect(html).toContain("data-skeleton");
    expect(html.match(/data-skeleton-chip/g)?.length).toBeGreaterThanOrEqual(8);
  });

  it("says what the data is once the overview lands", () => {
    const html = renderToStaticMarkup(<Welcome overview={overview} onAsk={() => {}} />);
    expect(html).toContain("What is Veil of Ages talking about?");
    expect(html).toContain("10 messages in 5 conversations from 3 people");
    expect(html).not.toContain("data-skeleton");
  });

  it("titles a topic chip with the question it asks, never the labeller's description", () => {
    const html = renderToStaticMarkup(<Welcome overview={overview} onAsk={() => {}} />);
    expect(html).toContain('title="What are people saying about combat &amp; parkour?"');
    expect(html).not.toMatch(/excluding bug reports|broken quests/);
  });

  it("names a topic chip starting with the words it shows", () => {
    const html = renderToStaticMarkup(<Welcome overview={overview} onAsk={() => {}} />);
    expect(html).toContain('aria-label="Combat &amp; Parkour, 212 conversations touch it: ask what people are saying"');
  });
});
