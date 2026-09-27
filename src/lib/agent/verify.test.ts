import { beforeEach, describe, expect, it, vi } from "vitest";

// The claim check, with Jev and the message store stubbed. QA 2026-09-26: a ref carried over from an earlier turn, or
// one the agent never saw this turn, counted as backing its claim; and a per-day rate the model worked out itself (from
// the wrong number of days) passed unchecked.

const decideMock = vi.fn();
vi.mock("@/lib/llm/decide", async (orig) => ({
  ...(await orig<typeof import("@/lib/llm/decide")>()),
  decide: (a: unknown) => decideMock(a),
}));
// Messages 1-99 exist; a few carry the words of the production QA cases (2026-09-26).
const TEXTS: Record<number, string> = {
  21: "The terrain leaves something to be desired",
  22: "Rondo is on rotation too often, I got it 3 times in an hour",
  23: "Honestly the lighting is too dark at night",
};
vi.mock("@/lib/data/read", () => ({
  getMessagesByRef: async (refs: number[]) =>
    refs.filter((r) => r < 100).map((ref) => ({ ref, text: TEXTS[ref] ?? `text of message ${ref}` })),
}));

const { verify, SUPPORT_QUESTION, WHOLE_QUESTION } = await import("./verify");
const { toolFigures } = await import("./rates");

beforeEach(() => {
  // Jev says every message it is asked about supports its claim.
  decideMock
    .mockReset()
    .mockImplementation(async ({ questions }: { questions: Record<string, unknown> }) => ({
      answers: Object.fromEntries(Object.keys(questions).map((id) => [id, { noul: 0.9 }])),
    }));
});

