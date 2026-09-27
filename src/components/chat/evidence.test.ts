import { describe, expect, it } from "vitest";
import type { ChatMessage } from "@/lib/agent/ui-types";
import { answerText, beforeDroppedCitation, proseMarks, corroborationFor, dropCitations, evidenceOf, hidePartialCitation, numberTagsOnly, onePerConversation, splitToolTags, stripToolMarkup, supportLevel, type Evidence } from "./evidence";

describe("stripToolMarkup", () => {
  it("removes a function-call block the model wrote as its answer (F02 in production)", () => {
    const leaked =
      '\n\n<dots_function_call> <invoke name="find"> <parameter name="query"> EU server closed </parameter> ' +
      "</invoke> </dots_function_call>";
    expect(stripToolMarkup(leaked).trim()).toBe("");
  });

  it("keeps the prose around a block, and cuts an unclosed block to the end", () => {
    expect(stripToolMarkup("No EU shutdown is in the data [t3_abc].\n<function_calls><invoke").trim()).toBe(
      "No EU shutdown is in the data [t3_abc].",
    );
  });

  it("leaves an ordinary answer alone, citations and tool tags included", () => {
    const s = "Complaints ran at 69% [aggregate] in the launch week [t1_x, t1_y].";
    expect(stripToolMarkup(s)).toBe(s);
  });
});

describe("dropCitations", () => {
  it("removes a citation to a message that does not exist, with the space before it", () => {
    expect(dropCitations("Bots fill the lobbies [msg99].", new Set(["msg99"]))).toBe("Bots fill the lobbies.");
  });

  it("keeps the real citations of a mixed group", () => {
    expect(dropCitations("Bots [msg1, msg99, msg2].", new Set(["msg99"]))).toBe("Bots [msg1, msg2].");
  });

  it("leaves the text alone when nothing is dropped", () => {
    expect(dropCitations("Bots [msg1].", new Set())).toBe("Bots [msg1].");
  });
});

describe("hidePartialCitation", () => {
  it("holds back a citation that is still streaming", () => {
    expect(hidePartialCitation("People blame the patch [msg1")).toBe("People blame the patch");
    expect(hidePartialCitation("People blame the patch [msg1, ms")).toBe("People blame the patch");
  });

  it("leaves a finished citation and ordinary text alone", () => {
    expect(hidePartialCitation("People blame the patch [msg1].")).toBe("People blame the patch [msg1].");
    expect(hidePartialCitation("Version 43.1")).toBe("Version 43.1");
  });
});

describe("supportLevel", () => {
  it("reads the verifier's score as backed, weak or not checked yet - never an alarm", () => {
    expect(supportLevel(undefined)).toBe("pending");
    expect(supportLevel({ support: null, status: "ok" })).toBe("pending");
    expect(supportLevel({ support: 0.9, status: "ok" })).toBe("backed");
    expect(supportLevel({ support: 0.5, status: "not-retrieved" })).toBe("backed");
    expect(supportLevel({ support: 0.2, status: "ok" })).toBe("weak");
  });
});

