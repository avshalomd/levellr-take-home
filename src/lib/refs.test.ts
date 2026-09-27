import { describe, expect, it } from "vitest";
import { CITE_RE, citedTags, normalizeCitations } from "./refs";

describe("normalizeCitations", () => {
  it("keeps a well-formed citation exactly as written", () => {
    const s = "Players found the pass boring [msg12] and grindy [msg40, msg41].";
    expect(normalizeCitations(s)).toBe(s);
  });

  it("repairs the shapes a model writes when it half-follows the format", () => {
    expect(normalizeCitations("boring (msg12).")).toBe("boring [msg12].");
    expect(normalizeCitations("boring [msg12,msg40].")).toBe("boring [msg12, msg40].");
    expect(normalizeCitations("boring [MSG12; msg40].")).toBe("boring [msg12, msg40].");
    expect(normalizeCitations("boring msg12, msg40.")).toBe("boring [msg12, msg40].");
    expect(normalizeCitations("boring msg12 and grindy msg40")).toBe("boring [msg12] and grindy [msg40]");
  });

  it("removes raw Reddit ids and conversation handles the reader should never see", () => {
    expect(normalizeCitations("The thread [t3_1wajhn1] says so.")).toBe("The thread says so.");
    expect(normalizeCitations("One reply (t1_p8rxa77) disagrees.")).toBe("One reply disagrees.");
    expect(normalizeCitations("In conv123 players agree [msg9].")).toBe("In players agree [msg9].");
    expect(normalizeCitations("Mixed [msg9, t1_abcdef].")).toBe("Mixed [msg9].");
  });

  it("does not touch game vocabulary or a citation still streaming", () => {
    expect(normalizeCitations("The M416 and R1895 are strong")).toBe("The M416 and R1895 are strong");
    expect(normalizeCitations("boring [msg1")).toBe("boring [msg1");
    expect(normalizeCitations("boring [msg12, msg4")).toBe("boring [msg12, msg4");
  });

  // QA 2026-09-26: "And in July?" ended a bullet with "[msg41525 — Sept]", which stayed raw text on screen.
  it("keeps the refs of a group whose other words only say when, and loses those words", () => {
    expect(normalizeCitations("bots everywhere [msg41525 — Sept].")).toBe("bots everywhere [msg41525].");
    expect(normalizeCitations("bots everywhere [msg41525, Sept].")).toBe("bots everywhere [msg41525].");
    expect(normalizeCitations("bots [msg41525 – from September, msg12]")).toBe("bots [msg41525, msg12]");
    expect(normalizeCitations("bots (see msg12)")).toBe("bots [msg12]");
    expect(normalizeCitations("bots (msg12, 9 Sept 2026)")).toBe("bots [msg12]");
    expect(normalizeCitations("bots (msg3 — earlier)")).toBe("bots [msg3]");
    expect(normalizeCitations("bots [msg4471, msg12 – from last turn]")).toBe("bots [msg4471, msg12]");
  });

  // Review 2026-09-26: the pass dropped every word beside the refs, so a count, a tool tag and a quoted sentence went.
  it("never drops a count, a tool tag or other words beside the refs", () => {
    expect(normalizeCitations("Lag led (212 of 840 conversations, msg12).")).toBe("Lag led (212 of 840 conversations, [msg12]).");
    expect(normalizeCitations("Lag led [scan, msg12].")).toBe("Lag led [scan] [msg12].");
    expect(normalizeCitations("Lag led [msg12, aggregate, Sept].")).toBe("Lag led [aggregate] [msg12].");
    expect(normalizeCitations("Fans were happy (as msg12 put it, love the map).")).toBe("Fans were happy (as [msg12] put it, love the map).");
    expect(normalizeCitations("bots [msg12 — the September thread about the new map rotation and its fans]")).toBe(
      "bots ([msg12] — the September thread about the new map rotation and its fans)",
    );
    expect(normalizeCitations("bots [212 threads, scan, msg12]")).toBe("bots (212 threads, [msg12]) [scan]");
  });

  it("leaves no \"[msg\" in the text that is not a whole citation", () => {
    const decorated = [
      "a [msg41525 — Sept]",
      "a [msg41525, Sept]",
      "a [Sept: msg41525]",
      "a [msg1 / msg2 — July]",
      "a (msg3 — earlier)",
      "a [msg4]. b [MSG5 , msg6 ]",
    ];
    for (const s of decorated) {
      const out = normalizeCitations(s);
      const whole = new Set([...out.matchAll(CITE_RE)].map((m) => m.index));
      const loose = [...out.matchAll(/\[msg/gi)].filter((m) => !whole.has(m.index));
      expect(loose, `${s} -> ${out}`).toEqual([]);
    }
  });

  // Production QA 2026-09-26: "…the 43.1 release on 2026-09-09 [dataset_overview]." reached the reader.
  it("drops a bracketed tool name or snake_case token, keeps step tags and link text", () => {
    expect(normalizeCitations("It coincides with the 43.1 release [dataset_overview].")).toBe("It coincides with the 43.1 release.");
    expect(normalizeCitations("Lag [dataset_overview, msg12].")).toBe("Lag [msg12].");
    expect(normalizeCitations("212 of 840 [scan] [msg12].")).toBe("212 of 840 [scan] [msg12].");
    expect(normalizeCitations("See [the_docs](https://x.y).")).toBe("See [the_docs](https://x.y).");
  });

  it("is idempotent", () => {
    for (const s of ["a (msg1, msg2) b msg3 [t3_zzzzz]", "a (212 of 840 conversations, msg12)", "a [scan, msg12]", "a (as msg12 put it, love the map)"]) {
      const once = normalizeCitations(s);
      expect(normalizeCitations(once), s).toBe(once);
    }
  });
});

describe("citedTags", () => {
  it("lists every cited ref once, in order of first citation, whatever shape it was written in", () => {
    expect(citedTags("x [msg5] y (msg2, msg5) z msg9")).toEqual(["msg5", "msg2", "msg9"]);
  });
});