describe("verify", () => {
  it("counts a claim as backed only by a citation this turn read", async () => {
    const v = await verify(
      "Lag is back since 43.1 [msg11]. Queues are long in Asia [msg12].",
      new Set(["msg11"]),
    );
    expect(v.cited).toBe(2);
    expect(v.supported).toBe(1);
    const carried = v.claims.find((c) => c.claim.startsWith("Queues"))!;
    expect(carried.citations).toEqual([{ id: "msg12", status: "not-retrieved", support: 0.9 }]);
    expect(carried.support).toBeNull();
  });

  // QA 2026-09-27: one failed Jev call read as "0 of 9 claims are backed" and sent all nine for a rewrite.
  it("marks a claim unchecked when Jev never answered, and counts it apart from the unbacked", async () => {
    decideMock
      .mockRejectedValueOnce(new Error("429"))
      .mockResolvedValueOnce({ answers: { msg12: { noul: 0.9 } } });
    const v = await verify("Lag is back [msg11]. Queues are long [msg12].", new Set(["msg11", "msg12"]));
    const [lag, queues] = v.claims;
    expect(lag).toMatchObject({ support: null, unchecked: true });
    expect(queues.unchecked).toBeUndefined();
    expect(v).toMatchObject({ cited: 2, supported: 1, unchecked: 1 });
  });

  it("fails, never leaves unchecked, a claim whose figure no source gives even when Jev did not answer", async () => {
    decideMock.mockRejectedValue(new Error("down"));
    const v = await verify("About 73% want it back [msg11].", new Set(["msg11"]), undefined, [12]);
    expect(v.claims[0]).toMatchObject({ support: 0 });
    expect(v.claims[0].unchecked).toBeUndefined();
    expect(v.unchecked).toBe(0);
  });

  it("never counts a made-up ref as backing", async () => {
    const v = await verify("Lag is back [msg400].", new Set(["msg400"]));
    expect(v.invalidIds).toEqual(["msg400"]);
    expect(v.supported).toBe(0);
  });

  it("takes the best of a claim's citations this turn read", async () => {
    decideMock.mockImplementation(async () => ({ answers: { msg11: { noul: 0.2 }, msg12: { noul: 0.95 } } }));
    const v = await verify("Lag is back [msg11, msg12].", new Set(["msg11"]));
    expect(v.claims[0].support).toBe(0.2); // msg12's 0.95 was not read this turn
    expect(v.supported).toBe(0);
  });

  it("flags a per-day rate the tools did not give, when it is told the ones they did", async () => {
    const known = [{ value: 11.3, words: "11.3 per day over 24 days" }];
    const v = await verify("September ran about 9 per day [msg11].", new Set(["msg11"]), known);
    expect(v.rates).toEqual([
      { claim: "September ran about 9 per day.", stated: "9", known: ["11.3 per day over 24 days"] },
    ]);
    expect((await verify("September ran 11.3 per day [msg11].", new Set(["msg11"]), known)).rates).toEqual(
      [],
    );
    expect((await verify("September ran 9 per day [msg11].", new Set(["msg11"]))).rates).toBeUndefined();
  });

  // Production QA 2026-09-26, E: the check passed sentences their messages contradict or do not contain.
  it("asks Jev whether a message SUPPORTS the claim, and that the opposite does not", async () => {
    await verify("Some players like Rondo's terrain [msg21].", new Set(["msg21"]));
    const q = decideMock.mock.calls[0][0].questions.msg21.instructions as string;
    expect(q).toBe(SUPPORT_QUESTION("msg21", "claim"));
    expect(q).toMatch(/SUPPORT/);
    expect(q).toMatch(/says the opposite.*does NOT support/);
  });

  it("counts a contradicting message as not backed", async () => {
    // Jev, asked the SUPPORT question, scores the contradicting message low.
    decideMock.mockImplementation(async () => ({ answers: { msg21: { noul: 0.1 } } }));
    const v = await verify("Some players like Rondo's terrain [msg21].", new Set(["msg21"]));
    expect(v.supported).toBe(0);
  });

  it("fails a figure no cited message contains and no tool worked out", async () => {
    const v = await verify(
      "Rotation and lighting draw complaints, at 25% each [msg22, msg23].",
      new Set(["msg22", "msg23"]),
      undefined,
      [212, 840, 11.3],
    );
    expect(v.claims[0].support).toBe(0);
    expect(v.claims[0].notes).toEqual([
      "It states 25%, which none of its cited messages and none of the counts gives.",
    ]);
    // Jev still scored the messages; the figure is what fails.
    expect(v.claims[0].citations.map((c) => c.support)).toEqual([0.9, 0.9]);
  });

  it("passes a figure a tool gave, one the message states, a date, a release and the count of its own chips", async () => {
    const figures = toolFigures([
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "c",
            toolName: "scan",
            output: {
              type: "text",
              value:
                "Scanned 840 conversations; 212 relevant.\nAverage mood of all 840 conversations read: 46/100.\nPeriod: 2026-09-01 to 2026-09-24, 24 days: 271 relevant, 11.3 per day over 24 days.",
            },
          },
        ],
      },
    ]);
    const retrieved = new Set(["msg22", "msg23"]);
    for (const text of [
      "212 of 840 conversations complain about the rotation [msg22].",
      "September ran about 11.3 per day [msg22].",
      "Mood sat at 46/100 [msg22].",
      "One player got Rondo 3 times in an hour [msg22].",
      "After 43.1 on 9 September, the lighting drew complaints [msg23].",
      "2 players dislike the map [msg22, msg23].",
    ]) {
      const v = await verify(text, retrieved, undefined, figures);
      expect(v.claims[0].notes, text).toBeUndefined();
      expect(v.claims[0].support, text).toBe(0.9);
    }
  });

  it("checks each side of 'X, another said Y' against its own citations, in one Jev call", async () => {
    decideMock.mockImplementation(async ({ questions }: { questions: Record<string, unknown> }) => ({
      answers: Object.fromEntries(
        Object.keys(questions).map((k) => [k, { noul: k === "c1_msg23" ? 0.2 : 0.9 }]),
      ),
    }));
    const v = await verify(
      "One player finds the rotation too long [msg22], another said the lighting is too dark [msg23].",
      new Set(["msg22", "msg23"]),
    );
    expect(decideMock).toHaveBeenCalledOnce();
    const call = decideMock.mock.calls[0][0];
    expect(Object.keys(call.questions)).toEqual(["c0_msg22", "c1_msg23"]);
    expect(call.state.clauses).toEqual({
      c0: "One player finds the rotation too long",
      c1: "another said the lighting is too dark.",
    });
    expect(call.questions.c1_msg23.instructions).toBe(SUPPORT_QUESTION("msg23", "clauses.c1"));
    expect(v.claims[0].support).toBe(0.2); // as backed as its weaker side
  });

  it("fails a side with no citation of its own", async () => {
    const v = await verify(
      "Some players like the new map, while others find it too dark [msg23].",
      new Set(["msg23"]),
    );
    expect(v.claims[0].support).toBe(0);
    expect(v.claims[0].notes).toEqual([
      'The part "Some players like the new map" has no citation of its own.',
    ]);
    const others = await verify(
      "Some players like it [msg22], others said the lighting is too dark [msg23].",
      new Set(["msg22", "msg23"]),
    );
    expect(others.claims[0].support).toBe(0.9);
  });

  it("leaves a sentence with one side as one claim: ', another patch' is not a side", async () => {
    await verify("Lag rose after 43.1, another patch fixed it [msg22].", new Set(["msg22"]));
    // One side, keyed by the ref; its comma also asks whether msg22 backs all of it (QA 2026-09-27, lists).
    expect(Object.keys(decideMock.mock.calls[0][0].questions)).toEqual(["msg22", "msg22_all"]);
  });
});