describe("evidenceOf", () => {
  const part = (text: string) => ({ type: "text", text }) as const;
  const verification = (ids: { id: string; status: "ok" | "unknown-id"; support: number | null }[]) => ({
    type: "data-verification",
    data: { status: "done", claims: [{ claim: "x", citations: ids, support: 1 }], supported: 1, cited: 1, invalidIds: [], uncitedSentences: 0 },
  });

  it("hides a citation the check found points at nothing, and numbers only the rest", () => {
    const message = {
      id: "a",
      role: "assistant",
      parts: [part("Bots fill the lobbies [msg4, msg99]. Queues are long [msg7]."), verification([{ id: "msg4", status: "ok", support: 0.9 }, { id: "msg99", status: "unknown-id", support: null }])],
    } as unknown as ChatMessage;
    const e = evidenceOf(message);
    expect(e.text).toBe("Bots fill the lobbies [msg4]. Queues are long [msg7].");
    expect(e.cited).toEqual(["msg4", "msg7"]);
  });

  it("shows the corrected answer when the revision was kept", () => {
    const message = {
      id: "a",
      role: "assistant",
      parts: [part("Everyone hates it [msg1]."), { type: "data-revision", data: { status: "done", kept: true, text: "Some players dislike it [msg1].", before: { supported: 0, cited: 1 } } }],
    } as unknown as ChatMessage;
    expect(evidenceOf(message).text).toBe("Some players dislike it [msg1].");
  });

  // Review 2026-09-26: a rewrite running after a kept cite pass replaced the kept revision (same id), and the uncited
  // stream came back for the length of the rewrite. The running part carries the cited text (lib/agent/finish.ts).
  it("keeps the cited text on screen while a later rewrite runs", () => {
    const message = {
      id: "a",
      role: "assistant",
      parts: [part("Lag is back."), { type: "data-revision", data: { status: "running", weak: 1, text: "Lag is back [msg1]." } }],
    } as unknown as ChatMessage;
    expect(evidenceOf(message).text).toBe("Lag is back [msg1].");
    expect(evidenceOf(message).cited).toEqual(["msg1"]);
    const plain = { ...message, parts: [part("Lag is back [msg1]."), { type: "data-revision", data: { status: "running", weak: 1 } }] } as unknown as ChatMessage;
    expect(evidenceOf(plain).text).toBe("Lag is back [msg1].");
  });

  // Review 2026-09-26: the steps' text had been joined with nothing ("…back.That…"), and the post-agent pipeline read
  // only the last step's. Both now use answerText: each step's text, steps on a blank line.
  it("joins each step's text on a blank line, as the post-agent pipeline reads it", () => {
    const message = {
      id: "a",
      role: "assistant",
      parts: [{ type: "step-start" }, part("Lag is back [msg1]."), { type: "step-start" }, part("That is the "), part("picture.")],
    } as unknown as ChatMessage;
    expect(evidenceOf(message).text).toBe("Lag is back [msg1].\n\nThat is the picture.");
    expect(answerText(["A.", " ", "B."])).toBe("A.\n\nB.");
  });

  it("leaves out a weak citation beside a backed one, and makes the claim's other backers openable", () => {
    const more = { id: "t1_x", ref: 55, kind: "comment", channel: "Discussion", thread_id: "t3_y", reply_to: null, conversation_id: "c9", in_window: true, author: "alwaysHK", ts: "2026-09-01T10:00:00Z", text: "same here", score: 4, removed: false, is_bot: false, threadTitle: "Stutter", support: 0.8 };
    const message = {
      id: "a",
      role: "assistant",
      parts: [
        part("- Stutter after the patch [msg1, msg2]."),
        { type: "data-verification", data: { status: "done", claims: [{ claim: "Stutter after the patch.", citations: [{ id: "msg1", status: "ok", support: 0.9 }, { id: "msg2", status: "ok", support: 0.1 }], support: 0.9 }], supported: 1, cited: 1, invalidIds: [], uncitedSentences: 0 } },
        { type: "data-corroboration", data: { status: "done", pool: 10, found: 10, failed: 0, claims: [{ claim: "Stutter after the patch.", tags: ["msg1"], conversations: 7, more: [more], moreTotal: 6 }] } },
      ],
    } as unknown as ChatMessage;
    const e = evidenceOf(message);
    expect(e.text).toBe("- Stutter after the patch [msg1].");
    expect(e.cited).toEqual(["msg1"]);
    expect(e.refs.get("msg55")).toMatchObject({ author: "alwaysHK", threadTitle: "Stutter" });
    expect(corroborationFor(e, ["msg1"])?.moreTotal).toBe(6);
    expect(corroborationFor(e, ["msg8"])).toBeUndefined();
  });
  it("gives a sentence the claim citing exactly its chips before one that only shares a chip", () => {
    const c = (tags: string[], moreTotal: number) => ({ claim: "", tags, conversations: moreTotal + tags.length, more: [], moreTotal });
    const e = { corroboration: { status: "done", pool: 9, found: 9, failed: 0, claims: [c(["msg1", "msg2"], 5), c(["msg2"], 3)] } } as unknown as Evidence;
    expect(corroborationFor(e, ["msg2"])?.moreTotal).toBe(3);
    expect(corroborationFor(e, ["msg2", "msg1"])?.moreTotal).toBe(5);
  });
  // Review 2026-09-26: two sentences citing exactly [msg1] both showed the first one's "+N more".
  it("tells two sentences citing the same message apart by their words", () => {
    const c = (claim: string, moreTotal: number) => ({ claim, tags: ["msg1"], conversations: moreTotal + 1, more: [], moreTotal });
    const e = { corroboration: { status: "done", pool: 9, found: 9, failed: 0, claims: [c("Lag is up.", 5), c("**Queues** are long.", 3)] } } as unknown as Evidence;
    expect(corroborationFor(e, ["msg1"], "Lag is up [msg1].")?.moreTotal).toBe(5);
    // the reader's sentence has no markdown and its own spacing; the claim is matched all the same
    expect(corroborationFor(e, ["msg1"], " Queues  are long [msg1]. ")?.moreTotal).toBe(3);
    // words matching no claim fall back to the chips
    expect(corroborationFor(e, ["msg1"], "Something else [msg1].")?.moreTotal).toBe(5);
  });
});

