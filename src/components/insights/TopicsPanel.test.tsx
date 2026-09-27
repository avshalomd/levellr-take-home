import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ViewLabel } from "@/lib/data/insights-labels";
import { LabelRow, MoodTargetNote } from "./TopicsPanel";

// One row of the topics editor, as a screen reader and a pointer meet it. QA 2026-09-26: the name was a button whose
// only hint was a "Rename" tooltip, the description a button with no hint at all, and the dark theme's checkbox the
// browser's grey square.
const row = (label: ViewLabel, pick = true) =>
  renderToStaticMarkup(
    <LabelRow
      label={label}
      total={100}
      picked={false}
      onPick={pick ? () => {} : undefined}
      onRename={() => {}}
      onReword={() => {}}
      onRemove={() => {}}
      onUndo={() => {}}
    />,
  );

const topic: ViewLabel = { key: "perf", name: "Performance & Access", description: "Crashes and lag.", n: 11, status: "kept" };

describe("LabelRow", () => {
  it("names its controls by what they do", () => {
    const html = row(topic);
    expect(html).toContain('aria-label="Rename Performance &amp; Access"');
    expect(html).toContain('aria-label="Edit the description of Performance &amp; Access"');
    expect(html).not.toContain('title="Rename"');
  });

  it("keeps the description readable to a screen reader under that name", () => {
    const html = row(topic);
    const id = html.match(/aria-describedby="([^"]+)"/)?.[1];
    expect(id).toBeTruthy();
    // The description's words, whole, under that id (the pencil inside it is aria-hidden and has no text).
    const described = html.match(new RegExp(`id="${id}">(.*?)</span></button>`))?.[1] ?? "";
    expect(described.replace(/<svg.*?<\/svg>/g, "").replace(/<[^>]+>/g, "")).toBe("Crashes and lag.");
  });

  it("keeps the description's pencil on the line of its last word, never on a line of its own (QA 2026-09-26)", () => {
    const html = row(topic);
    expect(html).toMatch(/Crashes and <span class="whitespace-nowrap">lag\.<svg[^>]*lucide-pencil/);
    expect(row({ ...topic, description: "Lag" })).toMatch(/<span class="whitespace-nowrap">Lag<svg/);
  });

  it("shows a pencil beside the name and the description on hover or focus, always on a touch screen", () => {
    const pencils = row(topic).match(/<svg[^>]*lucide-pencil[^>]*>/g) ?? [];
    expect(pencils).toHaveLength(2);
    for (const p of pencils) {
      expect(p).toContain('aria-hidden="true"');
      expect(p).toMatch(/opacity-0 .*group-hover:opacity-100 group-focus-visible:opacity-100 \[@media\(hover:none\)\]:opacity-100/);
    }
  });

  it("a topic with no description invites one, by name", () => {
    expect(row({ ...topic, description: "" })).toContain('aria-label="Add a description to Performance &amp; Access"');
  });

  it("the catch-all's name cannot be renamed, so it has no rename name and no pencil beside it", () => {
    const html = row({ key: "other", name: "Other", description: "None of the other labels fits.", n: 3, status: "kept" }, false);
    expect(html).not.toContain("Rename Other");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Other<\/button>/);
  });

  it("draws its checkbox in the page's colours, not the browser's", () => {
    const box = row(topic).match(/<input[^>]*type="checkbox"[^>]*>/)?.[0] ?? "";
    expect(box).toContain('aria-label="Choose Performance &amp; Access to combine"');
    expect(box).toMatch(/appearance-none/);
    expect(box).toMatch(/checked:bg-pulse/);
  });
});

// D46: a topic's count is the conversations touching it, and the mood target is shown read-only with its reason.
describe("the topics editor, multi-label", () => {
  it("counts a topic as the conversations touching it, and names the share in full", () => {
    const html = row(topic);
    expect(html).toContain("11 conversations touch it, 11%");
    expect(html).toContain('title="11% of all 100 conversations touch Performance &amp; Access"');
  });

  it("shows what the mood is measured towards, and why, with nothing to edit", () => {
    const html = renderToStaticMarkup(
      <MoodTargetNote target={{ target: "the game and its developer", why: "Most threads are about playing it.", alternatives: ["the esports scene"] }} />,
    );
    expect(html).toContain("Mood is measured towards</span> the game and its developer");
    expect(html).toContain("Most threads are about playing it.");
    expect(html).not.toMatch(/<(button|input|textarea)/);
  });
});