// QA 2026-09-27: a follow-up answered from the previous turn's reads, with no tool call, had every claim fail as
// "not retrieved". The route now passes every ref any turn's tools showed (agent.ts chatToolSteps); only a ref no tool
// ever showed stays unable to back a claim.
describe("verify, a follow-up", () => {
  it("backs a claim citing a message an earlier turn's tools showed, and not one no tool showed", async () => {
    const shownInChat = new Set(["msg11", "msg12"]); // msg11 from turn 1, msg12 from turn 2
    const v = await verify("The screen goes gray [msg11]. A boss takes no damage [msg12]. Queues are long [msg13].", shownInChat);
    expect(v.claims.map((c) => c.citations[0].status)).toEqual(["ok", "ok", "not-retrieved"]);
    expect(v).toMatchObject({ cited: 3, supported: 2 });
  });

  it("fails a claim that tags a figure with a counting tool that never ran in the chat, and lists the figure", async () => {
    const v = await verify(
      "60/100 players call it a bug [aggregate] [msg11]. Most mention the boss [msg12].",
      new Set(["msg11", "msg12"]),
      undefined,
      undefined,
      new Set(["scan"]),
    );
    expect(v.claims[0]).toMatchObject({ support: 0, notes: ["It tags 60/100 [aggregate], but no aggregate ran in this chat."] });
    expect(v.supported).toBe(1);
    expect(v.sourceless).toEqual([{ tool: "aggregate", figure: "60/100" }]);
    const ran = await verify("About 60 threads [aggregate] [msg11].", new Set(["msg11"]), undefined, undefined, new Set(["aggregate"]));
    expect(ran.sourceless).toBeUndefined();
    expect(ran.supported).toBe(1);
  });
});