// QA 2026-09-26, production: "Show where this number comes from" sat on "Most complaints were about lag [scan]." with no
// number in it. A tool tag stays only in a sentence that states one.
describe("numberTagsOnly", () => {
  it("keeps a tag on a sentence with a number, and drops it with its space elsewhere", () => {
    expect(numberTagsOnly("212 of 840 were complaints [scan]. Most were about lag [scan] [msg12].")).toBe("212 of 840 were complaints [scan]. Most were about lag [msg12].");
    expect(numberTagsOnly("- Lag leads [aggregate]\n- Three topics grew [aggregate], since 9 September [scan].")).toBe("- Lag leads\n- Three topics grew [aggregate], since 9 September [scan].");
  });
  it("never counts a citation's digits as a number in the sentence", () => {
    expect(numberTagsOnly("People blame the servers [msg4471] [scan].")).toBe("People blame the servers [msg4471].");
  });
  // Review 2026-09-26: count words were missed, and dates, release numbers and "no one" were taken for counts.
  it("keeps a tag on a count written in words, and drops it from a date, a release or 'no one'", () => {
    expect(numberTagsOnly("Hundreds of players complained [scan].")).toBe("Hundreds of players complained [scan].");
    expect(numberTagsOnly("A third of threads were about lag [scan].")).toBe("A third of threads were about lag [scan].");
    expect(numberTagsOnly("Forty percent were about lag [scan].")).toBe("Forty percent were about lag [scan].");
    expect(numberTagsOnly("Dozens of players asked for it [scan].")).toBe("Dozens of players asked for it [scan].");
    expect(numberTagsOnly("No one liked the patch [scan].")).toBe("No one liked the patch.");
    expect(numberTagsOnly("Lag rose after the 9 September patch [scan].")).toBe("Lag rose after the 9 September patch.");
    expect(numberTagsOnly("Lag rose after 42.3 [scan].")).toBe("Lag rose after 42.3.");
    expect(numberTagsOnly("The 42.3 update angered players [scan].")).toBe("The 42.3 update angered players.");
    expect(numberTagsOnly("Lag rose on 2026-09-09 [scan].")).toBe("Lag rose on 2026-09-09.");
    expect(numberTagsOnly("The third patch was worse [scan].")).toBe("The third patch was worse.");
  });
  // Production QA 2026-09-26: the Weapons & Combat figures, 11.8 to 6.2 a day, had no "where this number comes from"
  // tag: it was written on the sentence after them, which states no number, and dropped there.
  it("moves a tag written one sentence late back onto the sentence with the number", () => {
    expect(numberTagsOnly("Weapons & Combat fell by about half, 11.8 to 6.2 a day. It is quieter now [aggregate].")).toBe(
      "Weapons & Combat fell by about half, 11.8 to 6.2 a day [aggregate]. It is quieter now.",
    );
    expect(numberTagsOnly("It fell from 11.8 to 6.2 a day [aggregate]. Players noticed [scan] [msg3].")).toBe(
      "It fell from 11.8 to 6.2 a day [aggregate]. Players noticed [msg3].",
    );
    expect(numberTagsOnly("Lag is back. Players noticed [scan].")).toBe("Lag is back. Players noticed.");
  });
  it("still counts a decimal rate and a count beside a date", () => {
    expect(numberTagsOnly("September ran 11.3 per day [scan].")).toBe("September ran 11.3 per day [scan].");
    expect(numberTagsOnly("After 42.3, 212 threads were about lag [scan].")).toBe("After 42.3, 212 threads were about lag [scan].");
  });
  it("leaves text with no tags alone", () => {
    expect(numberTagsOnly("Lag is back [msg1].\n\n- Is it the servers?")).toBe("Lag is back [msg1].\n\n- Is it the servers?");
  });
  it("is applied to the answer the reader is shown", () => {
    const message = { id: "a", role: "assistant", parts: [{ type: "text", text: "Lag leads [scan]. It rose 40% [aggregate]." }] } as unknown as ChatMessage;
    expect(evidenceOf(message).text).toBe("Lag leads. It rose 40% [aggregate].");
  });
});

