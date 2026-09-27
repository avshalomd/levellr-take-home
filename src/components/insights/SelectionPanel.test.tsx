import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Described } from "@/lib/data/insights-question";
import { BottomSheet, SelectionBody, SideColumn, shareWords, sideEnter, type Detail, type Draft } from "./SelectionPanel";

// The selection's two containers as they are first drawn. QA 2026-09-26: Weeks -> Days with a square selected left the
// side column an empty card for a second or two, and the phone sheet floated 12px above the bottom edge.
describe("SideColumn", () => {
  it("brings new content in without fading it from nothing, with or without reduced motion", () => {
    for (const reduce of [false, true]) {
      const enter = sideEnter(reduce);
      expect(JSON.stringify(enter)).not.toMatch(/opacity/);
      expect(enter).not.toHaveProperty("exit"); // nothing waits for the old content to leave
    }
    expect(sideEnter(true).initial).toBe(false); // reduced motion: no movement at all
  });

  it("draws the help whole on its first frame, never faded in from nothing", () => {
    const html = renderToStaticMarkup(<SideColumn open={false}>{null}</SideColumn>);
    expect(html).toContain("Choose a topic and a time");
    expect(html).not.toMatch(/opacity:\s*0/);
  });

  it("says how to take a whole row or column in words for a click, a tap and the keyboard (QA 2026-09-26)", () => {
    const html = renderToStaticMarkup(<SideColumn open={false}>{null}</SideColumn>);
    expect(html).toContain("Select a topic or a date to take its whole row or column");
    expect(html).toContain("Use the arrow keys to move; go left or up from the first square to reach the topic names and dates.");
    expect(html).not.toContain("past the first square");
    expect(html).not.toMatch(/Click a (topic|square)/);
  });

  it("draws a selection whole on its first frame too", () => {
    const html = renderToStaticMarkup(
      <SideColumn open>
        <p>What was selected</p>
      </SideColumn>,
    );
    expect(html).toContain("What was selected");
    expect(html).not.toContain("Choose a topic and a time");
    expect(html).not.toMatch(/opacity:\s*0/);
  });
});

describe("BottomSheet", () => {
  const sheet = (open: boolean) =>
    renderToStaticMarkup(
      <BottomSheet open={open} insets={{ left: 12, right: 12 }} expanded={false} setExpanded={() => {}} onClose={() => {}} peek={<p>Peek</p>}>
        <p>Everything</p>
      </BottomSheet>,
    );

  it("sits flush on the screen's bottom edge, with its top corners rounded", () => {
    const html = sheet(true);
    expect(html).toMatch(/class="pointer-events-none fixed bottom-0 z-30"/);
    expect(html).toMatch(/rounded-t-\[22px\]/);
    expect(html).toContain("Peek");
  });

  it("leaves room under the grid while it is open, and none once it is closed", () => {
    expect(sheet(true)).toContain('<div aria-hidden="true" style="height:320px"></div>'); // before its height is measured
    expect(sheet(false)).not.toContain("height:");
  });

  it("dims nothing: the reader keeps picking squares with it open", () => {
    expect(sheet(true)).not.toMatch(/aria-modal|bg-black/);
  });
});

// D19: engagement is a score, never a count; a person's number is their reactions (the export's only approval signal).
describe("SelectionBody", () => {
  const described = { title: "Domains", when: "14–20 Sept" } as Described;
  const agg = { n: 4, engagement: 23, messages: 40, moodSum: 200, moodN: 4, people: 9 };
  const detail: Detail = {
    state: "ready",
    totals: agg,
    people: 9,
    sessions: [
      { sessionId: "msg_1", ref: 12, channel: "game-chat", opening: "Domains tier 5 is brutal", started: "2026-09-15", engagement: 12, conversations: 1, messages: 8, moodAvg: 0.4 },
    ],
    voices: [{ author: "someone", messages: 5, conversations: 2, reactions: 6, started: 1, first_ts: "", last_ts: "" }],
  };
  const draft: Draft = { question: "What about Domains?", setQuestion: () => {}, suggestions: [], ask: () => {} };
  const html = renderToStaticMarkup(
    <SelectionBody described={described} combined={agg} population={agg} inPeriods={4} detail={detail} draft={draft} onClear={() => {}} onRetry={() => {}} />,
  );

  it("writes engagement as a score and a person's number as reactions", () => {
    expect(html).toContain("engagement score</div>"); // the totals' label
    expect(html).toContain("engagement score 12"); // a session
    expect(html).toContain("6 reactions"); // a person
    expect(html).not.toMatch(/vote|thread/i);
  });

  it("names a session by its channel and first message", () => {
    expect(html).toContain("#game-chat</span> Domains tier 5 is brutal");
    expect(html).toContain("Domains tier 5 is brutal");
  });
});

// D46: the selection's conversations are distinct, and until the server has counted them across topic rows the panel
// says it is counting rather than showing a sum that counts a two-topic conversation twice.
describe("the selection's counts, multi-label", () => {
  const described = { title: "Bugs and Maps", when: "7–13 Sept" } as Described;
  const population = { n: 100, engagement: 0, messages: 0, moodSum: 50, moodN: 100, people: 0 };
  const draft: Draft = { question: "q", setQuestion: () => {}, suggestions: [], ask: () => {} };

  it("shows placeholders, not a double-counted sum, while the distinct count is on its way", () => {
    const html = renderToStaticMarkup(
      <SelectionBody described={described} combined={null} population={population} inPeriods={40} detail={{ state: "loading" }} draft={draft} onClear={() => {}} onRetry={() => {}} />,
    );
    expect(html).toContain("Counting the conversations…");
    expect(html).not.toMatch(/% of the 40 conversations/);
  });

  it("gives the share as conversations in that time touching the selection", () => {
    const sel = { n: 10, engagement: 0, messages: 30, moodSum: 5, moodN: 10, people: 0 };
    expect(shareWords(sel, 40)).toBe("25% of the 40 conversations in that time touch this, 30 messages in all.");
    expect(shareWords({ ...sel, n: 40 }, 40)).toBe("Every conversation in that time, 30 messages in all.");
  });
});
