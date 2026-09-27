import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { REFUSED } from "@/lib/agent/flags";
import { Activity } from "./Activity";

// The activity block as the reader's browser gets it: the steps button has a name, and the chart waits for the steps
// to be over.
const scan = {
  type: "tool-scan",
  state: "output-available",
  toolCallId: "s1",
  input: { question: "Are people angry about bans?", filters: { flag: "complaint", since: "2026-09-09" } },
  output: {
    status: "ok",
    scanned: 118,
    relevant: 109,
    filters: { flag: "complaint", since: "2026-09-09" },
    relevantByWeek: [{ key: "2026-09-07", n: 25 }, { key: "2026-09-14", n: 46 }, { key: "2026-09-21", n: 38 }],
  },
};
const weekly = {
  type: "tool-aggregate",
  state: "output-available",
  toolCallId: "a1",
  input: { metric: "share_complaint", group_by: "week", filters: { since: "2026-09-09" } },
  output: {
    metric: "share_complaint",
    groupBy: "week",
    filters: { since: "2026-09-09" },
    rows: [{ key: "2026-09-07", value: 0.25, n: 40 }, { key: "2026-09-14", value: 0.46, n: 52 }, { key: "2026-09-21", value: 0.38, n: 47 }],
  },
};
const render = (settled?: boolean, steps: unknown[] = [scan, scan, weekly], told?: string) =>
  renderToStaticMarkup(
    <Activity
      steps={steps as never}
      progress={new Map()}
      topicNames={new Map()}
      open={false}
      onOpenChange={() => {}}
      id="steps"
      settled={settled}
      told={told}
    />,
  );

describe("Activity", () => {
  it("names the steps button for a screen reader, with the distinct count of conversations read", () => {
    // the same read twice is one step (stepLines), and the summary counts the steps shown: one read, not "the same 118
    // complaints twice" over one line (review 2026-09-26)
    expect(render()).toContain('aria-label="Show the 2 steps: Read 118 complaints and worked out the share of complaints by week"');
  });
  it("draws no chart until the steps are over, then the week rows by the days they hold", () => {
    expect(render(false)).not.toContain("<figure");
    const html = render(true);
    expect(html).toContain("<figure");
    expect(html).toContain("9–13 Sep");
  });
  it("draws a share against its whole scale, not against its largest value (QA 2026-09-26)", () => {
    expect(render(true)).toContain("width:46%");
  });
  // QA 2026-09-26: a call the tools refused read nothing; it is no step of its own. Review 2026-09-26: it arrives as a
  // result (lib/agent/tools.ts), never as an error.
  it("leaves out a call the tools refused, and shows nothing when that was the only one", () => {
    const refused = {
      type: "tool-scan",
      state: "output-available",
      toolCallId: "r1",
      input: { question: "Reaction?", filters: { flag: "complaint" } },
      output: { status: "refused", flag: "complaint", words: `${REFUSED} the question does not ask about complaints.` },
    };
    expect(render(true, [refused])).toBe("");
    expect(render(true, [refused, weekly])).toContain('aria-label="Show the step: Worked out the share of complaints by week"');
    expect(render(true, [refused, weekly])).not.toMatch(/did not finish/);
  });
  it("draws nothing for reads alone: their tally counts conversations on the question either way (QA 2026-09-26)", () => {
    expect(render(true, [scan])).not.toContain("<figure");
  });
  // QA 2026-09-26: a chart of a kind of conversation the answer never mentioned.
  it("draws a count narrowed to one kind of conversation only when the reader was told about that kind", () => {
    const bugs = { ...weekly, input: { ...weekly.input, filters: { flag: "bug" } }, output: { ...weekly.output, filters: { flag: "bug", since: "2026-09-09" } } };
    expect(render(true, [bugs], "How do players feel about bans?\nMost are angry.")).not.toContain("<figure");
    expect(render(true, [bugs], "How do players feel about bans?\nAmong the bug reports, most are angry.")).toContain("<figure");
  });
  // QA 2026-09-26: at 1440px 5 of 12 topic names were cut ("Performance & Ac…") in a 7.5rem column of a 28rem card,
  // and "and 1 more" was a sentence with nothing behind it.
  it("gives topic names room and puts the rows past the top dozen behind a button", () => {
    const byTopic = {
      type: "tool-aggregate",
      state: "output-available",
      toolCallId: "t1",
      input: { metric: "conversations", group_by: "topic", filters: {} },
      output: {
        metric: "conversations",
        groupBy: "topic",
        filters: {},
        rows: Array.from({ length: 13 }, (_, i) => ({ key: `topic-${i}`, value: 100 - i, n: 100 - i })),
      },
    };
    const html = render(true, [byTopic]);
    expect(html).toContain("sm:max-w-xl");
    expect(html).toContain("sm:grid-cols-[fit-content(11rem)_1fr_auto]");
    expect(html).not.toContain("7.5rem");
    expect(html).toMatch(/<button type="button" aria-expanded="false"[^>]*>and 1 more<\/button>/);
    expect(html.match(/grid-cols-subgrid/g)).toHaveLength(12);
  });
});

// QA 2026-09-26: a step that did not finish was drawn with the same icon as the ones that did.
describe("Activity, a step that did not finish", () => {
  const broken = { type: "tool-scan", state: "output-error", toolCallId: "s2", input: scan.input, errorText: "timeout" };
  const open = (steps: unknown[]) =>
    renderToStaticMarkup(
      <Activity steps={steps as never} progress={new Map()} topicNames={new Map()} open onOpenChange={() => {}} id="steps" />,
    );
  it("is flagged in the expanded list and the others are not", () => {
    const html = open([scan, broken]);
    expect(html.match(/data-failed="true"/g)).toHaveLength(1);
    expect(open([scan]).includes("data-failed")).toBe(false);
  });
});