describe("splitToolTags", () => {
  it("drops the space before a tag, so no gap opens between the glyph and the full stop", () => {
    expect(splitToolTags("92 of 129 were relevant [aggregate]. The rest")).toEqual([
      { text: "92 of 129 were relevant" },
      { tag: "aggregate", hug: true },
      { text: ". The rest" },
    ]);
  });

  it("keeps the space after a tag that is followed by a word, and plain text untouched", () => {
    expect(splitToolTags("12 posts [scan] and more")).toEqual([{ text: "12 posts" }, { tag: "scan" }, { text: " and more" }]);
    expect(splitToolTags("no tags here ")).toEqual([{ text: "no tags here " }]);
  });

  it("marks a tag that punctuation follows, so the glyph gives up its right margin (QA 2026-09-25)", () => {
    // After bold text the tag starts its own string: "**35 of 571 are about DLSS** [scan], and the overall…"
    expect(splitToolTags(" [scan], and the rest")).toEqual([{ tag: "scan", hug: true }, { text: ", and the rest" }]);
    expect(splitToolTags("25/100 [scan]) so")).toEqual([{ text: "25/100" }, { tag: "scan", hug: true }, { text: ") so" }]);
    expect(splitToolTags("at the end [scan]")).toEqual([{ text: "at the end" }, { tag: "scan" }]);
  });

  it("reads a [voices] tag as a link to the step, never as literal text", () => {
    expect(splitToolTags("most active are A and B [voices].")).toEqual([{ text: "most active are A and B" }, { tag: "voices", hug: true }, { text: "." }]);
  });
});

describe("beforeDroppedCitation", () => {
  it("drops the space a hidden citation leaves before punctuation or the end", () => {
    expect(beforeDroppedCitation("since the release [scan] ", ".")).toBe("since the release [scan]");
    expect(beforeDroppedCitation("since the release ", "")).toBe("since the release");
  });
  it("keeps it when a word follows directly, so two words never run together", () => {
    expect(beforeDroppedCitation("said so ", "and more")).toBe("said so ");
  });
});