// QA 2026-09-27: "excited about pre-orders, New Game Plus, and new pets [1]" passed on "pre order done", and "remakes
// of childhood shows and cheaters in PC crossplay [14]" on a message only about PC cheaters.
describe("verify, a sentence that lists several things", () => {
  // Jev: each message supports part of any claim (0.9), and backs a whole list only when `whole` says so.
  const jev = (whole: Record<string, number>) =>
    decideMock.mockImplementation(async ({ questions }: { questions: Record<string, unknown> }) => ({
      answers: Object.fromEntries(
        Object.keys(questions).map((k) => [k, { noul: k.endsWith("_all") ? (whole[k] ?? 0.1) : 0.9 }]),
      ),
    }));

  it("does not back a list on one message about one of its items, and says why for the rewrite", async () => {
    jev({});
    const v = await verify("Players are excited about pre-orders, New Game Plus, and new pets [msg1].", new Set(["msg1"]));
    expect(v.claims[0].support).toBeCloseTo(0.1);
    expect(v.supported).toBe(0);
    expect(v.claims[0].notes?.[0]).toMatch(/back only some of them/);
    expect(decideMock.mock.calls[0][0].questions.msg1_all.instructions).toBe(WHOLE_QUESTION("msg1", "claim"));
  });

  it("backs a list one message backs whole, or several messages back in parts", async () => {
    jev({ msg1_all: 0.8 });
    expect((await verify("They want pets and New Game Plus [msg1].", new Set(["msg1"]))).supported).toBe(1);
    jev({});
    const parts = await verify("They want pets, New Game Plus and co-op [msg1, msg2, msg3].", new Set(["msg1", "msg2", "msg3"]));
    expect(parts.supported).toBe(1);
  });

  it("asks nothing more of a sentence that lists nothing", async () => {
    await verify("The screen goes gray after a few deaths [msg11].", new Set(["msg11"]));
    expect(Object.keys(decideMock.mock.calls[0][0].questions)).toEqual(["msg11"]);
  });
});

// Production QA 2026-09-27 (P2, P6): "games are becoming very expensive [msg19][msg20]" passed on #off-topic talk about
// GTA 6's price in a frustrations answer. Asked about the community's own games, a citation about something else backs
// nothing, in the same one call per claim.
describe("verify, a question about the community's own games", () => {
  const OWN = "the Veil of Ages games and their developer";
  const answers = (off: Record<string, number>) =>
    decideMock.mockImplementation(async ({ questions }: { questions: Record<string, unknown> }) => ({
      answers: Object.fromEntries(
        Object.keys(questions).map((k) => [k, { noul: k.startsWith("off_") ? (off[k.slice(4)] ?? 0.1) : 0.9 }]),
      ),
    }));
  const check = (answer: string, read: string[]) =>
    verify(answer, new Set(read), undefined, undefined, undefined, OWN);

  it("fails a claim whose every citation is about something else, and says why for the rewrite", async () => {
    answers({ msg19: 0.95, msg20: 0.9 });
    const v = await check("Games are becoming very expensive [msg19, msg20].", ["msg19", "msg20"]);
    expect(decideMock).toHaveBeenCalledTimes(1);
    const call = decideMock.mock.calls[0][0];
    expect(call.state.games).toBe(OWN);
    expect(Object.keys(call.questions)).toEqual(["msg19", "msg20", "off_msg19", "off_msg20"]);
    expect(v.claims[0].support).toBe(0);
    expect(v.claims[0].notes?.join(" ")).toMatch(
      /\[msg19\], \[msg20\] are about another game or something else, not the Veil of Ages games/,
    );
    expect(v.supported).toBe(0);
  });

  it("keeps a claim that also cites a message about the community's own games, on that message", async () => {
    answers({ msg19: 0.95 });
    const v = await check("Prices worry people [msg19, msg17].", ["msg19", "msg17"]);
    expect(v.claims[0].support).toBe(0.9);
    expect(v.supported).toBe(1);
  });

  it("asks nothing about other games when the question is not one D20 keeps to the community's games", async () => {
    await verify("Prices worry people [msg19].", new Set(["msg19"]));
    expect(Object.keys(decideMock.mock.calls[0][0].questions)).toEqual(["msg19"]);
    expect(decideMock.mock.calls[0][0].state.games).toBeUndefined();
  });
});

// Production QA 2026-09-27 (P9): paraphrases passed with their meaning changed ("too easy" for "not a fair challenge",
// an invented gloss of "BF").
describe("SUPPORT_QUESTION", () => {
  it("says a claim that changes or adds to the message's meaning is not backed", () => {
    const q = SUPPORT_QUESTION("msg1", "claim");
    expect(q).toMatch(/with the same meaning/);
    expect(q).toMatch(/changes what the message means or adds to it/);
    expect(q).toMatch(/abbreviation or a name the message does not spell out/);
  });
});
