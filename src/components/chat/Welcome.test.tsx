import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Overview } from "@/lib/data/read";
import { Welcome } from "./Welcome";

// The home page as the browser first paints it: while the overview loads, and once it has.
const overview = {
  meta: { source: { community: "r/somegame" }, window: { from: "2026-06-18", to: "2026-09-24" }, counts: { messages: 10, conversations: 5, authors: 3 } },
  topics: [
    { key: "maps-modes", name: "Maps & Modes", n: 212, description: "Maps and modes, excluding esports news or requests for advice" },
    { key: "performance-access", name: "Performance & Access", n: 180, description: "Lag, crashes and log-in trouble" },
  ],
} as unknown as Overview;

describe("Welcome", () => {
  // QA 2026-09-26: two bars and four pills, then a page of a different shape; everything jumped when the data landed.
  it("loads in the page's own shape: title, sentence, six cards, topic chips", () => {
    const html = renderToStaticMarkup(<Welcome overview={null} onAsk={() => {}} />);
    expect(html.match(/data-skeleton-card/g)).toHaveLength(6);
    expect(html.match(/data-skeleton-chip/g)?.length).toBeGreaterThanOrEqual(8);
    expect(html).not.toMatch(/data-skeleton-row/);
    // the same heights the real blocks render at
    expect(html).toContain("h-[67px] animate-pulse rounded-2xl");
    expect(html).toContain("h-[35px]");
    expect(html).toContain("pt-4 pb-8 sm:pt-14");
  });
  // QA 2026-09-26: a chip's tooltip read "...excluding esports news or requests for advice".
  it("titles a topic chip with the question it asks, never the labeller's description", () => {
    const html = renderToStaticMarkup(<Welcome overview={overview} onAsk={() => {}} />);
    expect(html).toContain('title="What are people saying about maps &amp; modes?"');
    expect(html).not.toMatch(/excluding esports|Lag, crashes/);
  });
  // D48: Home is built from what every community has; a release list was one game subreddit's.
  it("lists no releases or updates", () => {
    const html = renderToStaticMarkup(<Welcome overview={overview} onAsk={() => {}} />);
    expect(html).not.toMatch(/Updates in this period|react to update/i);
  });
  // QA 2026-09-26: a chip read "Cheating & Bans 1,070" but was named "What are people saying about cheating & bans?",
  // so voice control ("click Cheating and Bans") could not find it (WCAG 2.5.3, label in name).
  it("names a topic chip starting with the words it shows", () => {
    const html = renderToStaticMarkup(<Welcome overview={overview} onAsk={() => {}} />);
    expect(html).toContain('aria-label="Maps &amp; Modes, 212 conversations touch it: ask what people are saying"');
    expect(html).toContain('title="What are people saying about maps &amp; modes?"');
  });
});