// QA 2026-09-26, round 5: a claim showed 3 chips and "+3 more" under a panel saying "5 conversations say this. 2 are
// cited in the answer": two chips came from one conversation. One chip per conversation per sentence, so chips, "+N
// more" and the panel all count conversations.
describe("onePerConversation", () => {
  const conv = new Map([["msg1", "c1"], ["msg2", "c1"], ["msg3", "c2"], ["msg4", "c1"]]);
  const of = (t: string) => conv.get(t);

  it("keeps one message per conversation in a sentence, the first when none is checked", () => {
    expect(onePerConversation("Bans are slow [msg1, msg2, msg3].", of)).toBe("Bans are slow [msg1, msg3].");
    expect(onePerConversation("Bans are slow [msg1] and random [msg2].", of)).toBe("Bans are slow [msg1] and random.");
  });
  it("keeps the best-backed message of a conversation", () => {
    const support = new Map([["msg1", { support: 0.6 }], ["msg2", { support: 0.9 }]]);
    expect(onePerConversation("Bans are slow [msg1, msg2, msg3].", of, support)).toBe("Bans are slow [msg2, msg3].");
  });
  it("lets another sentence cite the same conversation, and keeps a message whose conversation is not known", () => {
    expect(onePerConversation("Bans are slow [msg1]. Appeals fail [msg4].\n- Queues [msg2, msg9].", of)).toBe("Bans are slow [msg1]. Appeals fail [msg4].\n- Queues [msg2, msg9].");
  });
  it("is applied to the answer the reader sees, so the chips count conversations", () => {
    const ref = (ref: number, conversation_id: string) => ({ id: `t1_${ref}`, ref, kind: "comment", channel: "Discussion", thread_id: "t3_y", reply_to: null, conversation_id, in_window: true, author: "a", ts: "2026-09-01T10:00:00Z", text: "x", score: 1, removed: false, is_bot: false });
    const message = {
      id: "a",
      role: "assistant",
      parts: [
        { type: "tool-find", state: "output-available", toolCallId: "f", input: { query: "bans" }, output: { hits: [{ id: "c1", thread_title: "Bans", relevance: 0.9, messages: [ref(1, "c1"), ref(2, "c1")] }, { id: "c2", thread_title: "Appeals", relevance: 0.8, messages: [ref(3, "c2")] }] } },
        { type: "text", text: "Bans are slow [msg1, msg2, msg3]." },
      ],
    } as unknown as ChatMessage;
    const e = evidenceOf(message);
    expect(e.text).toBe("Bans are slow [msg1, msg3].");
    expect(e.cited).toEqual(["msg1", "msg3"]);
  });
});

// Production QA 2026-09-26: "-48%" written with a hyphen, and ISO dates in the answer's prose.
describe("proseMarks", () => {
  it("writes a fall with a minus sign", () => {
    expect(proseMarks("Weapons & Combat fell -48% [aggregate].")).toBe("Weapons & Combat fell \u221248% [aggregate].");
    expect(proseMarks("(-6%) and \u20133.5 %")).toBe("(\u22126%) and \u22123.5 %");
  });
  it("leaves a range, a bullet and a code span alone", () => {
    expect(proseMarks("20-30% of threads")).toBe("20-30% of threads");
    expect(proseMarks("- 48% of threads")).toBe("- 48% of threads");
    expect(proseMarks("run `x -5%` now")).toBe("run `x -5%` now");
  });
  it("writes an ISO date as words, keeping the year", () => {
    expect(proseMarks("Since 2026-09-09, lag rose [msg1].")).toBe("Since 9 September 2026, lag rose [msg1].");
    expect(proseMarks("From 2026-08-01 to 2026-08-31.")).toBe("From 1 August 2026 to 31 August 2026.");
  });
  it("leaves a date in a link, a path, a code span or a non-date alone", () => {
    for (const s of ["[notes](https://x.com/2026-09-09)", "see /logs/2026-09-09-a", "`2026-09-09`", "2026-13-40", "ref=2026-09-09"])
      expect(proseMarks(s), s).toBe(s);
  });
  it("is idempotent", () => {
    const once = proseMarks("On 2026-09-09 it fell -48%.");
    expect(proseMarks(once)).toBe(once);
  });
});
