import { Explore } from "@/components/insights/Explore";
import { getGrid } from "@/lib/data/insights";
import type { GridData } from "@/lib/data/insights-model";
import { topicNames } from "@/lib/data/insights-names";

export const dynamic = "force-dynamic"; // the grid itself is cached per data version (src/lib/data/insights.ts)
export const metadata = { title: "Explore" };

// Topics over time, as a grid you can select from. The page renders the week view on the server; the day and month
// views, the selection's detail and the topic editing all load in the browser.
//
// The topic names come with the page too. The grid used to wait for the browser's own taxonomy request and meanwhile
// guessed names from the keys, so every load showed "Highlights creations" for a second before "Highlights &
// Creations" (QA 2026-09-25). They are a names-only read that never writes (insights-names.ts); without them the page
// still renders, with the guessed names until the request lands.
export default async function ExplorePage() {
  const [initial, names] = await Promise.all([getGrid("week").catch((): GridData | null => null), topicNames()]);
  if (!initial || initial.topics.length === 0) {
    return (
      <div className="mx-auto w-full max-w-3xl px-6 py-10">
        <h1 className="text-[28px] leading-tight font-semibold tracking-[-0.02em] text-foreground">Explore</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">
          {initial
            ? "There are no labelled conversations yet. Once the conversations carry topics, they appear here."
            : "The data could not be read just now. Reload the page to try again."}
        </p>
      </div>
    );
  }
  return <Explore initial={initial} initialNames={names} />;
}
